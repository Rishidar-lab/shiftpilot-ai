import { describe, expect, it } from "vitest"

import { resolveDeadlineHint, zoneOffsetMinutes, zonedWallClockToUtc } from "./time.js"

const NOW = new Date("2026-08-12T08:00:00.000Z")

function shift(timezone: string, date = "2026-08-12") {
  return {
    id: "shift-1",
    date,
    startAt: `${date}T00:00:00.000Z`,
    endAt: `${date}T23:00:00.000Z`,
    timezone,
  }
}

describe("zone conversion", () => {
  it("reports the offset in force at an instant", () => {
    expect(zoneOffsetMinutes("UTC", Date.UTC(2026, 7, 12))).toBe(0)
    expect(zoneOffsetMinutes("Asia/Kolkata", Date.UTC(2026, 7, 12))).toBe(330)
    // Europe/London is UTC+1 in August (BST) and UTC+0 in January.
    expect(zoneOffsetMinutes("Europe/London", Date.UTC(2026, 7, 12))).toBe(60)
    expect(zoneOffsetMinutes("Europe/London", Date.UTC(2026, 0, 12))).toBe(0)
  })

  it("maps a wall clock to the instant that zone reads it", () => {
    expect(zonedWallClockToUtc(2026, 8, 12, 14, 0, "UTC").toISOString()).toBe(
      "2026-08-12T14:00:00.000Z",
    )
    expect(zonedWallClockToUtc(2026, 8, 12, 14, 0, "Asia/Kolkata").toISOString()).toBe(
      "2026-08-12T08:30:00.000Z",
    )
    expect(zonedWallClockToUtc(2026, 8, 12, 14, 0, "America/New_York").toISOString()).toBe(
      "2026-08-12T18:00:00.000Z",
    )
  })

  it("stays correct across a DST boundary", () => {
    // 14:00 London is 13:00 UTC in summer and 14:00 UTC in winter.
    expect(zonedWallClockToUtc(2026, 8, 12, 14, 0, "Europe/London").toISOString()).toBe(
      "2026-08-12T13:00:00.000Z",
    )
    expect(zonedWallClockToUtc(2026, 1, 12, 14, 0, "Europe/London").toISOString()).toBe(
      "2026-01-12T14:00:00.000Z",
    )
  })
})

describe("resolveDeadlineHint", () => {
  it("returns none when the worker stated no deadline", () => {
    expect(resolveDeadlineHint(null, shift("UTC"), NOW)).toEqual({ status: "none" })
    expect(resolveDeadlineHint("   ", shift("UTC"), NOW)).toEqual({ status: "none" })
  })

  // Regression — audit A-20: "by 2pm" was stamped as 14:00Z regardless of where
  // the shift actually is, so every non-UTC deployment planned against the
  // wrong instant.
  it("interprets a clock time in the SHIFT's zone, not the server's", () => {
    const kolkata = resolveDeadlineHint("2pm", shift("Asia/Kolkata"), NOW)
    expect(kolkata).toEqual({ status: "resolved", deadlineAt: "2026-08-12T08:30:00.000Z" })

    const newYork = resolveDeadlineHint("2pm", shift("America/New_York"), NOW)
    expect(newYork).toEqual({ status: "resolved", deadlineAt: "2026-08-12T18:00:00.000Z" })

    const utc = resolveDeadlineHint("2pm", shift("UTC"), NOW)
    expect(utc).toEqual({ status: "resolved", deadlineAt: "2026-08-12T14:00:00.000Z" })
  })

  it("is deterministic: the same words and shift always give the same instant", () => {
    const first = resolveDeadlineHint("by 3:30 pm", shift("Europe/London"), NOW)
    const second = resolveDeadlineHint(
      "by 3:30 pm",
      shift("Europe/London"),
      new Date("2026-08-12T11:00:00.000Z"),
    )
    expect(first).toEqual(second)
    expect(first).toEqual({ status: "resolved", deadlineAt: "2026-08-12T14:30:00.000Z" })
  })

  it("resolves end-of-shift vocabulary to the shift end", () => {
    const s = shift("Asia/Kolkata")
    for (const phrase of ["eod", "end of shift", "end of the day", "before close", "closing"]) {
      expect(resolveDeadlineHint(phrase, s, NOW)).toEqual({
        status: "resolved",
        deadlineAt: s.endAt,
      })
    }
  })

  it("resolves 24-hour and named times", () => {
    expect(resolveDeadlineHint("14:45", shift("UTC"), NOW)).toEqual({
      status: "resolved",
      deadlineAt: "2026-08-12T14:45:00.000Z",
    })
    expect(resolveDeadlineHint("noon", shift("UTC"), NOW)).toEqual({
      status: "resolved",
      deadlineAt: "2026-08-12T12:00:00.000Z",
    })
    expect(resolveDeadlineHint("evening", shift("UTC"), NOW)).toEqual({
      status: "resolved",
      deadlineAt: "2026-08-12T18:00:00.000Z",
    })
  })

  it("measures relative hints from now", () => {
    expect(resolveDeadlineHint("in 30m", shift("Asia/Kolkata"), NOW)).toEqual({
      status: "resolved",
      deadlineAt: "2026-08-12T08:30:00.000Z",
    })
    expect(resolveDeadlineHint("in 2 hours", shift("UTC"), NOW)).toEqual({
      status: "resolved",
      deadlineAt: "2026-08-12T10:00:00.000Z",
    })
  })

  it("resolves 'tomorrow' against the next local date", () => {
    expect(resolveDeadlineHint("tomorrow 9am", shift("UTC"), NOW)).toEqual({
      status: "resolved",
      deadlineAt: "2026-08-13T09:00:00.000Z",
    })
  })

  it("reports phrases it cannot defend instead of guessing an instant", () => {
    for (const phrase of ["next leap day", "soon", "when the truck arrives", "25:00"]) {
      expect(resolveDeadlineHint(phrase, shift("UTC"), NOW)).toEqual({
        status: "unresolved",
        hint: phrase,
      })
    }
  })
})
