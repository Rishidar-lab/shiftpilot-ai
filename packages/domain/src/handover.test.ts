import { beforeEach, describe, expect, it } from "vitest"

import { buildHandoverFacts, normalizeHandoverNarrative } from "./handover.js"
import { NOW, makeShift, makeTask, resetIds } from "./test-helpers.js"

beforeEach(() => resetIds())

/** A facts snapshot with one completed and one overdue task to reference. */
function factsWithTwoTasks() {
  return buildHandoverFacts({
    shift: makeShift(),
    tasks: [
      makeTask({ id: "done-1", status: "completed", completedAt: "2026-08-12T07:00:00.000Z" }),
      makeTask({ id: "late-1", deadlineAt: "2026-08-12T07:00:00.000Z" }),
    ],
    now: NOW,
  })
}

function narrative(over: Record<string, unknown> = {}) {
  return {
    headline: "Steady shift",
    summary: "Most of the list cleared; one item is running late.",
    attention: [{ taskId: "late-1", why: "Past its deadline." }],
    ...over,
  }
}

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

describe("normalizeHandoverNarrative", () => {
  it("accepts prose that only references tasks present in the facts", () => {
    const outcome = normalizeHandoverNarrative(narrative(), factsWithTwoTasks())
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.narrative.attention[0]!.taskId).toBe("late-1")
  })

  it("rejects the whole narrative when it references an unknown task", () => {
    const outcome = normalizeHandoverNarrative(
      narrative({ attention: [{ taskId: "task-that-never-existed", why: "Invented." }] }),
      factsWithTwoTasks(),
    )
    expect(outcome).toMatchObject({ ok: false, reason: "unknown_task_reference" })
  })

  it("rejects a narrative that mixes one real and one invented reference", () => {
    // Partial credit would let a hallucinated id through by pairing it with a
    // real one. One bad reference discredits the whole draft.
    const outcome = normalizeHandoverNarrative(
      narrative({
        attention: [
          { taskId: "late-1", why: "Past its deadline." },
          { taskId: "ghost", why: "Does not exist." },
        ],
      }),
      factsWithTwoTasks(),
    )
    expect(outcome).toMatchObject({ ok: false, reason: "unknown_task_reference" })
  })

  it("rejects extra fields, so a model cannot smuggle in its own numbers", () => {
    const outcome = normalizeHandoverNarrative(
      narrative({ completedCount: 12, generatedAt: "2026-01-01T00:00:00.000Z" }),
      factsWithTwoTasks(),
    )
    expect(outcome).toMatchObject({ ok: false, reason: "invalid_narrative" })
  })

  it("rejects oversized prose rather than truncating it", () => {
    const outcome = normalizeHandoverNarrative(
      narrative({ summary: "x".repeat(1201) }),
      factsWithTwoTasks(),
    )
    expect(outcome).toMatchObject({ ok: false, reason: "invalid_narrative" })
  })

  it("rejects more than five attention items", () => {
    const facts = factsWithTwoTasks()
    const outcome = normalizeHandoverNarrative(
      narrative({
        attention: Array.from({ length: 6 }, () => ({ taskId: "late-1", why: "Late." })),
      }),
      facts,
    )
    expect(outcome).toMatchObject({ ok: false, reason: "invalid_narrative" })
  })

  it.each([null, undefined, "a string", 42, [], { headline: "only" }])(
    "rejects malformed payload %s",
    (payload) => {
      const outcome = normalizeHandoverNarrative(payload, factsWithTwoTasks())
      expect(outcome).toMatchObject({ ok: false, reason: "invalid_narrative" })
    },
  )

  it("never mutates the facts it validates against", () => {
    const facts = factsWithTwoTasks()
    const before = JSON.stringify(facts)
    normalizeHandoverNarrative(narrative(), facts)
    normalizeHandoverNarrative(narrative({ attention: [{ taskId: "ghost", why: "x" }] }), facts)
    expect(JSON.stringify(facts)).toBe(before)
  })
})
