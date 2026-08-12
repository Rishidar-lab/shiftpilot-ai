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
 * The only AI surface in the codebase (docs/architecture.md §5).
 * Every implementation returns `raw` as untrusted input: the validation pipeline
 * (M2) must run before anything enters domain/application state.
 * Domain logic never depends on this interface.
 */
export interface AiProvider {
  extractTasks(input: string, ctx: ShiftContext): Promise<ExtractionAttempt>
  generateHandover(facts: HandoverFacts): Promise<HandoverAttempt>
}
