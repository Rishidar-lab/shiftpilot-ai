import type { PriorityBucket, PriorityFactor, PriorityReason, Task } from "@shiftpilot/contracts"

import { PRIORITY } from "./constants.js"

export interface RankedTask {
  task: Task
  reason: PriorityReason
}

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

/**
 * Deterministic, explainable priority engine (docs/architecture.md §4).
 * NOT machine learning: a weighted sum of attributable factors. Every factor
 * carries a human label so "why is Task A above Task B?" has a concrete answer.
 */
export function rankTasks(tasks: readonly Task[], now: Date): RankedTask[] {
  const nonTerminal = tasks.filter(
    (task) => task.status !== "completed" && task.status !== "cancelled",
  )
  const dependentCounts = countDependents(nonTerminal)

  const ranked = nonTerminal.map((task) => ({
    task,
    reason: scoreTask(task, now, dependentCounts.get(task.id) ?? 0),
  }))

  return [...ranked].sort((a, b) => compareRanked(a, b))
}

/** taskId -> number of non-terminal tasks that depend on it. */
function countDependents(tasks: readonly Task[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      counts.set(dep, (counts.get(dep) ?? 0) + 1)
    }
  }
  return counts
}

export function scoreTask(task: Task, now: Date, dependentCount: number): PriorityReason {
  const factors: PriorityFactor[] = []

  const urgency = PRIORITY.urgency[task.explicitUrgency]
  if (urgency > 0) {
    factors.push({
      kind: "explicit_urgency",
      label: `explicitly marked ${task.explicitUrgency} priority`,
      contribution: urgency,
    })
  }

  if (task.deadlineAt !== null) {
    const minutesLeft = (new Date(task.deadlineAt).getTime() - now.getTime()) / MINUTE_MS
    if (minutesLeft <= 0) {
      factors.push({
        kind: "overdue",
        label: `overdue by ${formatMinutes(Math.round(-minutesLeft))}`,
        contribution: PRIORITY.overdueScore,
      })
    } else {
      const window = PRIORITY.deadlineWindowMinutes
      const proximity = Math.round(
        PRIORITY.deadlineMax * (1 - Math.min(minutesLeft, window) / window),
      )
      if (proximity > 0) {
        factors.push({
          kind: "deadline",
          label: `due in ~${formatMinutes(Math.round(minutesLeft))}`,
          contribution: proximity,
        })
      }
    }
  }

  if (dependentCount > 0) {
    factors.push({
      kind: "unblocks",
      label: dependentCount === 1 ? "unblocks 1 task" : `unblocks ${dependentCount} tasks`,
      contribution: Math.min(PRIORITY.blocksMax, dependentCount * PRIORITY.blocksPerDependent),
    })
  }

  factors.push({
    kind: "category",
    label: `${task.category} impact`,
    contribution: PRIORITY.category[task.category],
  })

  const hoursWaiting = Math.floor(
    Math.max(0, now.getTime() - new Date(task.createdAt).getTime()) / HOUR_MS,
  )
  if (hoursWaiting > 0) {
    factors.push({
      kind: "waiting",
      label: `waiting ${hoursWaiting}h`,
      contribution: Math.min(PRIORITY.waitingMax, hoursWaiting * PRIORITY.waitingPerHour),
    })
  }

  if (task.estimatedMinutes !== null && task.estimatedMinutes <= PRIORITY.quickTaskMaxMinutes) {
    factors.push({
      kind: "quick",
      label: `quick task (≤${PRIORITY.quickTaskMaxMinutes}m)`,
      contribution: PRIORITY.quickTaskScore,
    })
  }

  const score = factors.reduce((sum, factor) => sum + factor.contribution, 0)
  return { score, bucket: bucketFor(score), factors }
}

export function bucketFor(score: number): PriorityBucket {
  if (score >= PRIORITY.bucketCritical) return "critical"
  if (score >= PRIORITY.bucketHigh) return "high"
  if (score >= PRIORITY.bucketMedium) return "medium"
  return "low"
}

/**
 * Total order for equal scores: earlier deadline wins, then earlier createdAt
 * (longer-waiting work), then id (stable, arbitrary, but deterministic).
 */
export function compareRanked(a: RankedTask, b: RankedTask): number {
  const scoreDiff = b.reason.score - a.reason.score
  if (scoreDiff !== 0) return scoreDiff

  const aDeadline = a.task.deadlineAt
  const bDeadline = b.task.deadlineAt
  if (aDeadline !== null && bDeadline !== null) {
    const deadlineDiff = aDeadline.localeCompare(bDeadline)
    if (deadlineDiff !== 0) return deadlineDiff
  } else if (aDeadline !== null) {
    return -1
  } else if (bDeadline !== null) {
    return 1
  }

  const createdDiff = a.task.createdAt.localeCompare(b.task.createdAt)
  if (createdDiff !== 0) return createdDiff
  return a.task.id.localeCompare(b.task.id)
}

/** Human-readable duration, e.g. "45m", "1h05m", "2h". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins}m`
  return mins === 0 ? `${hours}h` : `${hours}h${String(mins).padStart(2, "0")}m`
}
