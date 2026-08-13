import type { HandoverFacts, ShiftContext } from "@shiftpilot/contracts"

export type ProviderFailure =
  | { kind: "timeout" }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "quota" }
  | { kind: "network"; message: string }
  | { kind: "invalid_response"; detail: string }
  | { kind: "budget_exceeded" }
  /** Credentials rejected by the provider (401/403) — an operator problem. */
  | { kind: "unauthorized" }
  /** The request itself was rejected (bad model id, malformed request, 400/404). */
  | { kind: "misconfigured"; detail: string }

export type ExtractionAttempt = { ok: true; raw: unknown } | { ok: false; failure: ProviderFailure }

export type HandoverAttempt = { ok: true; raw: unknown } | { ok: false; failure: ProviderFailure }

/**
 * Provenance every provider must declare. The API persists `id` and
 * `promptVersion` on each RawInput so extractions are reproducible and
 * auditable (docs/architecture.md §5). `label` is shown in the UI so users
 * always know whether AI is real or simulated.
 */
export interface AiProviderMeta {
  id: string
  label: string
  /**
   * Declared by the implementation, never inferred from `id`. Simulated output
   * must be labelled as simulated everywhere it is shown (docs/architecture.md §5).
   */
  isFake: boolean
  /** Configured model identifier for diagnostics; null when no model is used. */
  model: string | null
  promptId: string
  promptVersion: string
  /**
   * Extraction and handover are separately versioned prompts: changing how the
   * handover reads must not invalidate the provenance of past extractions, and
   * an extraction change must not look like a handover change.
   */
  handoverPromptId: string
  handoverPromptVersion: string
}

/**
 * The only AI surface in the codebase. Every implementation returns `raw` as
 * untrusted input: the validation pipeline (packages/domain) must run before
 * anything enters application/domain state. Domain logic never depends on this
 * interface.
 */
export interface AiProvider {
  readonly meta: AiProviderMeta
  /**
   * `signal` lets the caller's timeout actually ABORT the in-flight request
   * rather than merely stop waiting for it — an unaborted HTTP call keeps
   * consuming provider quota after the API has already given up.
   */
  extractTasks(input: string, ctx: ShiftContext, signal?: AbortSignal): Promise<ExtractionAttempt>
  generateHandover(facts: HandoverFacts, signal?: AbortSignal): Promise<HandoverAttempt>
}
