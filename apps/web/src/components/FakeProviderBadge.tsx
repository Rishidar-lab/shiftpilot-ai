import type { HealthResponse } from "@shiftpilot/contracts"

/**
 * The provider is always named, whether simulated or real. `providerIsFake`
 * comes from the provider's own metadata rather than a guess based on its id,
 * so simulated output can never be presented as a real model
 * (docs/architecture.md §5).
 */
export function FakeProviderBadge({ health }: { health: HealthResponse }) {
  if (health.providerIsFake) {
    return (
      <span className="badge fake" title={health.providerLabel}>
        Simulated AI · no real LLM
      </span>
    )
  }
  return (
    <span className="badge real" title={health.providerLabel}>
      Live AI · {health.provider}
    </span>
  )
}
