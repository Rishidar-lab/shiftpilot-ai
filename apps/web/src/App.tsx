import { useEffect, useState } from "react"

import type { HealthResponse } from "@shiftpilot/contracts"
import { ApiClient, ApiError } from "./api/client.js"

type HealthState =
  | { status: "loading" }
  | { status: "ready"; health: HealthResponse }
  | { status: "error"; message: string }

export function App() {
  const [state, setState] = useState<HealthState>({ status: "loading" })

  useEffect(() => {
    const client = new ApiClient()
    client
      .getHealth()
      .then((health) => setState({ status: "ready", health }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Unexpected client error"
        setState({ status: "error", message })
      })
  }, [])

  return (
    <main className="shell">
      <h1>Shift Pilot</h1>
      <p className="tagline">AI workload planning for frontline and operational workers</p>
      <section className="card">{renderHealth(state)}</section>
      <p className="footnote">M0 scaffold — capture, planning and handover land in M1–M5.</p>
    </main>
  )
}

function renderHealth(state: HealthState) {
  if (state.status === "loading") return <p>Checking API…</p>
  if (state.status === "error") {
    return (
      <div className="banner error" role="alert">
        <strong>API unavailable.</strong> {state.message}
        <p className="hint">Is the API running? Start it with pnpm dev.</p>
      </div>
    )
  }
  return (
    <dl>
      <div>
        <dt>API status</dt>
        <dd>{state.health.status}</dd>
      </div>
      <div>
        <dt>Version</dt>
        <dd>{state.health.version}</dd>
      </div>
      <div>
        <dt>AI provider</dt>
        <dd>{state.health.provider}</dd>
      </div>
      <div>
        <dt>Server time</dt>
        <dd>{state.health.time}</dd>
      </div>
    </dl>
  )
}
