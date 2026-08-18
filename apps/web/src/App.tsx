import { useCallback, useEffect, useState } from "react"

import { ApiClient, ApiError } from "./api/client.js"
import { ShiftWordmark } from "./components/Brand.js"
import { ContextPanel } from "./components/ContextPanel.js"
import { HandoverView } from "./components/HandoverView.js"
import { IntakeView } from "./components/IntakeView.js"
import { LandingView } from "./components/LandingView.js"
import { PlanView } from "./components/PlanView.js"
import { ShiftHeader } from "./components/ShiftHeader.js"
import { ShiftSetupDialog, type ShiftSetupValues } from "./components/ShiftSetupDialog.js"
import { WorkspaceRail } from "./components/WorkspaceRail.js"
import type { HealthResponse, Shift } from "@shiftpilot/contracts"

export type View = "intake" | "plan" | "handover"

/** The intake view is the interaction surface; users see it as "Pilot". */
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "intake", label: "Pilot" },
  { id: "plan", label: "Plan" },
  { id: "handover", label: "Handover" },
]

/** How a landing quick-action carries its prefill text into the composer. */
export const INTENT_KEY = "shiftpilot:intent"

type Route = { page: "landing" } | { page: "workspace"; view: View }

function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#/, "")
  if (clean === "" || clean === "/") return { page: "landing" }
  const parts = clean.split("/").filter(Boolean)
  if (parts[0] === "app") {
    const view = parts[1]
    const tab = VIEWS.find((v) => v.id === view)
    return { page: "workspace", view: tab ? tab.id : "intake" }
  }
  return { page: "landing" }
}

function routeToHash(route: Route): string {
  if (route.page === "landing") return "#/"
  return `#/app/${route.view}`
}

function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    window.location.hash = routeToHash(next)
    setRoute(next)
  }, [])

  return [route, navigate]
}

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
  const [route, navigate] = useHashRoute()

  if (route.page === "landing") {
    return (
      <LandingView
        onOpen={(intent) => {
          // A quick action prefills the composer; plain "Open" carries nothing.
          // sessionStorage, not the backend — nothing is persisted until the
          // existing intake flow persists it.
          if (intent) sessionStorage.setItem(INTENT_KEY, intent)
          else sessionStorage.removeItem(INTENT_KEY)
          navigate({ page: "workspace", view: "intake" })
        }}
      />
    )
  }

  return (
    <WorkspaceView
      initialView={route.view}
      onViewChange={(view) => navigate({ page: "workspace", view })}
    />
  )
}

function WorkspaceView({
  initialView,
  onViewChange,
}: {
  initialView: View
  onViewChange: (view: View) => void
}) {
  const [client] = useState(() => new ApiClient())
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [view, setView] = useState<View>(initialView)
  const [refreshKey, setRefreshKey] = useState(0)
  /**
   * Separate from refreshKey on purpose. refreshKey is in PlanView's `key`, so
   * bumping it remounts the plan and throws away its local state — including the
   * "Plan updated" confirmation the user is meant to read. The header only needs
   * to re-run its own query, so task actions bump this instead.
   */
  const [statsKey, setStatsKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [shiftError, setShiftError] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)

  // Keep internal state aligned when the hash route changes (back/forward).
  useEffect(() => {
    setView(initialView)
  }, [initialView])

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

  /** Turn a chosen local date + wall-clock time into an instant (browser zone). */
  function localDateTime(date: string, time: string): string {
    const d = new Date(`${date}T${time}`)
    return Number.isNaN(d.getTime()) ? localTimeToday(9) : d.toISOString()
  }

  async function submitShift(values: ShiftSetupValues) {
    setShiftError(null)
    setCreating(true)
    try {
      const shift = await client.createShift({
        date: values.date || todayLocalIso(),
        startAt: localDateTime(values.date, values.start),
        endAt: localDateTime(values.date, values.end),
        timezone: values.timezone || localZone(),
        role: values.role.trim() ? values.role.trim() : null,
      })
      setShifts((prev) => [...prev, shift])
      setSelectedShiftId(shift.id)
      setSetupOpen(false)
      setView("intake")
      onViewChange("intake")
    } catch (err) {
      setShiftError(err instanceof ApiError ? err.message : "Could not create the shift")
    } finally {
      setCreating(false)
    }
  }

  const selected = shifts.find((s) => s.id === selectedShiftId) ?? null

  return (
    <div className="app-shell">
      <WorkspaceRail
        brand={
          <button
            type="button"
            className="rail-link"
            onClick={() => (window.location.hash = "#/")}
            aria-label="ShiftPilot home"
          >
            <ShiftWordmark size={19} />
          </button>
        }
        view={view}
        shifts={shifts}
        selectedShiftId={selected?.id ?? null}
        onSelectShift={(id) => setSelectedShiftId(id)}
        onCreateShift={() => setSetupOpen(true)}
        creating={creating}
        onViewChange={(next) => {
          setView(next)
          onViewChange(next)
        }}
        health={health}
        healthError={healthError}
        onRetryHealth={loadHealth}
      />

      <main className="workspace">
        <div className="workspace-top">
          <ShiftHeader
            client={client}
            shift={selected}
            shiftError={shiftError}
            refreshKey={refreshKey + statsKey}
          />
          <nav className="workspace-tabs" aria-label="Shift views">
            {VIEWS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`tab ${view === tab.id ? "active" : ""}`}
                aria-current={view === tab.id ? "page" : undefined}
                onClick={() => {
                  setView(tab.id)
                  onViewChange(tab.id)
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {healthError && (
          <div className="banner banner-error" role="alert">
            <strong>API unavailable.</strong> {healthError}
            <p className="meta" style={{ marginTop: 4 }}>
              Start it with pnpm dev, then retry.
            </p>
            <button type="button" className="btn" onClick={loadHealth}>
              Try again
            </button>
          </div>
        )}

        {selected ? (
          <div className="workspace-body">
            <div className="main-col">
              {view === "intake" && (
                <IntakeView
                  key={`intake-${selected.id}`}
                  client={client}
                  shiftId={selected.id}
                  onApproved={() => setRefreshKey((k) => k + 1)}
                />
              )}
              {view === "plan" && (
                <PlanView
                  key={`plan-${selected.id}-${refreshKey}`}
                  client={client}
                  shiftId={selected.id}
                  onChanged={() => setStatsKey((k) => k + 1)}
                />
              )}
              {view === "handover" && (
                <HandoverView
                  key={`handover-${selected.id}-${refreshKey}`}
                  client={client}
                  shiftId={selected.id}
                />
              )}
            </div>
            <div className="side-col">
              <ContextPanel
                view={view}
                client={client}
                shiftId={selected.id}
                signal={refreshKey + statsKey}
              />
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-title">Start a shift to turn today's workload into a plan.</p>
            <p className="empty-copy">
              Shifts are how ShiftPilot scopes time, deadlines and handover. Create today's shift to
              begin.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setSetupOpen(true)}>
              Create today's shift
            </button>
          </div>
        )}
      </main>

      <ShiftSetupDialog
        open={setupOpen}
        creating={creating}
        error={shiftError}
        onSubmit={submitShift}
        onClose={() => setSetupOpen(false)}
      />
    </div>
  )
}
