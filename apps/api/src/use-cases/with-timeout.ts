import type { ProviderFailure } from "@shiftpilot/provider"

/**
 * Bound a provider call in wall-clock time AND actually abort it.
 *
 * Rejecting without aborting leaves the HTTP request running and still spending
 * quota after we have stopped caring about the answer (audit A-18). Both AI call
 * sites — extraction and handover — share this so neither can drift into the
 * cheaper, leakier version.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  onTimeout: () => ProviderFailure,
): Promise<T> {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(onTimeout())
    }, ms)
  })
  try {
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function isProviderFailure(value: unknown): value is ProviderFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as ProviderFailure).kind === "string"
  )
}

/** Human-readable text for a provider failure. Never includes credentials. */
export function failureMessage(failure: ProviderFailure): string {
  switch (failure.kind) {
    case "timeout":
      return "The AI provider did not respond in time."
    case "rate_limited":
      return `The AI provider was rate limited${failure.retryAfterMs ? ` (retry after ${failure.retryAfterMs}ms)` : ""}.`
    case "quota":
      return "The AI provider quota was exceeded."
    case "network":
      return `AI provider network error: ${failure.message}`
    case "invalid_response":
      return `The AI provider returned an invalid response: ${failure.detail}`
    case "budget_exceeded":
      return "The AI provider budget was exceeded."
    case "unauthorized":
      return "The AI provider rejected the server's credentials."
    case "misconfigured":
      return `The AI provider could not process the request: ${failure.detail}`
  }
}
