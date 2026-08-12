import type { FastifyInstance, FastifyRequest } from "fastify"

import { getHandover, getNext, getPlan } from "../use-cases/plan.js"
import type { Database } from "../db/index.js"
import type { HandoverFacts, NextDecision, WorkPlan } from "@shiftpilot/contracts"

/**
 * Planning endpoints are deterministic domain projections recomputed on every
 * request — never stored (docs/architecture.md §4). `now` defaults to the real
 * server clock so a plan is honest about what fits before shift end; tests and
 * clients may override it with `?now=<ISO>` for deterministic/replay planning.
 */
export function registerPlan(app: FastifyInstance, db: Database): void {
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
}

function parseNow(request: FastifyRequest): Date {
  const query = request.query as { now?: string } | undefined
  if (query?.now === undefined) return new Date()
  const parsed = new Date(query.now)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}
