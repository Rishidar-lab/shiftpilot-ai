import type { HandoverFacts, ShiftContext } from "@shiftpilot/contracts"

import { perAttemptTimeoutMs } from "./claude.js"
import {
  EXTRACTION_PROMPT_ID,
  EXTRACTION_PROMPT_VERSION,
  HANDOVER_PROMPT_ID,
  HANDOVER_PROMPT_VERSION,
  buildHandoverSystemPrompt,
  buildHandoverUserPrompt,
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
 * The free-tier OpenRouter route is a HARD requirement of this adapter.
 *
 * `openrouter/free` (and any `<vendor>/<model>:free` id) routes to OpenRouter's
 * free tier. Everything else is paid and is rejected. There is no fallback: if
 * the free route is unavailable, rate-limited or misconfigured, the call fails
 * and nothing silently substitutes a paid model.
 */
export function assertFreeOpenRouterModel(model: string): void {
  const free = model === "openrouter/free" || model.endsWith(":free")

  if (!free) {
    throw new Error(`Paid/non-free OpenRouter model rejected: ${model}`)
  }
}

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"

export interface OpenRouterProviderOptions {
  apiKey: string
  /**
   * Model identifier. MUST be a free-tier route: `openrouter/free` or a
   * `<vendor>/<model>:free` id. Everything else throws before any request.
   */
  model: string
  /**
   * Hard ceiling on generated tokens. Small on purpose: free-tier routes cap
   * output, and extraction needs very little.
   */
  maxOutputTokens: number
  /** Total time budget for one logical call, in milliseconds. */
  timeoutMs: number
  /**
   * Bounded retries for HTTP 429 (free-tier shared quotas) ONLY, against the
   * exact same model and route, with backoff. Default 0: a rate-limited free
   * route FAILS — retrying is an opt-in for runs that need to absorb transient
   * 429s. There is never a retry into a different model, paid or free.
   */
  maxRetries?: number
  /** Base 429 backoff in ms (doubles per retry); overridable for tests. */
  retryBackoffMs?: number
  /** OpenAI-compatible base URL. Defaults to the OpenRouter v1 endpoint. */
  baseUrl?: string
  /** HTTP surface, injected in tests so the adapter needs no network. */
  fetchFn?: typeof fetch
}

/** Minimal shape of an OpenAI-compatible chat completion response. */
export interface ChatCompletionResponse {
  id?: string
  model?: string
  choices?: Array<{
    message?: { content?: string | null }
  }>
  error?: { message?: string; type?: string; code?: string }
}

/**
 * Real OpenRouter provider, OpenAI-compatible endpoint.
 *
 * An ADAPTER like the Claude one: it turns raw shift text into whatever JSON the
 * model produced and hands it back as `raw` — untrusted, unparsed, unprivileged.
 * Every downstream guarantee (schema, policy, human review, approval) is
 * enforced after this class returns. Nothing here may short-circuit that
 * pipeline.
 *
 * Free-tier only by construction: the model guard runs at construction and
 * before EVERY inference. Retries are limited to HTTP 429 (free-tier shared
 * quotas), against the exact same route, and disabled by default: a
 * rate-limited free route fails rather than spending on a paid fallback,
 * which can never happen because no paid model can be configured here.
 */
export class OpenRouterProvider implements AiProvider {
  readonly meta: AiProviderMeta
  /** The model OpenRouter actually routed the last response to, if it said. */
  resolvedModel: string | null = null

  private readonly options: OpenRouterProviderOptions
  private readonly fetchFn: typeof fetch

  constructor(options: OpenRouterProviderOptions) {
    if (options.apiKey.trim() === "") {
      throw new Error("OpenRouterProvider requires a non-empty API key")
    }
    if (options.model.trim() === "") {
      throw new Error("OpenRouterProvider requires a configured model identifier")
    }
    // Mandatory: never even construct against a paid route.
    assertFreeOpenRouterModel(options.model)

    this.options = options
    this.fetchFn = options.fetchFn ?? fetch
    this.meta = {
      id: "openrouter",
      label: `OpenRouter free (${options.model})`,
      isFake: false,
      model: options.model,
      promptId: EXTRACTION_PROMPT_ID,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      handoverPromptId: HANDOVER_PROMPT_ID,
      handoverPromptVersion: HANDOVER_PROMPT_VERSION,
    }
  }

  async extractTasks(
    input: string,
    ctx: ShiftContext,
    signal?: AbortSignal,
  ): Promise<ExtractionAttempt> {
    assertFreeOpenRouterModel(this.options.model)
    const response = await this.chat(
      {
        model: this.options.model,
        max_tokens: this.options.maxOutputTokens,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt({
              date: ctx.date,
              startAt: ctx.startAt,
              endAt: ctx.endAt,
              timezone: ctx.timezone,
            }),
          },
          { role: "user", content: buildUserPrompt(input) },
        ],
      },
      signal,
    )
    if (!response.ok) return response
    return readCompletionContent(response.payload)
  }

  async generateHandover(facts: HandoverFacts, signal?: AbortSignal): Promise<HandoverAttempt> {
    assertFreeOpenRouterModel(this.options.model)
    const response = await this.chat(
      {
        model: this.options.model,
        max_tokens: this.options.maxOutputTokens,
        messages: [
          { role: "system", content: buildHandoverSystemPrompt() },
          { role: "user", content: buildHandoverUserPrompt(facts) },
        ],
      },
      signal,
    )
    if (!response.ok) return response
    return readCompletionContent(response.payload)
  }

  /**
   * One POST to the OpenAI-compatible chat completions endpoint. Only HTTP 429
   * is retried, bounded, against the exact same model and route, with backoff;
   * everything else is final. A model that changes is impossible by construction
   * — the retry reuses every byte of the original request.
   */
  private async chat(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<
    { ok: true; payload: ChatCompletionResponse } | { ok: false; failure: ProviderFailure }
  > {
    const url = `${this.options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL}/chat/completions`
    const maxRetries = this.options.maxRetries ?? 0
    const perAttemptMs = perAttemptTimeoutMs(this.options.timeoutMs, maxRetries)

    for (let attempt = 0; ; attempt++) {
      const attemptSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(perAttemptMs)])
        : AbortSignal.timeout(perAttemptMs)

      let raw: Response
      try {
        raw = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.options.apiKey}`,
            "HTTP-Referer": "https://github.com/shift-pilot/shift-pilot",
            "X-Title": "ShiftPilot",
          },
          body: JSON.stringify(body),
          signal: attemptSignal,
        })
      } catch (error) {
        return { ok: false, failure: mapTransportError(error) }
      }

      // Never surface response headers: they can echo credentials or account ids.
      if (raw.status === 429 && attempt < maxRetries) {
        const retryAfter = raw.headers.get("retry-after")
        const seconds = retryAfter === null ? NaN : Number(retryAfter)
        const baseMs = Number.isFinite(seconds)
          ? seconds * 1000
          : (this.options.retryBackoffMs ?? 5_000) * 2 ** attempt
        await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, baseMs)))
        continue
      }

      if (!raw.ok) {
        return { ok: false, failure: mapHttpStatus(raw.status) }
      }

      let payload: ChatCompletionResponse
      try {
        payload = (await raw.json()) as ChatCompletionResponse
      } catch (error) {
        // The deadline can expire while the body is still streaming. That is our
        // timeout, not a malformed provider response, and calling it "not JSON"
        // sends whoever is debugging it after the wrong system.
        if (isAbortError(error)) return { ok: false, failure: mapTransportError(error) }
        return {
          ok: false,
          failure: { kind: "invalid_response", detail: "response body was not JSON" },
        }
      }

      if (payload.error) {
        const code = payload.error.code ?? payload.error.type ?? "unknown"
        return {
          ok: false,
          failure: {
            kind: "misconfigured",
            detail: `provider rejected the request (${code}): ${payload.error.message ?? ""}`,
          },
        }
      }

      if (typeof payload.model === "string" && payload.model !== "") {
        this.resolvedModel = payload.model
      }

      return { ok: true, payload }
    }
  }
}

/**
 * Turn a completed completion into untrusted JSON.
 *
 * Free-tier models are sloppy about transport: they wrap JSON in markdown
 * fences, pad it with prose, or trail stray brackets. Recovery is bounded and
 * mechanical — exact parse first, then fence/wrapping extraction, then a small
 * number of trailing-junk trims. This ONLY recovers JSON the model actually
 * emitted; it cannot invent fields, and the parsed value still passes the full
 * schema + policy + review pipeline exactly like any other provider's output.
 * A response that cannot be recovered is a failed extraction, never a repair.
 */
export function readCompletionContent(payload: ChatCompletionResponse): ExtractionAttempt {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, failure: { kind: "invalid_response", detail: "empty response body" } }
  }

  const parsed = tryParseJsonContent(content)
  if (parsed !== null) return { ok: true, raw: parsed }
  return {
    ok: false,
    failure: { kind: "invalid_response", detail: "response was not valid JSON" },
  }
}

/**
 * Bounded transport-noise recovery. Returns the parsed value, or null when the
 * content is not recoverable. Never mutates the content beyond trimming.
 */
export function tryParseJsonContent(content: string): unknown | null {
  const exact = attemptJsonParse(content)
  if (exact !== null) return exact

  // Fence/wrapping extraction: the shape of a JSON value inside junk.
  const braceStart = content.indexOf("{")
  const bracketStart = content.indexOf("[")
  const starts = [braceStart, bracketStart].filter((i) => i >= 0)
  if (starts.length === 0) return null
  const start = Math.min(...starts)

  const braceEnd = content.lastIndexOf("}")
  const bracketEnd = content.lastIndexOf("]")
  const end = Math.max(braceEnd, bracketEnd)
  if (end < start) return null

  let candidate = content.slice(start, end + 1)
  const junk = new Set(["]", "}", "`", "'", ",", " ", "\t", "\n", '"'])
  // Trailing junk (stray brackets, fence ticks, whitespace) one character at a
  // time, hard-bounded so pathological output cannot burn CPU.
  for (let i = 0; i < 32 && candidate.length > 0; i++) {
    const parsed = attemptJsonParse(candidate)
    if (parsed !== null) return parsed
    if (!junk.has(candidate[candidate.length - 1]!)) return null
    candidate = candidate.slice(0, -1)
  }
  return null
}

function attemptJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * `AbortSignal.timeout()` aborts with a **TimeoutError**, not an `AbortError`,
 * and `AbortSignal.any` forwards that reason verbatim — so matching only
 * `AbortError` reports an expired deadline as an unreachable network. Both names
 * mean the same thing to a caller: the attempt ran out of time.
 */
function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError"
  }
  // undici wraps the abort reason rather than throwing it directly.
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
}

function mapTransportError(error: unknown): ProviderFailure {
  if (isAbortError(error)) {
    return { kind: "timeout" }
  }
  return { kind: "network", message: "could not reach the AI provider" }
}

function mapHttpStatus(status: number): ProviderFailure {
  if (status === 401 || status === 403) {
    return { kind: "unauthorized" }
  }
  if (status === 429) {
    return { kind: "rate_limited" }
  }
  if (status === 402) {
    return { kind: "quota" }
  }
  if (status === 400 || status === 404 || status === 422) {
    return { kind: "misconfigured", detail: `HTTP ${status}` }
  }
  return { kind: "network", message: `AI provider error (HTTP ${status})` }
}
