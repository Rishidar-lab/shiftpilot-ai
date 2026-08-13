import type { FastifyInstance, FastifyRequest } from "fastify"

import { getHandover, getHandoverNarrative, getNext, getPlan } from "../use-cases/plan.js"
import { ValidationError } from "../use-cases/errors.js"
import type { AppConfig } from "../config.js"
import type { Database } from "../db/index.js"
import type { AiProvider } from "@shiftpilot/provider"
import type { RateLimiter } from "../rate-limit.js"
import type { HandoverFacts, HandoverResponse, NextDecision, WorkPlan } from "@shiftpilot/contracts"

/**
 * Planning endpoints are deterministic domain projections recomputed on every
 * request — never stored (docs/architecture.md §4). `now` defaults to the real
 * server clock so a plan is honest about what fits before shift end; tests and
 * clients may override it with `?now=<ISO>` for deterministic/replay planning.
 */
export function registerPlan(
  app: FastifyInstance,
  db: Database,
  provider: AiProvider,
  config: AppConfig,
  rateLimiter: RateLimiter,
): void {
  app.get("/shifts/:id/plan", async (request): Promise<WorkPlan> => {
    const { id } = request.params as { id: string }
    return getPlan(db, id, parseNow(request))
  })

  app.get("/shifts/:id/next", async (request): Promise<NextDecision> => {
    const { id } = request.params as { id: string }
    return getNext(db, id, parseNow(request))
  })

  app.get("/shifts/:id/handover", async (request): Promise<HandoverFacts> => {
    const { id } = request.params as { id: string }
    return getHandover(db, id, parseNow(request))
  })

  /**
   * AI-drafted handover prose. POST, not GET: it spends provider tokens, so it
   * must not be triggered by a prefetch, a retry, or a browser revisiting a URL —
   * and it carries the same throttle as intake for the same reason. The
   * deterministic GET above stays free and is what the page loads by default.
   */
  app.post("/shifts/:id/handover/narrative", async (request): Promise<HandoverResponse> => {
    rateLimiter.check(request.ip)
    const { id } = request.params as { id: string }
    return getHandoverNarrative(db, provider, id, config.aiTimeoutMs, parseNow(request))
  })
}

/**
 * `?now=` overrides the clock for deterministic replay. An unparseable value is
 * rejected rather than silently replaced with the real clock: a caller that
 * asked for a specific instant and quietly got "whenever the server ran" cannot
 * tell that its request was ignored (audit A-14).
 */
function parseNow(request: FastifyRequest): Date {
  const query = request.query as { now?: string } | undefined
  if (query?.now === undefined) return new Date()
  const parsed = new Date(query.now)
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`"now" must be an ISO 8601 datetime; received "${query.now}"`)
  }
  return parsed
}
