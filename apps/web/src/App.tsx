import { useEffect, useState } from "react"

import { ApiClient, ApiError } from "./api/client.js"
import { FakeProviderBadge } from "./components/FakeProviderBadge.js"
import { HandoverView } from "./components/HandoverView.js"
import { IntakeView } from "./components/IntakeView.js"
import { PlanView } from "./components/PlanView.js"
import type { HealthResponse, Shift } from "@shiftpilot/contracts"

type View = "intake" | "plan" | "handover"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
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

  useEffect(() => {
    client
      .getHealth()
      .then(setHealth)
      .catch((err: unknown) => setHealthError(err instanceof ApiError ? err.message : "API down"))
    client
      .listShifts()
      .then((list) => {
        setShifts(list)
        const first = list[0]
        if (first) setSelectedShiftId(first.id)
      })
      .catch(() => undefined)
  }, [client])

  async function handleCreateShift() {
    setShiftError(null)
    setCreating(true)
    try {
      const date = todayIso()
      const shift = await client.createShift({
        date,
        startAt: `${date}T09:00:00.000Z`,
        endAt: `${date}T17:00:00.000Z`,
        role: null,
      })
      setShifts((prev) => [...prev, shift])
      setSelectedShiftId(shift.id)
    } catch (err) {
      setShiftError(err instanceof ApiError ? err.message : "Failed to create shift")
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
          <p className="hint">Start the API with pnpm dev.</p>
        </div>
      )}

      <section className="card">
        <div className="row between">
          <h2>Shift</h2>
          <button type="button" onClick={handleCreateShift} disabled={creating}>
            {creating ? "Creating…" : "New shift (today)"}
          </button>
        </div>
        {shiftError && <div className="banner error">{shiftError}</div>}
        {shifts.length === 0 ? (
          <p className="hint">No shifts yet. Create today's shift to get started.</p>
        ) : (
          <ul className="shifts">
            {shifts.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={s.id === selectedShiftId ? "active" : ""}
                  onClick={() => setSelectedShiftId(s.id)}
                >
                  {s.date}{" "}
                  <span className="muted">
                    {s.startAt.slice(11, 16)}–{s.endAt.slice(11, 16)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <>
          <nav className="tabs">
            <button
              type="button"
              className={view === "intake" ? "active" : ""}
              onClick={() => setView("intake")}
            >
              Intake
            </button>
            <button
              type="button"
              className={view === "plan" ? "active" : ""}
              onClick={() => setView("plan")}
            >
              Plan
            </button>
            <button
              type="button"
              className={view === "handover" ? "active" : ""}
              onClick={() => setView("handover")}
            >
              Handover
            </button>
          </nav>

          {view === "intake" && (
            <IntakeView
              client={client}
              shiftId={selected.id}
              onApproved={() => setRefreshKey((k) => k + 1)}
            />
          )}
          {view === "plan" && <PlanView key={refreshKey} client={client} shiftId={selected.id} />}
          {view === "handover" && <HandoverView client={client} shiftId={selected.id} />}
        </>
      ) : (
        <p className="hint">Select or create a shift to begin.</p>
      )}
    </main>
  )
}
