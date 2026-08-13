import { RateLimitError } from "./use-cases/errors.js"

/**
 * Fixed-window limiter for the AI-backed endpoints.
 *
 * Why this exists: every intake capture spends provider tokens. With a real key
 * configured, an unauthenticated client could otherwise loop `POST
 * /shifts/:id/intake` and drain the account (audit A-25). Week 1 is explicitly
 * single-user and unauthenticated, so the proportionate control is a server-side
 * throttle plus a hard input-size cap — not an auth system.
 *
 * Deliberately in-process and non-distributed: this API is a single process by
 * design. It is a spend brake, NOT a monetary budget cap — see the honest
 * limitation note in README "Security notes".
 */
export interface RateLimiterOptions {
  limit: number
  windowMs: number
  now?: () => number
}

export interface RateLimiter {
  check(key: string): void
}

export function createRateLimiter({ limit, windowMs, now }: RateLimiterOptions): RateLimiter {
  const clock = now ?? (() => Date.now())
  const windows = new Map<string, { count: number; resetAt: number }>()

  return {
    check(key: string): void {
      const current = clock()
      const existing = windows.get(key)

      if (existing === undefined || current >= existing.resetAt) {
        windows.set(key, { count: 1, resetAt: current + windowMs })
        pruneExpired(windows, current)
        return
      }

      if (existing.count >= limit) {
        throw new RateLimitError(Math.max(1, Math.ceil((existing.resetAt - current) / 1000)))
      }
      existing.count += 1
    },
  }
}

/** Keep the map bounded; windows are short and callers are few. */
function pruneExpired(windows: Map<string, { resetAt: number }>, current: number): void {
  if (windows.size < 1000) return
  for (const [key, window] of windows) {
    if (current >= window.resetAt) windows.delete(key)
  }
}
