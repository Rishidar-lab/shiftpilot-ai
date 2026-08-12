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
