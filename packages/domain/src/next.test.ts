import { beforeEach, describe, expect, it } from "vitest"

import { decideNext } from "./next.js"
import { NOW, makeShift, makeTask, resetIds } from "./test-helpers.js"

beforeEach(() => resetIds())

describe("decideNext: selection", () => {
  it("selects the highest-ranked runnable task with its reasons", () => {
    const low = makeTask({ id: "low" })
    const urgent = makeTask({ id: "urg", explicitUrgency: "high" })
    const decision = decideNext({ shift: makeShift(), tasks: [low, urgent], now: NOW })
    expect(decision).toMatchObject({ kind: "task", taskId: "urg" })
    if (decision.kind !== "task") return
    expect(decision.reasons.length).toBeGreaterThan(0)
    expect(decision.reasons.join(" ")).toContain("explicitly marked high priority")
    expect(decision.alternatives.map((a) => a.taskId)).toEqual(["low"])
  })

  it("adds a continuity bonus to work already in progress", () => {
    const inProgress = makeTask({ id: "ip", status: "in_progress" })
    const elsewhere = makeTask({ id: "else", explicitUrgency: "medium" })
    const decision = decideNext({ shift: makeShift(), tasks: [elsewhere, inProgress], now: NOW })
    expect(decision).toMatchObject({ kind: "task", taskId: "ip" })
    if (decision.kind !== "task") return
    expect(decision.reasons.join(" ")).toContain("already in progress")
  })

  it("never suggests a task whose dependencies are unfinished", () => {
    const root = makeTask({ id: "root", explicitUrgency: "low" })
    const child = makeTask({ id: "child", explicitUrgency: "critical", dependsOn: ["root"] })
    const decision = decideNext({ shift: makeShift(), tasks: [child, root], now: NOW })
    expect(decision).toMatchObject({ kind: "task", taskId: "root" })
  })
})

describe("decideNext: explicit non-task states", () => {
  it("reports done when nothing remains", () => {
    const done = makeTask({
      id: "done",
      status: "completed",
      completedAt: "2026-08-12T07:00:00.000Z",
    })
    expect(decideNext({ shift: makeShift(), tasks: [done], now: NOW })).toEqual({ kind: "done" })
    expect(decideNext({ shift: makeShift(), tasks: [], now: NOW })).toEqual({ kind: "done" })
  })

  it("reports shift_ended when now is past the shift end", () => {
    const task = makeTask({ id: "a" })
    const decision = decideNext({
      shift: makeShift(),
      tasks: [task],
      now: new Date("2026-08-12T14:30:00.000Z"),
    })
    expect(decision).toEqual({ kind: "shift_ended" })
  })

  it("reports blocked with the blocking titles when nothing is runnable", () => {
    const root = makeTask({
      id: "root",
      title: "root",
      status: "blocked",
      blockReason: "awaiting parts",
    })
    const child = makeTask({ id: "child", dependsOn: ["root"] })
    const decision = decideNext({ shift: makeShift(), tasks: [child, root], now: NOW })
    expect(decision).toMatchObject({ kind: "blocked" })
    if (decision.kind !== "blocked") return
    expect(decision.blockedBy).toContain("root")
    expect(decision.cycleTaskIds).toEqual([])
  })

  it("reports blocked with cycle members when only cyclic work remains", () => {
    const a = makeTask({ id: "a", dependsOn: ["b"] })
    const b = makeTask({ id: "b", dependsOn: ["a"] })
    const decision = decideNext({ shift: makeShift(), tasks: [a, b], now: NOW })
    expect(decision).toMatchObject({ kind: "blocked" })
    if (decision.kind !== "blocked") return
    expect(decision.cycleTaskIds.sort()).toEqual(["a", "b"])
  })

  it("is deterministic for identical input", () => {
    const tasks = [
      makeTask({ id: "a", deadlineAt: "2026-08-12T09:00:00.000Z" }),
      makeTask({ id: "b", explicitUrgency: "medium" }),
    ]
    expect(JSON.stringify(decideNext({ shift: makeShift(), tasks, now: NOW }))).toBe(
      JSON.stringify(decideNext({ shift: makeShift(), tasks: [...tasks].reverse(), now: NOW })),
    )
  })
})
