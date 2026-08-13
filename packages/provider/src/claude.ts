import Anthropic from "@anthropic-ai/sdk"

import type { HandoverFacts, ShiftContext } from "@shiftpilot/contracts"
import {
  EXTRACTION_OUTPUT_SCHEMA,
  EXTRACTION_PROMPT_ID,
  EXTRACTION_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompt.js"
import type {
  AiProvider,
  AiProviderMeta,
  ExtractionAttempt,
  HandoverAttempt,
  ProviderFailure,
} from "./types.js"

/**
 * Real Claude provider.
 *
 * It is an ADAPTER and nothing more: it turns a shift's raw text into whatever
 * JSON the model produced, and hands that back as `raw` — untrusted, unparsed
 * by domain rules, unprivileged. Every downstream guarantee (schema, policy,
 * shift-local deadlines, human approval) is enforced after this class returns,
 * exactly as it is for the offline provider. Nothing here may short-circuit
 * that pipeline, and the application stays correct even when the model ignores
 * the prompt entirely.
 *
 * Server-side only. The API key is read from configuration that the browser
 * bundle never sees; `packages/web` does not depend on this package.
 */
export interface ClaudeProviderOptions {
  apiKey: string
  /**
   * Model identifier, always supplied by configuration. No default is baked in:
   * model ids change, and a stale hard-coded one would fail at runtime in a
   * confusing way (or silently pin an outdated model).
   */
  model: string
  /** Hard ceiling on generated tokens, including any thinking the model does. */
  maxOutputTokens: number
  /** Bounded retries for transient failures; the SDK applies exponential backoff. */
  maxRetries: number
  /** Per-request timeout handed to the SDK, in milliseconds. */
  timeoutMs: number
  /**
   * Optional effort hint. Left unset by default because not every model accepts
   * it — sending it to one that does not is a 400.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
  /**
   * Message-creation surface. Injected in tests so the whole adapter — request
   * shape, response handling and error mapping — is covered without a paid call.
   */
  messages?: MessagesLike
}

/** The single SDK method this adapter uses. */
export interface MessagesLike {
  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<Anthropic.Message>
}

export class ClaudeProvider implements AiProvider {
  readonly meta: AiProviderMeta
  private readonly messages: MessagesLike
  private readonly options: ClaudeProviderOptions

  constructor(options: ClaudeProviderOptions) {
    if (options.apiKey.trim() === "") {
      throw new Error("ClaudeProvider requires a non-empty API key")
    }
    if (options.model.trim() === "") {
      throw new Error("ClaudeProvider requires a configured model identifier")
    }
    this.options = options
    this.messages =
      options.messages ??
      new Anthropic({
        apiKey: options.apiKey,
        // The SDK retries 408/409/429/5xx and connection errors with exponential
        // backoff. Retrying again here would multiply the attempts, so this is
        // the ONLY retry layer.
        maxRetries: options.maxRetries,
        timeout: options.timeoutMs,
      }).messages
    this.meta = {
      id: "claude",
      label: `Claude (${options.model})`,
      isFake: false,
      model: options.model,
      promptId: EXTRACTION_PROMPT_ID,
      promptVersion: EXTRACTION_PROMPT_VERSION,
    }
  }

  async extractTasks(
    input: string,
    ctx: ShiftContext,
    signal?: AbortSignal,
  ): Promise<ExtractionAttempt> {
    let message: Anthropic.Message
    try {
      message = await this.messages.create(
        {
          model: this.options.model,
          max_tokens: this.options.maxOutputTokens,
          system: buildSystemPrompt({
            date: ctx.date,
            startAt: ctx.startAt,
            endAt: ctx.endAt,
            timezone: ctx.timezone,
          }),
          messages: [{ role: "user", content: buildUserPrompt(input) }],
          output_config: {
            ...(this.options.effort ? { effort: this.options.effort } : {}),
            format: { type: "json_schema", schema: EXTRACTION_OUTPUT_SCHEMA },
          },
        },
        signal ? { signal } : undefined,
      )
    } catch (error) {
      return { ok: false, failure: mapSdkError(error) }
    }

    return readExtraction(message)
  }

  /**
   * Not implemented for the real provider yet: AI-drafted handover prose is a
   * later milestone, and the deterministic HandoverFacts path does not need it.
   * Returning a typed failure keeps this honest — no placeholder prose, and no
   * pretence that a call happened (docs/implementation-plan.md).
   */
  async generateHandover(_facts: HandoverFacts): Promise<HandoverAttempt> {
    return {
      ok: false,
      failure: {
        kind: "misconfigured",
        detail: "Claude handover prose is not implemented; handover uses deterministic facts",
      },
    }
  }
}

/**
 * Turn a completed message into untrusted JSON.
 *
 * Everything that can go wrong short of a transport error shows up here:
 * a safety refusal, a truncated response, an empty body, or text that is not
 * JSON at all. Each becomes a typed failure rather than an exception or a
 * half-parsed object.
 */
export function readExtraction(message: Anthropic.Message): ExtractionAttempt {
  if (message.stop_reason === "refusal") {
    return {
      ok: false,
      failure: {
        kind: "invalid_response",
        detail: `the model declined to answer${
          message.stop_details?.category ? ` (${message.stop_details.category})` : ""
        }`,
      },
    }
  }

  if (message.stop_reason === "max_tokens") {
    return {
      ok: false,
      failure: {
        kind: "invalid_response",
        detail: "the response was truncated by the output token limit",
      },
    }
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()

  if (text === "") {
    return { ok: false, failure: { kind: "invalid_response", detail: "empty response body" } }
  }

  try {
    return { ok: true, raw: JSON.parse(text) as unknown }
  } catch {
    // No repair attempts: silently "fixing" model output is how unvalidated data
    // reaches application state. A failed parse is a failed extraction; the raw
    // text is already durable and the worker can retry.
    return {
      ok: false,
      failure: { kind: "invalid_response", detail: "response was not valid JSON" },
    }
  }
}

/**
 * Map SDK errors onto the provider-agnostic failure union. The API layer turns
 * these into stable `ai_*` codes, so the web app's handling of a Claude outage
 * is identical to its handling of a fake-provider outage.
 */
export function mapSdkError(error: unknown): ProviderFailure {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { kind: "timeout" }
  if (error instanceof Anthropic.APIUserAbortError) return { kind: "timeout" }

  if (error instanceof Anthropic.RateLimitError) {
    const retryAfter = error.headers?.get("retry-after")
    const seconds = retryAfter === null || retryAfter === undefined ? NaN : Number(retryAfter)
    return Number.isFinite(seconds)
      ? { kind: "rate_limited", retryAfterMs: seconds * 1000 }
      : { kind: "rate_limited" }
  }

  if (error instanceof Anthropic.AuthenticationError) return { kind: "unauthorized" }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return isBilling(error) ? { kind: "quota" } : { kind: "unauthorized" }
  }

  if (error instanceof Anthropic.BadRequestError) {
    return isBilling(error)
      ? { kind: "quota" }
      : { kind: "misconfigured", detail: `provider rejected the request: ${error.message}` }
  }
  if (error instanceof Anthropic.NotFoundError) {
    return {
      kind: "misconfigured",
      detail: "provider returned 404 — check the configured model identifier",
    }
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: "network", message: "could not reach the AI provider" }
  }
  if (error instanceof Anthropic.APIError) {
    return { kind: "network", message: `AI provider error (HTTP ${error.status ?? "unknown"})` }
  }

  return { kind: "network", message: "unexpected AI provider failure" }
}

/**
 * Billing/quota problems arrive as 400/403 carrying a distinguishing error type.
 * The type is read from the raw body as well as the SDK's convenience property,
 * because the two are populated by different code paths and only the body is
 * reliably present.
 */
function isBilling(error: { type?: string | null; error?: unknown }): boolean {
  const candidates = [
    error.type,
    (error.error as { type?: unknown } | undefined)?.type,
    (error.error as { error?: { type?: unknown } } | undefined)?.error?.type,
  ]
  return candidates.some((value) => typeof value === "string" && value.includes("billing"))
}
