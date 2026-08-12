import { beforeEach, describe, expect, it } from "vitest"

import { buildHandoverFacts } from "./handover.js"
import { NOW, makeShift, makeTask, resetIds } from "./test-helpers.js"

beforeEach(() => resetIds())

describe("buildHandoverFacts", () => {
  it("counts statuses and lists completed work with timestamps", () => {
    const done = makeTask({
      id: "done",
      status: "completed",
      completedAt: "2026-08-12T07:30:00.000Z",
      title: "Cold chain check",
    })
    const cancelled = makeTask({ id: "gone", status: "cancelled", title: "Reorder labels" })
    const pending = makeTask({ id: "todo", title: "Counts" })
    const facts = buildHandoverFacts({
      shift: makeShift(),
      tasks: [done, cancelled, pending],
      now: NOW,
    })
    expect(facts.counts).toMatchObject({
      total: 3,
      active: 1,
      inProgress: 0,
      completed: 1,
      blocked: 0,
      cancelled: 1,
      overdue: 0,
      waiting: 0,
    })
    expect(facts.completed).toEqual([
      { taskId: "done", title: "Cold chain check", completedAt: "2026-08-12T07:30:00.000Z" },
    ])
    expect(facts.pending.map((p) => p.taskId)).toEqual(["todo"])
  })

  it("surfaces overdue work with minutes and upcoming deadlines with due-in", () => {
    const late = makeTask({
      id: "late",
      title: "Unfreeze walk-in",
      deadlineAt: "2026-08-12T07:00:00.000Z",
    })
    const soon = makeTask({
      id: "soon",
      title: "Call Mrs Chen",
      deadlineAt: "2026-08-12T08:45:00.000Z",
    })
    const far = makeTask({
      id: "far",
      title: "Training video",
      deadlineAt: "2026-08-12T12:00:00.000Z",
    })
    const facts = buildHandoverFacts({ shift: makeShift(), tasks: [late, soon, far], now: NOW })
    expect(facts.counts.overdue).toBe(1)
    expect(facts.overdue).toEqual([{ taskId: "late", title: "Unfreeze walk-in", overdueMin: 60 }])
    expect(facts.upcomingDeadlines.map((d) => d.taskId)).toEqual(["soon", "far"])
    expect(facts.upcomingDeadlines[0]).toMatchObject({ taskId: "soon", dueInMin: 45 })
  })

  it("lists blocked work with blocking titles", () => {
    const root = makeTask({
      id: "root",
      title: "Install shelving",
      status: "blocked",
      blockReason: "awaiting parts",
    })
    const child = makeTask({ id: "child", title: "Stock aisle 3", dependsOn: ["root"] })
    const facts = buildHandoverFacts({ shift: makeShift(), tasks: [root, child], now: NOW })
    expect(facts.blocked.map((b) => b.title)).toEqual(["Install shelving", "Stock aisle 3"])
    expect(facts.blocked[1]!.blockedBy).toEqual(["Install shelving"])
  })

  it("exposes warnings and next-shift recommendations without fabricating prose", () => {
    const a = makeTask({ id: "a", estimatedMinutes: 300 })
    const b = makeTask({ id: "b", estimatedMinutes: 240 })
    const facts = buildHandoverFacts({ shift: makeShift(), tasks: [a, b], now: NOW })
    expect(facts.warnings).toContainEqual({ type: "cannot_fit", taskIds: ["b"] })
    expect(facts.recommendations.map((r) => r.taskId)).toEqual(["a", "b"])
  })

  it("is deterministic for identical input", () => {
    const tasks = [
      makeTask({ id: "x", estimatedMinutes: 30, deadlineAt: "2026-08-12T10:00:00.000Z" }),
      makeTask({ id: "y", status: "in_progress", title: "Restock aisle 3" }),
    ]
    expect(JSON.stringify(buildHandoverFacts({ shift: makeShift(), tasks, now: NOW }))).toBe(
      JSON.stringify(
        buildHandoverFacts({ shift: makeShift(), tasks: [...tasks].reverse(), now: NOW }),
      ),
    )
  })
})
