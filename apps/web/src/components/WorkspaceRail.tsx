import type { ReactNode } from "react"

import type { HealthResponse, Shift } from "@shiftpilot/contracts"
import type { View } from "../App.js"
import { FakeProviderBadge } from "./FakeProviderBadge.js"

const NAV: Array<{ id: View; label: string; icon: ReactNode }> = [
  {
    id: "intake",
    label: "Intake",
    icon: (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M3 3h10M3 8h10M3 13h6" />
      </svg>
    ),
  },
  {
    id: "plan",
    label: "Plan",
    icon: (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M3 3h5m-5 5h7m-7 5h10" />
      </svg>
    ),
  },
  {
    id: "handover",
    label: "Handover",
    icon: (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M3 5h10M3 11h6" />
        <circle cx="12.5" cy="11" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
]

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function WorkspaceRail({
  brand,
  view,
  shifts,
  selectedShiftId,
  onSelectShift,
  onCreateShift,
  creating,
  onViewChange,
  health,
  healthError,
  onRetryHealth,
}: {
  brand: ReactNode
  view: View
  shifts: Shift[]
  selectedShiftId: string | null
  onSelectShift: (id: string) => void
  onCreateShift: () => void
  creating: boolean
  onViewChange: (view: View) => void
  health: HealthResponse | null
  healthError: string | null
  onRetryHealth: () => void
}) {
  return (
    <aside className="rail">
      <div className="rail-brand">{brand}</div>

      <nav className="rail-nav" aria-label="Workspace">
        <p className="rail-nav-label">Workspace</p>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rail-item ${view === item.id ? "active" : ""}`}
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => onViewChange(item.id)}
          >
            <span className="rail-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="rail-nav">
        <p className="rail-nav-label">Shift</p>
        <select
          className="field"
          aria-label="Select shift"
          value={selectedShiftId ?? ""}
          onChange={(e) => onSelectShift(e.target.value)}
        >
          {shifts.length === 0 && <option value="">No shifts yet</option>}
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.date} · {formatTime(s.startAt)}–{formatTime(s.endAt)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={onCreateShift}
          disabled={creating}
        >
          {creating ? "Creating…" : "+ New shift (today, 09:00–17:00)"}
        </button>
      </div>

      <div className="rail-footer">
        {health ? (
          <FakeProviderBadge health={health} />
        ) : (
          <button
            type="button"
            className="rail-link"
            onClick={onRetryHealth}
            title={healthError ?? "System status unavailable"}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M7 4v3l2 1.5" strokeLinecap="round" />
            </svg>
            System status…
          </button>
        )}
        <a
          className="rail-link"
          href="https://github.com/Rishidar-lab/shiftpilot-ai"
          target="_blank"
          rel="noreferrer"
        >
          <svg viewBox="0 0 14 14" fill="currentColor">
            <path d="M7 .5a6.5 6.5 0 0 0-2.05 12.67c.33.06.45-.14.45-.31v-1.1c-1.84.4-2.23-.89-2.23-.89-.3-.77-.73-.97-.73-.97-.6-.41.04-.4.04-.4.66.05 1.01.68 1.01.68.59 1.01 1.55.72 1.93.55.06-.43.23-.72.42-.89-1.47-.17-3.02-.74-3.02-3.29 0-.73.26-1.32.68-1.79-.07-.17-.3-.85.06-1.77 0 0 .55-.18 1.8.68a6.26 6.26 0 0 1 3.28 0c1.25-.86 1.8-.68 1.8-.68.36.92.13 1.6.06 1.77.42.47.68 1.06.68 1.79 0 2.56-1.55 3.12-3.03 3.28.24.2.45.61.45 1.23v1.82c0 .17.12.37.45.31A6.5 6.5 0 0 0 7 .5Z" />
          </svg>
          GitHub
        </a>
        {healthError && <span className="meta">Status: unavailable</span>}
      </div>
    </aside>
  )
}
