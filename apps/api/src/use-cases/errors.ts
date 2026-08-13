/** Typed domain/use-case errors mapped to stable API error codes (docs §7). */
export class NotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly id: string,
  ) {
    super(`${resource} not found: ${id}`)
    this.name = "NotFoundError"
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConflictError"
  }
}

export class StateMachineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StateMachineError"
  }
}

/** Raised when the AI provider fails; mapped to a stable ai_* error code. */
export class ProviderError extends Error {
  constructor(
    public readonly code: "ai_unavailable" | "ai_invalid_response" | "ai_budget_exceeded",
    public readonly kind: string,
    message: string,
  ) {
    super(message)
    this.name = "ProviderError"
  }
}
