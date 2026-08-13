import type { HandoverFacts, ShiftContext } from "@shiftpilot/contracts"

export type ProviderFailure =
  | { kind: "timeout" }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "quota" }
  | { kind: "network"; message: string }
  | { kind: "invalid_response"; detail: string }
  | { kind: "budget_exceeded" }

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
  promptId: string
  promptVersion: string
}

/**
 * The only AI surface in the codebase. Every implementation returns `raw` as
 * untrusted input: the validation pipeline (packages/domain) must run before
 * anything enters application/domain state. Domain logic never depends on this
 * interface.
 */
export interface AiProvider {
  readonly meta: AiProviderMeta
  extractTasks(input: string, ctx: ShiftContext): Promise<ExtractionAttempt>
  generateHandover(facts: HandoverFacts): Promise<HandoverAttempt>
}
