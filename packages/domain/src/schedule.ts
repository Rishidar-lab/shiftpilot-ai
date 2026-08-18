import type { PlanWarning, ScheduledTask, Shift, Task, WorkPlan } from "@shiftpilot/contracts"

import { DEFAULT_DURATION_MINUTES } from "./constants.js"
import { dependencyOrder, findCycleMembers, unmetDependencies } from "./graph.js"
import type { TaskGraph } from "./graph.js"
import { decideNext } from "./next.js"
import { compareRanked, rankTasks } from "./priority.js"
import type { RankedTask } from "./priority.js"
import { effectivePlanningStart } from "./time.js"

const MINUTE_MS = 60_000

export interface PlanInput {
  shift: Shift
  tasks: readonly Task[]
  now: Date
}

/**
 * Deterministic shift scheduler (docs/architecture.md §4).
 *
 * Ordering: dependency-constrained by preference — a priority-Kahn layering
 * where, at each step, the highest-ranked task whose dependencies are already
 * laid out is placed next. Tasks in dependency cycles are never dropped: they
 * are flagged, warned about, and ordered by priority as a fallback.
 *
 * Time slots run from `now` to shift end. Tasks that cannot fit keep their
 * place in the plan with fits=false and explicit reasons/warnings — nothing
 * is silently discarded.
 */
export function planShift({ shift, tasks, now }: PlanInput): WorkPlan {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const done = new Set(
    tasks
      .filter((task) => task.status === "completed" || task.status === "cancelled")
      .map((task) => task.id),
  )
  const graph: TaskGraph = { byId, done }

  const completedTasks = tasks
    .filter((task) => task.status === "completed")
    .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""))
  const cancelledTasks = tasks.filter((task) => task.status === "cancelled")

  const warnings: PlanWarning[] = []
  const drafts = tasks.filter((task) => task.status === "draft")
  if (drafts.length > 0) {
    warnings.push({ type: "draft_not_approved", taskIds: drafts.map((task) => task.id) })
  }
  if (tasks.length === 0) {
    warnings.push({ type: "empty_workload" })
  }

  const workloads = tasks.filter(
    (task) => task.status !== "completed" && task.status !== "cancelled" && task.status !== "draft",
  )
  const shiftEnded = now.getTime() >= new Date(shift.endAt).getTime()
  if (shiftEnded) {
    warnings.push({ type: "shift_ended" })
  }

  const ranked = rankTasks(workloads, now)
  const { picked, leftover } = dependencyOrder(ranked, graph)
  const leftRanked = [...leftover].sort(compareRanked)
  const cycleIds = findCycleMembers(leftRanked, graph)

  // Canonical schedulable horizon: before the shift, plan from shiftStart, not
  // from pre-shift wall-clock time (docs/architecture.md §4). Priority/deadline
  // scoring stays on the real `now` above — only placement is clamped.
  const planStart = effectivePlanningStart(shift, now).getTime()

  const sequence: ScheduledTask[] = []
  const missingDurationIds: string[] = []
  const cannotFitIds: string[] = []
  let cursor = planStart

  const context = { now, planStart, shiftEnded, cursor: () => cursor, shift, graph, cycleIds }
  for (const entry of picked) {
    const scheduled = { ...scheduleEntry(entry, context), position: sequence.length }
    sequence.push(scheduled)
    if (scheduled.fits && scheduled.endAt !== null) {
      cursor = Math.max(cursor, new Date(scheduled.endAt).getTime())
    }
    collect(scheduled, missingDurationIds, cannotFitIds)
  }

  for (const entry of leftRanked) {
    const scheduled = { ...scheduleEntry(entry, context), position: sequence.length }
    sequence.push(scheduled)
    collect(scheduled, missingDurationIds, cannotFitIds)
  }

  if (cycleIds.size > 0) {
    warnings.push({ type: "dependency_cycle", taskIds: [...cycleIds] })
  }
  if (missingDurationIds.length > 0) {
    warnings.push({ type: "missing_duration", taskIds: missingDurationIds })
  }
  if (cannotFitIds.length > 0) {
    warnings.push({ type: "cannot_fit", taskIds: cannotFitIds })
  }

  const shiftEnd = new Date(shift.endAt).getTime()
  const availableMinutes = shiftEnded
    ? 0
    : Math.max(0, Math.round((shiftEnd - planStart) / MINUTE_MS))
  const scheduledMinutes = sequence.reduce(
    (sum, entry) =>
      sum + (entry.fits ? (entry.task.estimatedMinutes ?? DEFAULT_DURATION_MINUTES) : 0),
    0,
  )

  return {
    shiftId: shift.id,
    date: shift.date,
    generatedAt: now.toISOString(),
    now: now.toISOString(),
    sequence,
    completedTasks,
    cancelledTasks,
    next: decideNext({ shift, tasks, now, cycleIds, graph }),
    warnings,
    load: { availableMinutes, scheduledMinutes },
  }
}

interface ScheduleContext {
  now: Date
  planStart: number
  shiftEnded: boolean
  cursor: () => number
  shift: Shift
  graph: TaskGraph
  cycleIds: Set<string>
}

function scheduleEntry(rank: RankedTask, ctx: ScheduleContext): ScheduledTask {
  const task = rank.task
  const base: ScheduledTask = {
    task,
    position: 0,
    priority: rank.reason,
    state: "ready",
    startAt: null,
    endAt: null,
    fits: false,
    reasons: [],
    taskWarnings: [],
  }

  const unmet = unmetDependencies(task, ctx.graph)
  const blockedDeps = unmet.filter((dep) => dep.status === "blocked")

  if (task.status === "blocked") {
    return {
      ...base,
      state: "blocked",
      reasons: [`blocked: ${task.blockReason ?? "no reason given"}`],
    }
  }
  if (ctx.cycleIds.has(task.id)) {
    return { ...base, state: "cycle", reasons: ["in dependency cycle — priority-ordered fallback"] }
  }
  if (blockedDeps.length > 0) {
    return {
      ...base,
      state: "blocked",
      reasons: [
        `waiting on blocked: ${blockedDeps
          .map((dep) => `${dep.title} (${dep.blockReason ?? "no reason given"})`)
          .join(", ")}`,
      ],
    }
  }
  if (unmet.length > 0) {
    return {
      ...base,
      state: "waiting",
      reasons: [`waiting on: ${unmet.map((dep) => dep.title).join(", ")}`],
    }
  }

  const duration = task.estimatedMinutes ?? DEFAULT_DURATION_MINUTES
  if (task.estimatedMinutes === null) {
    base.taskWarnings.push(`no duration — assumed ${DEFAULT_DURATION_MINUTES}m`)
  }

  const shiftEnd = new Date(ctx.shift.endAt).getTime()
  const start = Math.max(ctx.planStart, ctx.cursor())
  const end = start + duration * MINUTE_MS
  const fits = !ctx.shiftEnded && end <= shiftEnd
  if (!fits) {
    base.taskWarnings.push(ctx.shiftEnded ? "shift has ended" : "cannot fit before shift end")
  }

  return {
    ...base,
    state: "ready",
    startAt: new Date(start).toISOString(),
    endAt: fits ? new Date(end).toISOString() : null,
    fits,
    reasons: topFactorLabels(rank),
  }
}

function collect(entry: ScheduledTask, missingDurationIds: string[], cannotFitIds: string[]): void {
  if (entry.task.estimatedMinutes === null && entry.state === "ready") {
    missingDurationIds.push(entry.task.id)
  }
  if (!entry.fits && entry.state === "ready") {
    cannotFitIds.push(entry.task.id)
  }
}

function topFactorLabels(rank: RankedTask): string[] {
  const labels = rank.reason.factors
    .slice()
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((factor) => factor.label)
  if (labels.length === 0) return ["no urgent factors — lowest cost work first"]
  return labels
}
