import { useCallback, useEffect, useState } from "react"

import { ApiClient, ApiError } from "./api/client.js"
import { FakeProviderBadge } from "./components/FakeProviderBadge.js"
import { HandoverView } from "./components/HandoverView.js"
import { IntakeView } from "./components/IntakeView.js"
import { PlanView } from "./components/PlanView.js"
import type { HealthResponse, Shift } from "@shiftpilot/contracts"

type View = "intake" | "plan" | "handover"

const TABS: Array<{ id: View; label: string }> = [
  { id: "intake", label: "Intake" },
  { id: "plan", label: "Plan" },
  { id: "handover", label: "Handover" },
]

/** The browser's own zone; the shift is created against the worker's clock. */
function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/** Local wall-clock `hour:00` today, expressed as an instant. */
function localTimeToday(hour: number): string {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function todayLocalIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function App() {
  const [client] = useState(() => new ApiClient())
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [view, setView] = useState<View>("intake")
  const [refreshKey, setRefreshKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [shiftError, setShiftError] = useState<string | null>(null)

  const loadHealth = useCallback(() => {
    setHealthError(null)
    client
      .getHealth()
      .then(setHealth)
      .catch((err: unknown) =>
        setHealthError(err instanceof ApiError ? err.message : "API unreachable"),
      )
  }, [client])

  useEffect(() => {
    loadHealth()
    client
      .listShifts()
      .then((list) => {
        setShifts(list)
        const first = list[0]
        if (first) setSelectedShiftId(first.id)
      })
      .catch(() => setShiftError("Could not load shifts."))
  }, [client, loadHealth])

  async function handleCreateShift() {
    setShiftError(null)
    setCreating(true)
    try {
      const shift = await client.createShift({
        date: todayLocalIso(),
        startAt: localTimeToday(9),
        endAt: localTimeToday(17),
        timezone: localZone(),
        role: null,
      })
      setShifts((prev) => [...prev, shift])
      setSelectedShiftId(shift.id)
      setView("intake")
    } catch (err) {
      setShiftError(err instanceof ApiError ? err.message : "Could not create the shift")
    } finally {
      setCreating(false)
    }
  }

  const selected = shifts.find((s) => s.id === selectedShiftId) ?? null

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Shift Pilot</h1>
          <p className="tagline">AI workload planning for frontline and operational workers</p>
        </div>
        {health && <FakeProviderBadge health={health} />}
      </header>

      {healthError && (
        <div className="banner error" role="alert">
          <strong>API unavailable.</strong> {healthError}
          <p className="hint">Start it with pnpm dev, then retry.</p>
          <div className="row">
            <button type="button" onClick={loadHealth}>
              Try again
            </button>
          </div>
        </div>
      )}

      <section className="card" aria-labelledby="shift-heading">
        <div className="row between">
          <h2 id="shift-heading">Shift</h2>
          <button type="button" className="primary" onClick={handleCreateShift} disabled={creating}>
            {creating ? "Creating…" : "New shift (today, 09:00–17:00)"}
          </button>
        </div>
        {shiftError && (
          <div className="banner error" role="alert">
            {shiftError}
          </div>
        )}
        {shifts.length === 0 ? (
          <p className="empty">No shifts yet. Create today's shift to get started.</p>
        ) : (
          <ul className="shifts">
            {shifts.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={s.id === selectedShiftId ? "active" : ""}
                  aria-current={s.id === selectedShiftId}
                  onClick={() => setSelectedShiftId(s.id)}
                >
                  {s.date}{" "}
                  <span className="muted">
                    {formatTime(s.startAt)}–{formatTime(s.endAt)} · {s.timezone}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <>
          <nav className="tabs" aria-label="Shift views">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={view === tab.id ? "active" : ""}
                aria-current={view === tab.id ? "page" : undefined}
                onClick={() => setView(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {view === "intake" && (
            <IntakeView
              client={client}
              shiftId={selected.id}
              onApproved={() => setRefreshKey((k) => k + 1)}
            />
          )}
          {view === "plan" && (
            <PlanView key={`plan-${refreshKey}`} client={client} shiftId={selected.id} />
          )}
          {view === "handover" && (
            <HandoverView key={`handover-${refreshKey}`} client={client} shiftId={selected.id} />
          )}
        </>
      ) : (
        <p className="empty">Select or create a shift to begin.</p>
      )}
    </main>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
