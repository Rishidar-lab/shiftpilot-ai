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
      <span className="provider-badge fake" title={health.providerLabel}>
        <span className="dot" aria-hidden="true" />
        Simulated AI · no real LLM
      </span>
    )
  }
  return (
    <span className="provider-badge real" title={health.providerLabel}>
      <span className="dot" aria-hidden="true" />
      Live AI · {health.model ?? health.provider}
    </span>
  )
}
