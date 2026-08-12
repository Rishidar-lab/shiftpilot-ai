import { beforeEach, describe, expect, it } from "vitest"

import { planShift } from "./schedule.js"
import { NOW, makeShift, makeTask, resetIds } from "./test-helpers.js"

beforeEach(() => resetIds())

function planFor(...tasks: ReturnType<typeof makeTask>[]) {
  return planShift({ shift: makeShift(), tasks, now: NOW })
}

describe("scheduler: ordering", () => {
  it("orders dependents after the tasks they depend on", () => {
    const root = makeTask({ id: "root" })
    const child = makeTask({ id: "child", dependsOn: ["root"] })
    const plan = planFor(child, root)
    expect(plan.sequence.map((s) => s.task.id)).toEqual(["root", "child"])
  })

  it("breaks equal-priority dependency order by rank (priority-Kahn)", () => {
    const a = makeTask({ id: "a" })
    const b = makeTask({ id: "b" })
    const c = makeTask({ id: "c", explicitUrgency: "high", dependsOn: ["a"] })
    const plan = planFor(c, a, b)
    // a must precede c; the rest is rank-ordered
    expect(plan.sequence.map((s) => s.task.id)).toEqual(["a", "c", "b"])
  })
})

describe("scheduler: cycles", () => {
  it("flags a dependency cycle and keeps the tasks visible with a warning", () => {
    const a = makeTask({ id: "a", dependsOn: ["b"] })
    const b = makeTask({ id: "b", dependsOn: ["a"] })
    const plan = planFor(a, b)
    expect(plan.warnings).toContainEqual({
      type: "dependency_cycle",
      taskIds: expect.arrayContaining(["a", "b"]),
    })
    const cyclic = plan.sequence.filter((s) => s.state === "cycle")
    expect(cyclic.map((s) => s.task.id).sort()).toEqual(["a", "b"])
    expect(cyclic.every((s) => s.fits === false)).toBe(true)
  })

  it("flags a self-dependency as a cycle", () => {
    const a = makeTask({ id: "a", dependsOn: ["a"] })
    const plan = planFor(a)
    expect(plan.sequence[0]).toMatchObject({ state: "cycle" })
    expect(plan.warnings.some((w) => w.type === "dependency_cycle")).toBe(true)
  })
})

describe("scheduler: workload and slots", () => {
  it("schedules tasks that fit into sequential time slots from now", () => {
    const a = makeTask({ id: "a", estimatedMinutes: 60 })
    const b = makeTask({ id: "b", estimatedMinutes: 30 })
    const plan = planFor(a, b)
    const sa = plan.sequence[0]!
    const sb = plan.sequence[1]!
    expect(sa.startAt).toBe(NOW.toISOString())
    expect(sb.startAt).toBe("2026-08-12T09:00:00.000Z")
    expect(sa.fits).toBe(true)
    expect(sb.fits).toBe(true)
  })

  it("flags tasks that cannot fit before shift end, without dropping them", () => {
    const a = makeTask({ id: "a", estimatedMinutes: 300 })
    const b = makeTask({ id: "b", estimatedMinutes: 240 })
    const plan = planFor(a, b)
    const sa = plan.sequence[0]!
    const sb = plan.sequence[1]!
    expect(sa.fits).toBe(true) // 08:00 + 5h = 13:00
    expect(sb.fits).toBe(false)
    expect(sb.taskWarnings).toContain("cannot fit before shift end")
    expect(plan.warnings).toContainEqual({ type: "cannot_fit", taskIds: ["b"] })
  })

  it("reports missing duration: assumes the documented default and warns", () => {
    const a = makeTask({ id: "a", estimatedMinutes: null })
    const plan = planFor(a)
    expect(plan.sequence[0]).toMatchObject({
      state: "ready",
      startAt: NOW.toISOString(),
      endAt: "2026-08-12T08:15:00.000Z",
      fits: true,
    })
    expect(plan.warnings).toContainEqual({ type: "missing_duration", taskIds: ["a"] })
  })

  it("reports workload minutes honestly", () => {
    const a = makeTask({ id: "a", estimatedMinutes: 120 })
    const b = makeTask({ id: "b", estimatedMinutes: null })
    const plan = planFor(a, b)
    expect(plan.load).toEqual({ availableMinutes: 360, scheduledMinutes: 135 })
  })
})

describe("scheduler: terminal and excluded tasks", () => {
  it("moves completed and cancelled tasks out of the sequence", () => {
    const done = makeTask({
      id: "done",
      status: "completed",
      completedAt: "2026-08-12T07:00:00.000Z",
    })
    const cancelled = makeTask({ id: "gone", status: "cancelled" })
    const active = makeTask({ id: "todo" })
    const plan = planFor(done, cancelled, active)
    expect(plan.sequence.map((s) => s.task.id)).toEqual(["todo"])
    expect(plan.completedTasks.map((t) => t.id)).toEqual(["done"])
    expect(plan.cancelledTasks.map((t) => t.id)).toEqual(["gone"])
  })

  it("excludes unapproved drafts with an explicit warning", () => {
    const draft = makeTask({ id: "d", status: "draft" })
    const plan = planFor(draft)
    expect(plan.sequence).toEqual([])
    expect(plan.warnings).toContainEqual({ type: "draft_not_approved", taskIds: ["d"] })
  })

  it("handles a completely empty workload", () => {
    const plan = planFor()
    expect(plan.warnings).toContainEqual({ type: "empty_workload" })
    expect(plan.next).toEqual({ kind: "done" })
  })
})

describe("scheduler: shift boundaries", () => {
  it("treats a shift that has already ended as unschedulable but visible", () => {
    const plan = planShift({
      shift: makeShift(),
      tasks: [makeTask({ id: "a" })],
      now: new Date("2026-08-12T15:00:00.000Z"),
    })
    expect(plan.warnings).toContainEqual({ type: "shift_ended" })
    expect(plan.sequence[0]).toMatchObject({ state: "ready", fits: false })
    expect(plan.sequence[0]!.taskWarnings).toContain("shift has ended")
    expect(plan.next).toEqual({ kind: "shift_ended" })
    expect(plan.load.availableMinutes).toBe(0)
  })
})

describe("scheduler: blocked and waiting work", () => {
  it("marks tasks waiting on unfinished dependencies", () => {
    const root = makeTask({ id: "root" })
    const child = makeTask({ id: "child", dependsOn: ["root"] })
    const plan = planFor(child, root)
    expect(plan.sequence.map((s) => s.state)).toEqual(["ready", "waiting"])
    expect(plan.sequence[1]!.reasons[0]).toContain("waiting on")
  })

  it("marks tasks blocked by a blocked dependency and propagates the reason", () => {
    const root = makeTask({ id: "root", status: "blocked", blockReason: "awaiting parts" })
    const child = makeTask({ id: "child", dependsOn: ["root"] })
    const plan = planFor(child, root)
    expect(plan.sequence[0]).toMatchObject({ state: "blocked" })
    expect(plan.sequence[1]).toMatchObject({ state: "blocked" })
    expect(plan.sequence[1]!.reasons[0]).toContain("awaiting parts")
  })

  it("keeps manually blocked tasks with their reason", () => {
    const a = makeTask({ id: "a", status: "blocked", blockReason: "waiting for manager" })
    const plan = planFor(a)
    expect(plan.sequence[0]).toMatchObject({ state: "blocked", fits: false })
    expect(plan.sequence[0]!.reasons[0]).toBe("blocked: waiting for manager")
  })
})

describe("scheduler: determinism", () => {
  it("produces byte-identical plans for identical input regardless of insertion order", () => {
    const tasks = [
      makeTask({ id: "a", estimatedMinutes: 30, deadlineAt: "2026-08-12T10:00:00.000Z" }),
      makeTask({ id: "b", estimatedMinutes: 60, explicitUrgency: "high", dependsOn: ["a"] }),
      makeTask({ id: "c", estimatedMinutes: 15, category: "safety", dependsOn: ["b"] }),
      makeTask({ id: "d", estimatedMinutes: 45 }),
      makeTask({ id: "e", estimatedMinutes: null, status: "blocked", blockReason: "waiting" }),
    ]
    const first = planFor(...tasks)
    const second = planFor(...[...tasks].reverse())
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})
