import { beforeEach, describe, expect, it } from "vitest"

import { decideNext } from "./next.js"
import { planShift } from "./schedule.js"
import { effectivePlanningStart, resolveDeadlineHint } from "./time.js"
import { makeShift, makeTask, resetIds } from "./test-helpers.js"

beforeEach(() => resetIds())

/**
 * Planning-horizon correctness (P0 fix): the scheduler, capacity and What Next
 * must clamp the schedulable window to the shift's own bounds. Before a shift
 * starts, planning begins at shiftStart — not at pre-shift wall-clock time —
 * so a 09:00–17:00 shift planned at 02:55 has 480 minutes of capacity and its
 * first task at 09:00, never 845 minutes and a task at 02:54.
 */

// A UTC "09:00–17:00" shift on 2026-08-20 (uses UTC so the boundary math in the
// assertions is unambiguous; a timezone-specific case is covered separately).
function shift0900to1700(date = "2026-08-20") {
  return makeShift({
    id: "shift-h",
    date,
    startAt: `${date}T09:00:00.000Z`,
    endAt: `${date}T17:00:00.000Z`,
    timezone: "UTC",
  })
}

const SHIFT_START_MS = new Date("2026-08-20T09:00:00.000Z").getTime()
const SHIFT_END_MS = new Date("2026-08-20T17:00:00.000Z").getTime()

function twoNormalTasks() {
  return [
    makeTask({ id: "t1", shiftId: "shift-h", estimatedMinutes: 30 }),
    makeTask({ id: "t2", shiftId: "shift-h", estimatedMinutes: 20 }),
  ]
}

describe("effectivePlanningStart: canonical horizon", () => {
  const shift = shift0900to1700()

  it("clamps a pre-shift now up to shiftStart", () => {
    const start = effectivePlanningStart(shift, new Date("2026-08-20T02:55:00.000Z"))
    expect(start.toISOString()).toBe("2026-08-20T09:00:00.000Z")
  })

  it("returns now during the shift", () => {
    const start = effectivePlanningStart(shift, new Date("2026-08-20T11:00:00.000Z"))
    expect(start.toISOString()).toBe("2026-08-20T11:00:00.000Z")
  })

  it("clamps a post-shift now down to shiftEnd", () => {
    const start = effectivePlanningStart(shift, new Date("2026-08-20T18:00:00.000Z"))
    expect(start.toISOString()).toBe("2026-08-20T17:00:00.000Z")
  })

  it("returns shiftStart exactly at shiftStart, shiftEnd exactly at shiftEnd", () => {
    expect(effectivePlanningStart(shift, new Date(SHIFT_START_MS)).getTime()).toBe(SHIFT_START_MS)
    expect(effectivePlanningStart(shift, new Date(SHIFT_END_MS)).getTime()).toBe(SHIFT_END_MS)
  })
})

describe("planning horizon: BEFORE shift (the demo bug)", () => {
  const now = new Date("2026-08-20T02:55:00.000Z") // 02:55, shift starts 09:00

  it("caps capacity at the full shift length, never (end - now)", () => {
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    // 17:00 - 09:00 = 480, NOT 17:00 - 02:55 = 845
    expect(plan.load.availableMinutes).toBe(480)
  })

  it("schedules the first task at shiftStart, not at pre-shift wall-clock", () => {
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    const first = plan.sequence[0]!
    expect(first.startAt).toBe("2026-08-20T09:00:00.000Z")
    expect(new Date(first.startAt!).getTime()).toBeGreaterThanOrEqual(SHIFT_START_MS)
  })

  it("never positions any scheduled task before shiftStart", () => {
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    for (const entry of plan.sequence) {
      if (entry.fits && entry.startAt) {
        expect(new Date(entry.startAt).getTime()).toBeGreaterThanOrEqual(SHIFT_START_MS)
      }
      if (entry.fits && entry.endAt) {
        expect(new Date(entry.endAt).getTime()).toBeLessThanOrEqual(SHIFT_END_MS)
      }
    }
  })

  it("What Next proposes a start at shiftStart, not an impossible 02:55", () => {
    const decision = decideNext({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    expect(decision.kind).toBe("task")
    if (decision.kind !== "task") return
    expect(decision.startAt).toBe("2026-08-20T09:00:00.000Z")
    expect(new Date(decision.startAt!).getTime()).toBeGreaterThanOrEqual(SHIFT_START_MS)
  })
})

describe("planning horizon: DURING shift (unchanged)", () => {
  const now = new Date("2026-08-20T11:00:00.000Z")

  it("plans from now and reports remaining capacity", () => {
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    expect(plan.sequence[0]!.startAt).toBe("2026-08-20T11:00:00.000Z")
    expect(plan.load.availableMinutes).toBe(360) // 17:00 - 11:00
  })

  it("What Next proposes a start at now", () => {
    const decision = decideNext({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    if (decision.kind !== "task") throw new Error("expected task")
    expect(decision.startAt).toBe("2026-08-20T11:00:00.000Z")
  })
})

describe("planning horizon: AFTER shift", () => {
  const now = new Date("2026-08-20T18:00:00.000Z")

  it("has zero remaining capacity and marks the shift ended", () => {
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    expect(plan.load.availableMinutes).toBe(0)
    expect(plan.warnings).toContainEqual({ type: "shift_ended" })
    expect(plan.sequence.every((s) => s.fits === false)).toBe(true)
    expect(plan.next).toEqual({ kind: "shift_ended" })
  })
})

describe("planning horizon: future and past shift dates", () => {
  it("future shift: planning starts at the future shiftStart", () => {
    const now = new Date("2026-08-19T05:00:00.000Z") // day before the shift
    const plan = planShift({ shift: shift0900to1700("2026-08-20"), tasks: twoNormalTasks(), now })
    expect(plan.load.availableMinutes).toBe(480)
    expect(plan.sequence[0]!.startAt).toBe("2026-08-20T09:00:00.000Z")
    const decision = decideNext({
      shift: shift0900to1700("2026-08-20"),
      tasks: twoNormalTasks(),
      now,
    })
    if (decision.kind !== "task") throw new Error("expected task")
    expect(decision.startAt).toBe("2026-08-20T09:00:00.000Z")
  })

  it("past shift: no remaining capacity, no new scheduling inside the expired shift", () => {
    const now = new Date("2026-08-21T10:00:00.000Z") // day after the shift
    const plan = planShift({ shift: shift0900to1700("2026-08-20"), tasks: twoNormalTasks(), now })
    expect(plan.load.availableMinutes).toBe(0)
    expect(plan.warnings).toContainEqual({ type: "shift_ended" })
    expect(plan.next).toEqual({ kind: "shift_ended" })
  })
})

describe("planning horizon: exact boundaries", () => {
  it("exact shift start: planning starts at shiftStart, full capacity", () => {
    const now = new Date(SHIFT_START_MS)
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    expect(plan.load.availableMinutes).toBe(480)
    expect(plan.sequence[0]!.startAt).toBe("2026-08-20T09:00:00.000Z")
  })

  it("exact shift end: zero schedulable window", () => {
    const now = new Date(SHIFT_END_MS)
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    expect(plan.load.availableMinutes).toBe(0)
    expect(plan.warnings).toContainEqual({ type: "shift_ended" })
  })

  it("one minute before start: planning starts at shiftStart", () => {
    const now = new Date(SHIFT_START_MS - 60_000)
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    expect(plan.load.availableMinutes).toBe(480)
    expect(plan.sequence[0]!.startAt).toBe("2026-08-20T09:00:00.000Z")
  })

  it("one minute before end: about one minute of capacity", () => {
    const now = new Date(SHIFT_END_MS - 60_000)
    const plan = planShift({ shift: shift0900to1700(), tasks: twoNormalTasks(), now })
    expect(plan.load.availableMinutes).toBe(1)
  })
})

describe("planning horizon: capacity invariant", () => {
  it("keeps 0 <= availableMinutes <= totalShiftDuration for any now", () => {
    const total = 480
    const nows = [
      "2026-08-18T00:00:00.000Z", // long before
      "2026-08-20T02:55:00.000Z", // the demo case
      "2026-08-20T09:00:00.000Z", // exact start
      "2026-08-20T13:00:00.000Z", // mid shift
      "2026-08-20T17:00:00.000Z", // exact end
      "2026-08-25T00:00:00.000Z", // long after
    ]
    for (const iso of nows) {
      const plan = planShift({
        shift: shift0900to1700(),
        tasks: twoNormalTasks(),
        now: new Date(iso),
      })
      expect(plan.load.availableMinutes).toBeGreaterThanOrEqual(0)
      expect(plan.load.availableMinutes).toBeLessThanOrEqual(total)
    }
  })
})

describe("planning horizon: timezone correctness (Asia/Kolkata) and deadlines unchanged", () => {
  // 09:00–17:00 IST on 2026-08-20 == 03:30Z–11:30Z. Now = 02:55 IST == 2026-08-19T21:25:00Z.
  const istShift = makeShift({
    id: "shift-ist",
    date: "2026-08-20",
    startAt: "2026-08-20T03:30:00.000Z",
    endAt: "2026-08-20T11:30:00.000Z",
    timezone: "Asia/Kolkata",
  })
  const nowBeforeIst = new Date("2026-08-19T21:25:00.000Z") // 02:55 IST

  it("clamps a pre-shift IST now to IST shiftStart (480m, first task 03:30Z)", () => {
    const tasks = [makeTask({ id: "k1", shiftId: "shift-ist", estimatedMinutes: 30 })]
    const plan = planShift({ shift: istShift, tasks, now: nowBeforeIst })
    expect(plan.load.availableMinutes).toBe(480)
    expect(plan.sequence[0]!.startAt).toBe("2026-08-20T03:30:00.000Z")
  })

  it("'by 2pm' still resolves to 14:00 in the shift's local timezone", () => {
    const res = resolveDeadlineHint("by 2pm", istShift, nowBeforeIst)
    expect(res.status).toBe("resolved")
    if (res.status !== "resolved") return
    // 14:00 IST == 08:30 UTC
    expect(res.deadlineAt).toBe("2026-08-20T08:30:00.000Z")
  })

  it("a task deadline before shift start is not scheduled at pre-shift wall-clock", () => {
    // deadline 08:30 IST (03:00Z), shift starts 09:00 IST (03:30Z); now 02:55 IST.
    const tasks = [
      makeTask({
        id: "early",
        shiftId: "shift-ist",
        estimatedMinutes: 30,
        deadlineAt: "2026-08-20T03:00:00.000Z",
      }),
    ]
    const plan = planShift({ shift: istShift, tasks, now: nowBeforeIst })
    const first = plan.sequence[0]!
    // Represented via existing semantics, but never positioned before shiftStart.
    if (first.startAt) {
      expect(new Date(first.startAt).getTime()).toBeGreaterThanOrEqual(
        new Date("2026-08-20T03:30:00.000Z").getTime(),
      )
    }
  })
})
