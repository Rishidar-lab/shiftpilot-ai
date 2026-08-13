import type { HealthResponse } from "@shiftpilot/contracts"

export function FakeProviderBadge({ health }: { health: HealthResponse }) {
  if (health.provider !== "fake") return null
  return (
    <span
      className="badge fake"
      title="No real LLM is used. Tasks are extracted by a deterministic, offline heuristic."
    >
      Simulated AI · Fake provider (no real LLM)
    </span>
  )
}
