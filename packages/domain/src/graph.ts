import type { Task } from "@shiftpilot/contracts"

import { compareRanked } from "./priority.js"
import type { RankedTask } from "./priority.js"

export interface TaskGraph {
  byId: Map<string, Task>
  /** task ids that are terminal (completed/cancelled) — dependencies never block on them. */
  done: Set<string>
}

/**
 * Priority-Kahn layering: repeatedly lay out the highest-ranked task whose
 * dependencies are already laid out or terminal. Remaining tasks are returned
 * as `leftover` (their dependencies cannot be satisfied within the remaining
 * set — either a cycle or a dependency on an excluded task such as a draft).
 */
export function dependencyOrder(
  ranked: readonly RankedTask[],
  graph: TaskGraph,
): {
  picked: RankedTask[]
  leftover: RankedTask[]
} {
  const remaining = new Map(ranked.map((entry) => [entry.task.id, entry]))
  const picked: RankedTask[] = []

  // Reverse adjacency within the ranked set: for each task id, the ranked
  // tasks that depend on it. Used to compute an "unlock value" so that a
  // lower-priority task which releases a high-priority dependency is placed
  // early (e.g. `a` unlocks high-urgency `c`, so `a` precedes an otherwise
  // higher-ranked independent `b`).
  const dependents = new Map<string, RankedTask[]>()
  for (const entry of ranked) {
    for (const dep of entry.task.dependsOn) {
      const list = dependents.get(dep) ?? []
      list.push(entry)
      dependents.set(dep, list)
    }
  }

  const unlockValue = (entry: RankedTask): number => {
    let bestDependent = 0
    for (const dependent of dependents.get(entry.task.id) ?? []) {
      if (remaining.has(dependent.task.id)) {
        bestDependent = Math.max(bestDependent, dependent.reason.score)
      }
    }
    return entry.reason.score + bestDependent
  }

  while (remaining.size > 0) {
    const done = new Set([...graph.done, ...picked.map((entry) => entry.task.id)])
    const available = [...remaining.values()].filter((entry) =>
      entry.task.dependsOn.every((dep) => done.has(dep)),
    )
    if (available.length === 0) break

    available.sort((x, y) => unlockValue(y) - unlockValue(x) || compareRanked(x, y))
    const best = available[0]!
    picked.push(best)
    remaining.delete(best.task.id)
  }

  const leftover = ranked.filter((entry) => remaining.has(entry.task.id))
  return { picked, leftover }
}

/**
 * Task ids that sit on a dependency cycle within the leftover set (Tarjan SCC
 * over dependency edges inside the leftover subgraph; SCC of size >1 or a
 * self-loop counts). Remaining leftover tasks are not cyclic — they wait on
 * excluded tasks (e.g. unapproved drafts).
 */
export function findCycleMembers(entries: readonly RankedTask[], graph: TaskGraph): Set<string> {
  const ids = new Set(entries.map((entry) => entry.task.id))
  if (ids.size === 0) return new Set()

  const index = new Map<string, number>()
  const lowLink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cyclic = new Set<string>()
  let counter = 0

  const strongConnect = (nodeId: string): void => {
    index.set(nodeId, counter)
    lowLink.set(nodeId, counter)
    counter += 1
    stack.push(nodeId)
    onStack.add(nodeId)

    const task = graph.byId.get(nodeId)
    for (const dep of task?.dependsOn.filter((id) => ids.has(id)) ?? []) {
      if (!index.has(dep)) {
        strongConnect(dep)
        lowLink.set(nodeId, Math.min(lowLink.get(nodeId)!, lowLink.get(dep)!))
      } else if (onStack.has(dep)) {
        lowLink.set(nodeId, Math.min(lowLink.get(nodeId)!, index.get(dep)!))
      }
    }

    if (lowLink.get(nodeId) === index.get(nodeId)) {
      const component: string[] = []
      let member: string | undefined
      do {
        member = stack.pop()
        if (member === undefined) break
        onStack.delete(member)
        component.push(member)
      } while (member !== nodeId)

      const isSelfLoop =
        component.length === 1 && graph.byId.get(component[0]!)?.dependsOn.includes(component[0]!)
      if (component.length > 1 || isSelfLoop) {
        for (const id of component) cyclic.add(id)
      }
    }
  }

  for (const id of ids) {
    if (!index.has(id)) strongConnect(id)
  }
  return cyclic
}

/** Dependency tasks that are not terminal (completed/cancelled). */
export function unmetDependencies(task: Task, graph: TaskGraph): Task[] {
  return task.dependsOn
    .filter((id) => !graph.done.has(id))
    .map((id) => graph.byId.get(id))
    .filter((dep): dep is Task => dep !== undefined)
}
