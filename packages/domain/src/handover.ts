import type { HandoverFacts, Shift, Task } from "@shiftpilot/contracts"

import { minutesUntil } from "./next.js"
import { planShift } from "./schedule.js"

const MINUTE_MS = 60_000

export interface HandoverInput {
  shift: Shift
  tasks: readonly Task[]
  now: Date
}

/**
 * Deterministic, structured handover facts (docs/architecture.md §4).
 * No prose — the LLM later drafts natural language AROUND these facts, and
 * every number here is computed from the database by domain code, so the
 * model can never invent operational facts ("no fabricated metrics").
 */
export function buildHandoverFacts({ shift, tasks, now }: HandoverInput): HandoverFacts {
  const plan = planShift({ shift, tasks, now })
  const nonTerminal = tasks.filter(
    (task) => task.status !== "completed" && task.status !== "cancelled",
  )

  const overdue = nonTerminal
    .filter(
      (task) => task.deadlineAt !== null && new Date(task.deadlineAt!).getTime() < now.getTime(),
    )
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      overdueMin: Math.round((now.getTime() - new Date(task.deadlineAt!).getTime()) / MINUTE_MS),
    }))
    .sort((a, b) => b.overdueMin - a.overdueMin)

  const upcomingDeadlines = nonTerminal
    .filter(
      (task) => task.deadlineAt !== null && new Date(task.deadlineAt!).getTime() >= now.getTime(),
    )
    .sort((a, b) => new Date(a.deadlineAt!).getTime() - new Date(b.deadlineAt!).getTime())
    .slice(0, 5)
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      dueInMin: minutesUntil(task.deadlineAt!, now),
    }))

  const pending = plan.sequence
    .filter(
      (entry) => entry.state === "ready" || entry.state === "waiting" || entry.state === "cycle",
    )
    .map((entry) => ({
      taskId: entry.task.id,
      title: entry.task.title,
      priorityBucket: entry.priority?.bucket ?? "low",
      deadlineAt: entry.task.deadlineAt,
      dueInMin: entry.task.deadlineAt === null ? null : minutesUntil(entry.task.deadlineAt, now),
    }))

  const blocked = plan.sequence
    .filter((entry) => entry.state === "blocked")
    .map((entry) => ({
      taskId: entry.task.id,
      title: entry.task.title,
      blockedBy: blockedByTitles(entry.task, tasks),
    }))

  const recommendations = plan.sequence
    .filter((entry) => entry.state === "ready")
    .map((entry) => ({ taskId: entry.task.id, title: entry.task.title }))
    .slice(0, 5)

  return {
    shiftId: shift.id,
    date: shift.date,
    generatedAt: now.toISOString(),
    counts: {
      total: tasks.length,
      active: tasks.filter((task) => task.status === "active").length,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      cancelled: tasks.filter((task) => task.status === "cancelled").length,
      overdue: overdue.length,
      waiting: plan.sequence.filter((entry) => entry.state === "waiting").length,
    },
    completed: plan.completedTasks.map((task) => ({
      taskId: task.id,
      title: task.title,
      completedAt: task.completedAt,
    })),
    pending,
    blocked,
    overdue,
    upcomingDeadlines,
    warnings: plan.warnings,
    recommendations,
  }
}

function blockedByTitles(task: Task, tasks: readonly Task[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const titles = task.dependsOn
    .map((id) => byId.get(id))
    .filter(
      (dep): dep is Task =>
        dep !== undefined && dep.status !== "completed" && dep.status !== "cancelled",
    )
    .map((dep) => dep.title)
  if (titles.length === 0 && task.blockReason !== null) return [task.blockReason]
  return titles
}
