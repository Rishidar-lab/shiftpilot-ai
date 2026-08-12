import { beforeEach, describe, expect, it } from "vitest"

import { bucketFor, rankTasks } from "./priority.js"
import { NOW, makeTask, resetIds } from "./test-helpers.js"

beforeEach(() => resetIds())

function factorsOf(task: ReturnType<typeof makeTask>, now: Date = NOW) {
  const ranked = rankTasks([task], now)[0]!
  return ranked.reason
}

describe("priority engine: deadline ranking", () => {
  it("ranks the nearer deadline higher", () => {
    const near = makeTask({ id: "near", deadlineAt: "2026-08-12T09:00:00.000Z" })
    const far = makeTask({ id: "far", deadlineAt: "2026-08-12T13:00:00.000Z" })
    const ranked = rankTasks([far, near], NOW)
    expect(ranked[0]!.task.id).toBe("near")
    expect(ranked[0]!.reason.score).toBeGreaterThan(ranked[1]!.reason.score)
  })

  it("attributes a due-soon factor with a human label", () => {
    const reason = factorsOf(makeTask({ id: "due", deadlineAt: "2026-08-12T08:30:00.000Z" }))
    expect(reason.factors.some((f) => f.kind === "deadline" && f.label.includes("due in"))).toBe(
      true,
    )
  })

  it("gives no deadline factor to tasks due far outside the window", () => {
    const far = makeTask({ id: "far", deadlineAt: "2026-08-13T10:00:00.000Z" })
    const reason = factorsOf(far)
    expect(reason.factors.some((f) => f.kind === "deadline" || f.kind === "overdue")).toBe(false)
  })
})

describe("priority engine: overdue ranking", () => {
  it("marks overdue with the fixed score and label", () => {
    const reason = factorsOf(makeTask({ id: "late", deadlineAt: "2026-08-12T07:00:00.000Z" }))
    expect(
      reason.factors.some(
        (f) => f.kind === "overdue" && f.contribution === 50 && f.label.includes("overdue"),
      ),
    ).toBe(true)
    expect(reason.bucket).toBe("critical")
  })

  it("outranks a distant future deadline", () => {
    const overdue = makeTask({
      id: "late",
      deadlineAt: "2026-08-12T07:30:00.000Z",
      explicitUrgency: "none",
    })
    const dueLater = makeTask({
      id: "later",
      deadlineAt: "2026-08-12T13:00:00.000Z",
      explicitUrgency: "none",
    })
    const ranked = rankTasks([dueLater, overdue], NOW)
    expect(ranked[0]!.task.id).toBe("late")
  })
})

describe("priority engine: explicit urgency", () => {
  it("adds an attributable explicit-urgency factor", () => {
    const reason = factorsOf(makeTask({ id: "urg", explicitUrgency: "high" }))
    const factor = reason.factors.find((f) => f.kind === "explicit_urgency")
    expect(factor).toMatchObject({ contribution: 25, label: "explicitly marked high priority" })
  })

  it("lets an urgent task outrank a category-heavy task", () => {
    const urgent = makeTask({ id: "urg", explicitUrgency: "high" })
    const compliance = makeTask({ id: "safety", category: "safety" })
    const ranked = rankTasks([compliance, urgent], NOW)
    expect(ranked[0]!.task.id).toBe("urg")
  })
})

describe("priority engine: dependency blocking and category", () => {
  it("adds an unblocks factor proportional to dependents", () => {
    const root = makeTask({ id: "root" })
    const a = makeTask({ id: "a", dependsOn: ["root"] })
    const b = makeTask({ id: "b", dependsOn: ["root"] })
    const ranked = rankTasks([root, a, b], NOW)[0]!
    const factor = ranked.reason.factors.find((f) => f.kind === "unblocks")
    expect(factor).toMatchObject({ contribution: 10, label: "unblocks 2 tasks" })
  })

  it("weighs category per the documented table", () => {
    const safety = factorsOf(makeTask({ id: "s", category: "safety" }))
    const admin = factorsOf(makeTask({ id: "a", category: "admin" }))
    const safetyFactor = safety.factors.find((f) => f.kind === "category")!
    const adminFactor = admin.factors.find((f) => f.kind === "category")!
    expect(safetyFactor.contribution).toBe(12)
    expect(adminFactor.contribution).toBe(4)
    expect(safety.score).toBeGreaterThan(admin.score)
  })

  it("adds a quick-task bonus for short work", () => {
    const reason = factorsOf(makeTask({ id: "q", estimatedMinutes: 10 }))
    const factor = reason.factors.find((f) => f.kind === "quick")
    expect(factor).toMatchObject({ contribution: 3 })
  })
})

describe("priority engine: equal scores and buckets", () => {
  it("tie-breaks by earlier deadline, then earlier creation, then id", () => {
    const a = makeTask({ id: "a" })
    const b = makeTask({ id: "b" })
    const ranked = rankTasks([b, a], NOW)
    expect(ranked[0]!.task.id).toBe("a") // equal scores: id tiebreak (a < b)
    expect(ranked[0]!.reason.score).toBe(ranked[1]!.reason.score)
  })

  it("is fully deterministic for identical input", () => {
    const tasks = [
      makeTask({ id: "x", deadlineAt: "2026-08-12T10:00:00.000Z" }),
      makeTask({ id: "y", explicitUrgency: "high" }),
      makeTask({ id: "z", category: "customer" }),
    ]
    const first = rankTasks(tasks, NOW)
    const second = rankTasks([...tasks].reverse(), NOW)
    expect(first.map((r) => r.task.id)).toEqual(second.map((r) => r.task.id))
    expect(first.map((r) => r.reason.score)).toEqual(second.map((r) => r.reason.score))
  })

  it("bucket thresholds map scores to buckets as documented", () => {
    expect(bucketFor(70)).toBe("critical")
    expect(bucketFor(55)).toBe("critical")
    expect(bucketFor(54)).toBe("high")
    expect(bucketFor(35)).toBe("high")
    expect(bucketFor(34)).toBe("medium")
    expect(bucketFor(15)).toBe("medium")
    expect(bucketFor(14)).toBe("low")
  })
})
