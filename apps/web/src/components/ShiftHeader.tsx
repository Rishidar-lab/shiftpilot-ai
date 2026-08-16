import type { ApiClient } from "../api/client.js"
import type { Shift } from "@shiftpilot/contracts"
import { useAsync } from "../use-async.js"

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
}

/**
 * The shift header is built from real domain data only: the shift's own
 * start/end/zone, and the plan projection's load numbers. No metric here is
 * invented; while the plan is loading the stats render as "…".
 */
export function ShiftHeader({
  client,
  shift,
  shiftError,
}: {
  client: ApiClient
  shift: Shift | null
  shiftError: string | null
}) {
  const plan = useAsync(
    () => (shift ? client.getPlan(shift.id) : Promise.resolve(null)),
    [client, shift?.id],
  )
  const planData = plan.state.status === "ready" ? plan.state.data : null
  const load = planData?.load ?? null
  const overflow = load != null && load.scheduledMinutes > load.availableMinutes

  if (!shift) {
    return (
      <div className="shift-header">
        <div className="shift-header-main">
          <p className="shift-eyebrow">No active shift</p>
          <p className="shift-meta">
            {shiftError
              ? "Shifts could not be loaded. Try refreshing."
              : "Create today's shift to get started."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="shift-header">
      <div className="shift-header-main">
        <p className="shift-eyebrow">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill="var(--success)" />
          </svg>
          Today's shift
        </p>
        <h1 className="shift-title">{formatDate(shift.date)}</h1>
        <p className="shift-meta">
          <span className="mono">
            {formatTime(shift.startAt)} — {formatTime(shift.endAt)}
          </span>
          <span className="chip" style={{ gap: 4 }}>
            <span aria-hidden="true">●</span> {shift.timezone}
          </span>
        </p>
      </div>

      <div className="shift-stats">
        {load && (
          <>
            <div className="stat">
              <span className="stat-value">{planData?.sequence.length ?? 0}</span>
              <span className="stat-label">Tasks remaining</span>
            </div>
            <div className="stat">
              <span className="stat-value">{load.scheduledMinutes}m</span>
              <span className="stat-label">Scheduled</span>
            </div>
            <div className={`stat ${overflow ? "stat-overflow" : ""}`}>
              <span className="stat-value">{load.availableMinutes}m</span>
              <span className="stat-label">
                {overflow ? "Capacity · overflow" : "Shift capacity"}
              </span>
            </div>
          </>
        )}
        {!load && plan.state.status === "loading" && (
          <div className="stat" aria-busy="true">
            <span className="stat-value">…</span>
            <span className="stat-label">Loading plan</span>
          </div>
        )}
      </div>
    </div>
  )
}
