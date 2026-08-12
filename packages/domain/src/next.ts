import type { NextDecision, Shift, Task } from "@shiftpilot/contracts"

import { PRIORITY } from "./constants.js"
import { dependencyOrder, findCycleMembers, unmetDependencies } from "./graph.js"
import type { TaskGraph } from "./graph.js"
import { compareRanked, rankTasks } from "./priority.js"
import type { RankedTask } from "./priority.js"

const MINUTE_MS = 60_000

export interface NextInput {
  shift: Shift
  tasks: readonly Task[]
  now: Date
  cycleIds?: Set<string>
  graph?: TaskGraph
}

/**
 * Pure-domain "what should I do next?" (docs/architecture.md §4).
 * No AI call. Deterministic: the highest-ranked runnable task, with a
 * continuity bonus for work already in progress. Every non-task outcome is an
 * explicit state: done / blocked / shift_ended — never a silent no-op.
 */
export function decideNext({ shift, tasks, now, cycleIds, graph }: NextInput): NextDecision {
  if (now.getTime() >= new Date(shift.endAt).getTime()) {
    return { kind: "shift_ended" }
  }

  const byId = graph?.byId ?? new Map(tasks.map((task) => [task.id, task]))
  const done =
    graph?.done ??
    new Set(
      tasks
        .filter((task) => task.status === "completed" || task.status === "cancelled")
        .map((task) => task.id),
    )
  const taskGraph: TaskGraph = graph ?? { byId, done }

  const ranked = rankTasks(tasks, now)
  const active = ranked.filter(
    (entry) => entry.task.status === "active" || entry.task.status === "in_progress",
  )
  const cyclic =
    cycleIds ?? findCycleMembers(dependencyOrder(active, taskGraph).leftover, taskGraph)
  const runnable = active.filter(
    (entry) => !cyclic.has(entry.task.id) && entry.task.dependsOn.every((dep) => done.has(dep)),
  )

  if (runnable.length === 0) {
    if (tasks.every((task) => done.has(task.id) || task.status === "draft")) {
      return { kind: "done" }
    }
    const waiting = tasks.filter(
      (task) =>
        !done.has(task.id) &&
        !cyclic.has(task.id) &&
        task.status !== "draft" &&
        task.status !== "blocked",
    )
    const blockedBy = new Set<string>()
    for (const task of waiting) {
      for (const dep of unmetDependencies(task, taskGraph)) {
        if (!done.has(dep.id)) blockedBy.add(dep.title)
      }
    }
    return { kind: "blocked", blockedBy: [...blockedBy], cycleTaskIds: [...cyclic] }
  }

  const scored = runnable.map((entry) => ({
    entry,
    effective:
      entry.reason.score + (entry.task.status === "in_progress" ? PRIORITY.continuityBonus : 0),
  }))
  scored.sort((a, b) => {
    const diff = b.effective - a.effective
    if (diff !== 0) return diff
    return compareRanked(a.entry, b.entry)
  })

  const best = scored[0]!
  const alternatives = scored.slice(1, 3)
  const reasons = [
    ...(best.entry.task.status === "in_progress"
      ? ["continuing: this task is already in progress"]
      : []),
    ...topFactorLabels(best.entry),
  ].slice(0, 3)

  return {
    kind: "task",
    taskId: best.entry.task.id,
    title: best.entry.task.title,
    startAt: now.toISOString(),
    reasons,
    alternatives: alternatives.map(({ entry }) => ({
      taskId: entry.task.id,
      title: entry.task.title,
    })),
  }
}

/** Whole minutes between now and a future ISO timestamp (negative if past). */
export function minutesUntil(target: string, now: Date): number {
  return Math.round((new Date(target).getTime() - now.getTime()) / MINUTE_MS)
}

function topFactorLabels(rank: RankedTask): string[] {
  return rank.reason.factors
    .slice()
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((factor) => factor.label)
}
