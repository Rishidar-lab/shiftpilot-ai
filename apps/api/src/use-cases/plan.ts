import { listTasksByShift, toTask } from "../repos/task.js"
import { getShift } from "./shift.js"
import type { Database } from "../db/index.js"
import { buildHandoverFacts, decideNext, planShift } from "@shiftpilot/domain"
import type { HandoverFacts, NextDecision, WorkPlan } from "@shiftpilot/contracts"

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
