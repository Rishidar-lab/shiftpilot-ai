import { randomUUID } from "node:crypto"

import { getTask, insertTask, listTasksByShift, toTask, updateTask } from "../repos/task.js"
import { getShiftRow } from "../repos/shift.js"
import type { Database } from "../db/index.js"
import { checkDependencies, checkTransition } from "@shiftpilot/domain"
import { NotFoundError, StateMachineError, ValidationError } from "./errors.js"
import type {
  BlockTaskRequest,
  CreateTaskRequest,
  Task,
  UpdateTaskRequest,
} from "@shiftpilot/contracts"

/**
 * Dependency edges may only point at other tasks IN THE SAME SHIFT, and never
 * at the task itself. Without this, `PATCH /tasks/:id` accepted ids that do not
 * exist (leaving the planner permanently "blocked by" nothing) or the task's own
 * id (violating the task_dependencies CHECK constraint as a raw 500) — audit
 * A-5/A-6.
 */
function assertDependenciesValid(
  db: Database,
  shiftId: string,
  taskId: string,
  dependsOn: readonly string[],
): void {
  if (dependsOn.length === 0) return
  const validIds = new Set(listTasksByShift(db, shiftId).map((t) => t.row.id))
  const check = checkDependencies(dependsOn, taskId, validIds)
  if (!check.ok) {
    throw new ValidationError(
      `dependsOn must reference other tasks in the same shift; invalid: ${check.invalid.join(", ")}`,
      { invalid: check.invalid },
    )
  }
}

export function createTask(db: Database, shiftId: string, dto: CreateTaskRequest): Task {
  if (getShiftRow(db, shiftId) === undefined) {
    throw new NotFoundError("shift", shiftId)
  }
  const now = new Date().toISOString()
  const task: Task = {
    id: randomUUID(),
    shiftId,
    title: dto.title,
    category: dto.category,
    estimatedMinutes: dto.estimatedMinutes ?? null,
    deadlineAt: dto.deadlineAt ?? null,
    deadlineSource: dto.deadlineAt === null ? "unresolved" : "manual",
    explicitUrgency: dto.explicitUrgency,
    status: "active",
    dependsOn: dto.dependsOn,
    blockReason: null,
    notes: dto.notes ?? null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }
  assertDependenciesValid(db, shiftId, task.id, task.dependsOn)
  insertTask(db, task, task.dependsOn)
  return task
}

export function listTasks(db: Database, shiftId: string): Task[] {
  if (getShiftRow(db, shiftId) === undefined) {
    throw new NotFoundError("shift", shiftId)
  }
  return listTasksByShift(db, shiftId).map(toTask)
}

export function getTaskById(db: Database, id: string): Task {
  const row = getTask(db, id)
  if (row === undefined) throw new NotFoundError("task", id)
  return toTask(row)
}

export function updateTaskById(db: Database, id: string, dto: UpdateTaskRequest): Task {
  const prior = getTask(db, id)
  if (prior === undefined) throw new NotFoundError("task", id)
  const existing = toTask(prior)

  if (dto.status !== undefined) {
    const check = checkTransition(existing.status, dto.status)
    if (!check.ok) {
      throw new StateMachineError(
        `cannot transition task from "${existing.status}" to "${dto.status}"`,
      )
    }
  }

  const status = dto.status ?? existing.status
  const now = new Date().toISOString()
  const dependsOn = dto.dependsOn ?? existing.dependsOn
  if (dto.dependsOn !== undefined) {
    assertDependenciesValid(db, existing.shiftId, id, dependsOn)
  }

  const updated: Task = {
    ...existing,
    title: dto.title ?? existing.title,
    category: dto.category ?? existing.category,
    estimatedMinutes:
      dto.estimatedMinutes !== undefined ? dto.estimatedMinutes : existing.estimatedMinutes,
    deadlineAt: dto.deadlineAt !== undefined ? dto.deadlineAt : existing.deadlineAt,
    deadlineSource:
      dto.deadlineAt !== undefined
        ? dto.deadlineAt === null
          ? "unresolved"
          : "manual"
        : existing.deadlineSource,
    explicitUrgency: dto.explicitUrgency ?? existing.explicitUrgency,
    dependsOn,
    notes: dto.notes !== undefined ? dto.notes : existing.notes,
    status,
    completedAt: resolveCompletedAt(existing, status, now),
    // Leaving `blocked` retires the reason it was blocked for; keeping it made
    // stale text reappear the next time the task was blocked (audit A-27).
    blockReason: status === "blocked" ? existing.blockReason : null,
    updatedAt: now,
  }

  const { dependsOn: edges, ...row } = updated
  updateTask(db, id, row, edges)
  return updated
}

export function blockTaskById(db: Database, id: string, dto: BlockTaskRequest): Task {
  const prior = getTask(db, id)
  if (prior === undefined) throw new NotFoundError("task", id)
  const existing = toTask(prior)

  const check = checkTransition(existing.status, "blocked")
  if (!check.ok) {
    throw new StateMachineError(`cannot block a task in "${existing.status}" state`)
  }

  const now = new Date().toISOString()
  const updated: Task = {
    ...existing,
    status: "blocked",
    blockReason: dto.reason,
    updatedAt: now,
  }
  const { dependsOn, ...row } = updated
  updateTask(db, id, row, dependsOn)
  return updated
}

/**
 * `completedAt` records WHEN the work finished, so it is stamped once on the
 * transition into `completed` and preserved across later edits. Recomputing it
 * on every update moved the timestamp forward whenever an unrelated field was
 * touched, corrupting handover history (audit A-10). Leaving `completed`
 * (reopen) clears it, per the state machine.
 */
function resolveCompletedAt(existing: Task, to: Task["status"], now: string): string | null {
  if (to !== "completed") return null
  return existing.status === "completed" ? existing.completedAt : now
}
