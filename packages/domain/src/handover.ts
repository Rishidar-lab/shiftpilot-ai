import type {
  HandoverDegradedReason,
  HandoverFacts,
  HandoverNarrative as HandoverNarrativeType,
  Shift,
  Task,
} from "@shiftpilot/contracts"
import { HandoverNarrative } from "@shiftpilot/contracts"

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

export type HandoverNarrativeOutcome =
  | { ok: true; narrative: HandoverNarrativeType }
  | { ok: false; reason: HandoverDegradedReason; detail: string }

/**
 * Validate untrusted handover prose against the facts it was supposed to describe.
 *
 * This is the trust boundary for AI-written narrative, and it is deliberately
 * unforgiving. Two checks:
 *
 *  1. The response must satisfy the `HandoverNarrative` contract — bounded
 *     strings, no extra fields, at most five attention entries.
 *  2. Every referenced `taskId` must already appear in this shift's facts. A
 *     single unknown id fails the WHOLE narrative rather than being quietly
 *     dropped: an id the model did not get from the facts means it produced
 *     something it could not have known, and the rest of that prose has not
 *     earned trust either. The caller then renders the deterministic facts in a
 *     labelled degraded state, which is always a safe answer.
 *
 * Note what this function cannot do: it cannot prove a sentence is true. That is
 * why the narrative is additive — the facts are rendered independently and are
 * always authoritative — and why the prompt gives the model nowhere to put a
 * number or a task name in the first place.
 */
export function normalizeHandoverNarrative(
  raw: unknown,
  facts: HandoverFacts,
): HandoverNarrativeOutcome {
  const parsed = HandoverNarrative.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      reason: "invalid_narrative",
      detail: first
        ? `${first.path.join(".") || "response"}: ${first.message}`
        : "malformed response",
    }
  }

  const known = knownTaskIds(facts)
  const unknown = parsed.data.attention.filter((item) => !known.has(item.taskId))
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: "unknown_task_reference",
      detail: `referenced ${unknown.length} task id(s) absent from this shift's facts`,
    }
  }

  return { ok: true, narrative: parsed.data }
}

/** Every task id the facts actually mention — the model's entire allowed vocabulary. */
function knownTaskIds(facts: HandoverFacts): Set<string> {
  return new Set([
    ...facts.completed.map((t) => t.taskId),
    ...facts.pending.map((t) => t.taskId),
    ...facts.blocked.map((t) => t.taskId),
    ...facts.overdue.map((t) => t.taskId),
    ...facts.upcomingDeadlines.map((t) => t.taskId),
    ...facts.recommendations.map((t) => t.taskId),
  ])
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
