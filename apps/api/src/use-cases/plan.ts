import { listTasksByShift, toTask } from "../repos/task.js"
import { getShift } from "./shift.js"
import type { Database } from "../db/index.js"
import {
  buildHandoverFacts,
  decideNext,
  normalizeHandoverNarrative,
  planShift,
} from "@shiftpilot/domain"
import type { AiProvider } from "@shiftpilot/provider"
import type { HandoverFacts, HandoverResponse, NextDecision, WorkPlan } from "@shiftpilot/contracts"
import { failureMessage, isProviderFailure, withTimeout } from "./with-timeout.js"

/**
 * Planning endpoints are pure domain projections over current task state
 * (docs/architecture.md §4). The plan is never stored — it is recomputed on
 * every request, so it can never be stale.
 */
export function getPlan(db: Database, shiftId: string, now: Date = new Date()): WorkPlan {
  const shift = getShift(db, shiftId)
  const tasks = listTasksByShift(db, shiftId).map(toTask)
  return planShift({ shift, tasks, now })
}

export function getNext(db: Database, shiftId: string, now: Date = new Date()): NextDecision {
  const shift = getShift(db, shiftId)
  const tasks = listTasksByShift(db, shiftId).map(toTask)
  return decideNext({ shift, tasks, now })
}

export function getHandover(db: Database, shiftId: string, now: Date = new Date()): HandoverFacts {
  const shift = getShift(db, shiftId)
  const tasks = listTasksByShift(db, shiftId).map(toTask)
  return buildHandoverFacts({ shift, tasks, now })
}

/**
 * Handover with AI-drafted prose over the top of the deterministic facts.
 *
 * The facts are computed FIRST and are the only input the provider receives, so
 * the narrative can only ever be a retelling of state the database already
 * proved. Provider failure and invalid output are NOT errors here: they resolve
 * to an explicit, labelled degraded response that still carries the full facts.
 * A handover that silently lost its numbers because a third party had an outage
 * would be worse than one that plainly says the prose is unavailable.
 */
export async function getHandoverNarrative(
  db: Database,
  provider: AiProvider,
  shiftId: string,
  timeoutMs: number,
  now: Date = new Date(),
): Promise<HandoverResponse> {
  const facts = getHandover(db, shiftId, now)
  const provenance = {
    provider: provider.meta.id,
    promptVersion: provider.meta.handoverPromptVersion,
  }

  const attempt = await withTimeout(
    (signal) => provider.generateHandover(facts, signal),
    timeoutMs,
    () => ({ kind: "timeout" as const }),
  ).catch((error: unknown) => {
    if (isProviderFailure(error)) return { ok: false, failure: error } as const
    throw error
  })

  if (!attempt.ok) {
    return {
      facts,
      narrative: null,
      degraded: { reason: "provider_failure", detail: failureMessage(attempt.failure) },
      ...provenance,
    }
  }

  const outcome = normalizeHandoverNarrative(attempt.raw, facts)
  if (!outcome.ok) {
    return {
      facts,
      narrative: null,
      degraded: { reason: outcome.reason, detail: outcome.detail },
      ...provenance,
    }
  }

  return { facts, narrative: outcome.narrative, degraded: null, ...provenance }
}
