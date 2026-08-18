import type { ShiftContext } from "@shiftpilot/contracts"

/**
 * TIME SEMANTICS (docs/architecture.md §4).
 *
 * A shift is a local-time concept. When a worker writes "by 2pm" they mean 2pm
 * where they are standing — never 2pm UTC and never 2pm in whatever zone the
 * server happens to run in. Every shift therefore carries an IANA `timezone`,
 * and this module is the ONLY place that converts a human phrase into an
 * instant.
 *
 * This is deliberately deterministic domain logic rather than provider logic:
 * an LLM is good at spotting the phrase "before close" and bad at date
 * arithmetic. Providers return the verbatim phrase (`deadlineHint`); this
 * module resolves it. Fake and real providers therefore produce identical
 * deadlines for identical words.
 *
 * Zero runtime dependencies: `Intl` is a JavaScript built-in, not a package.
 */

const MINUTE_MS = 60_000

/**
 * The instant at which scheduling may begin for this shift, given the current
 * time — `now` clamped to the shift's own bounds `[startAt, endAt]`:
 *
 *   before the shift   → shiftStart   (a 09:00 shift planned at 02:55 starts 09:00)
 *   during the shift   → now
 *   after the shift     → shiftEnd     (zero remaining window)
 *
 * This is the single canonical horizon. The scheduler, the capacity figure and
 * "what next" all derive from it, so they can never disagree about when work
 * may start. Planning never runs against pre-shift wall-clock time (which would
 * inflate capacity to `end - now`) and never schedules into an ended shift.
 */
export function effectivePlanningStart(shift: { startAt: string; endAt: string }, now: Date): Date {
  const start = new Date(shift.startAt).getTime()
  const end = new Date(shift.endAt).getTime()
  const clamped = Math.min(Math.max(now.getTime(), start), end)
  return new Date(clamped)
}

/**
 * Offset in minutes (east of UTC) that `timeZone` was at the given instant.
 * Derived by formatting the instant as wall-clock in that zone and measuring
 * the difference, which is DST-correct by construction.
 */
export function zoneOffsetMinutes(timeZone: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs))

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0")
  // Intl renders midnight as hour 24 in some engines; normalize to 0.
  const hour = get("hour") % 24
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  )
  return Math.round((asUtc - instantMs) / MINUTE_MS)
}

/**
 * The instant at which `timeZone` reads the given wall clock.
 * Two passes: guess with the offset at the naive instant, then correct using
 * the offset actually in force at the guessed instant (DST transitions).
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const firstGuess = naive - zoneOffsetMinutes(timeZone, naive) * MINUTE_MS
  const corrected = naive - zoneOffsetMinutes(timeZone, firstGuess) * MINUTE_MS
  return new Date(corrected)
}

/** Wall-clock calendar date (in `timeZone`) of an instant, as YYYY-MM-DD parts. */
export function zonedDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0")
  return { year: get("year"), month: get("month"), day: get("day") }
}

export type DeadlineResolution =
  | { status: "none" }
  | { status: "resolved"; deadlineAt: string }
  | { status: "unresolved"; hint: string }

/**
 * Resolve a verbatim deadline phrase against the shift's local clock.
 *
 * Supported vocabulary (documented in docs/architecture.md §4):
 *   end-of-shift   "eod", "end of day/shift", "before close", "closing", "close"
 *   clock times    "2pm", "2:30 pm", "14:00"        → that time on the shift date
 *   named times    "noon", "midday", "morning", "afternoon", "evening"
 *   relative       "in 30m", "in 2 hours", "in 90 minutes"  → measured from `now`
 *   next day       "tomorrow 9am"                    → the following local date
 *
 * Anything else resolves to `unresolved` — the task is still created, the phrase
 * is preserved, and the reviewer is asked to set a deadline. We never guess an
 * instant we cannot defend (docs/architecture.md §7 case 6).
 */
export function resolveDeadlineHint(
  hint: string | null,
  shift: ShiftContext,
  now: Date,
): DeadlineResolution {
  if (hint === null) return { status: "none" }
  const text = hint.trim().toLowerCase()
  if (text.length === 0) return { status: "none" }

  if (/\b(eod|end of (?:the )?(?:day|shift)|before close|closing|at close|close)\b/.test(text)) {
    return { status: "resolved", deadlineAt: shift.endAt }
  }

  const relative = text.match(
    /\bin\s+(\d{1,4})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/,
  )
  if (relative && relative[1] && relative[2]) {
    const amount = parseInt(relative[1], 10)
    const unitMinutes = relative[2].startsWith("h") ? 60 : 1
    return {
      status: "resolved",
      deadlineAt: new Date(now.getTime() + amount * unitMinutes * MINUTE_MS).toISOString(),
    }
  }

  const clock = parseClock(text)
  if (clock === null) return { status: "unresolved", hint }

  const base = /\btomorrow\b/.test(text) ? nextLocalDate(shift, now) : parseIsoDateParts(shift.date)
  if (base === null) return { status: "unresolved", hint }

  const resolved = zonedWallClockToUtc(
    base.year,
    base.month,
    base.day,
    clock.hour,
    clock.minute,
    shift.timezone,
  )
  return { status: "resolved", deadlineAt: resolved.toISOString() }
}

const NAMED_TIMES: ReadonlyArray<readonly [RegExp, number, number]> = [
  [/\b(noon|midday|mid-day)\b/, 12, 0],
  [/\bmorning\b/, 9, 0],
  [/\bafternoon\b/, 15, 0],
  [/\bevening\b/, 18, 0],
  [/\bmidnight\b/, 0, 0],
]

/** Wall-clock hour/minute stated by the phrase, or null when it states none. */
function parseClock(text: string): { hour: number; minute: number } | null {
  const twelve = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (twelve && twelve[1] && twelve[3]) {
    let hour = parseInt(twelve[1], 10)
    const minute = twelve[2] ? parseInt(twelve[2], 10) : 0
    if (hour < 1 || hour > 12 || minute > 59) return null
    if (twelve[3] === "pm" && hour !== 12) hour += 12
    if (twelve[3] === "am" && hour === 12) hour = 0
    return { hour, minute }
  }

  const twentyFour = text.match(/\b(\d{1,2}):(\d{2})\b/)
  if (twentyFour && twentyFour[1] && twentyFour[2]) {
    const hour = parseInt(twentyFour[1], 10)
    const minute = parseInt(twentyFour[2], 10)
    if (hour > 23 || minute > 59) return null
    return { hour, minute }
  }

  for (const [pattern, hour, minute] of NAMED_TIMES) {
    if (pattern.test(text)) return { hour, minute }
  }
  return null
}

function parseIsoDateParts(date: string): { year: number; month: number; day: number } | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match || !match[1] || !match[2] || !match[3]) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

/** The local calendar date after the shift date. */
function nextLocalDate(
  shift: ShiftContext,
  _now: Date,
): { year: number; month: number; day: number } | null {
  const parts = parseIsoDateParts(shift.date)
  if (parts === null) return null
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  }
}
