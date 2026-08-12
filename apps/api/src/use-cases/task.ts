import { randomUUID } from "node:crypto"

import { getTask, insertTask, toTask, updateTask } from "../repos/task.js"
import { getShiftRow } from "../repos/shift.js"
import type { Database } from "../db/index.js"
import { checkTransition } from "@shiftpilot/domain"
import { NotFoundError, StateMachineError } from "./errors.js"
import type {
  BlockTaskRequest,
  CreateTaskRequest,
  Task,
  UpdateTaskRequest,
} from "@shiftpilot/contracts"

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
  insertTask(db, task, task.dependsOn)
  return task
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
    dependsOn: dto.dependsOn ?? existing.dependsOn,
    notes: dto.notes !== undefined ? dto.notes : existing.notes,
    status,
    completedAt: resolveCompletedAt(status, now),
    updatedAt: now,
  }

  const { dependsOn, ...row } = updated
  updateTask(db, id, row, dependsOn)
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

function resolveCompletedAt(to: Task["status"], now: string): string | null {
  return to === "completed" ? now : null
}
