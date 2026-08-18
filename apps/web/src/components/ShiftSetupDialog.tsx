import { useEffect, useId, useRef, useState } from "react"

export interface ShiftSetupValues {
  date: string
  /** Local wall-clock HH:MM; the caller resolves it to an instant. */
  start: string
  end: string
  timezone: string
  role: string
}

function todayLocalIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function defaultShiftValues(): ShiftSetupValues {
  return { date: todayLocalIso(), start: "09:00", end: "17:00", timezone: browserZone(), role: "" }
}

/**
 * A small setup sheet around the existing createShift call — nothing more. It
 * does not touch the API contract: it collects the same fields createShift
 * already accepts, validates that the shift has positive length, and hands the
 * values back. No recurrence, no auth, no persistence of its own.
 */
export function ShiftSetupDialog({
  open,
  creating,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean
  creating: boolean
  error: string | null
  onSubmit: (values: ShiftSetupValues) => void
  onClose: () => void
}) {
  const [values, setValues] = useState<ShiftSetupValues>(defaultShiftValues)
  const [localError, setLocalError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  // Reset to fresh defaults each time the sheet opens, and move focus into it.
  useEffect(() => {
    if (!open) return
    setValues(defaultShiftValues())
    setLocalError(null)
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== "Tab") return
      // Minimal focus trap: keep Tab inside the sheet.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  function set<K extends keyof ShiftSetupValues>(key: K, value: ShiftSetupValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setLocalError(null)
  }

  function submit() {
    if (!values.date || !values.start || !values.end) {
      setLocalError("Pick a date, a start time and an end time.")
      return
    }
    // Same-day comparison is enough: the shift is a single day's plan.
    if (values.end <= values.start) {
      setLocalError("The shift must end after it starts.")
      return
    }
    onSubmit(values)
  }

  const shown = localError ?? error

  return (
    <div
      className="dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <div className="dialog-head">
          <div>
            <p className="eyebrow">New shift</p>
            <h2 id={titleId} className="dialog-title">
              Set up today's shift
            </h2>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            <svg
              viewBox="0 0 14 14"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        <p className="dialog-sub">
          A shift scopes the day ShiftPilot plans — its hours set what fits and when deadlines land.
        </p>

        <div className="dialog-grid">
          <label className="field-group">
            <span className="field-label">Date</span>
            <input
              ref={firstFieldRef}
              type="date"
              className="field"
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-label">Timezone</span>
            <input
              type="text"
              className="field"
              value={values.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              aria-label="Shift timezone"
            />
          </label>
          <label className="field-group">
            <span className="field-label">Start</span>
            <input
              type="time"
              className="field"
              value={values.start}
              onChange={(e) => set("start", e.target.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-label">End</span>
            <input
              type="time"
              className="field"
              value={values.end}
              onChange={(e) => set("end", e.target.value)}
            />
          </label>
          <label className="field-group field-group-wide">
            <span className="field-label">
              Role <span className="field-optional">optional</span>
            </span>
            <input
              type="text"
              className="field"
              value={values.role}
              placeholder="e.g. Retail floor supervisor"
              onChange={(e) => set("role", e.target.value)}
            />
          </label>
        </div>

        {shown && (
          <p className="banner banner-error" role="alert" style={{ marginTop: 12 }}>
            {shown}
          </p>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setValues((prev) => ({ ...prev, start: "09:00", end: "17:00" }))
              setLocalError(null)
            }}
          >
            Use 9–5
          </button>
          <div className="dialog-actions-primary">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={creating}>
              {creating ? "Starting…" : "Start shift"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
