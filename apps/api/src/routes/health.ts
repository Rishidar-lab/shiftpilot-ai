import type { FastifyInstance } from "fastify"

import type { AiProvider } from "@shiftpilot/provider"
import type { HealthResponse } from "@shiftpilot/contracts"

const API_VERSION = "0.1.0"

/**
 * Health doubles as the provider-honesty surface: `providerIsFake` comes from
 * the provider's own metadata, so the UI badge can never claim a real model ran
 * when it did not (docs/architecture.md §5). It reports the configured model and
 * prompt version for diagnostics — never the API key, which the provider does
 * not expose and this endpoint never reads.
 */
export function registerHealth(app: FastifyInstance, provider: AiProvider): void {
  app.get("/health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      version: API_VERSION,
      provider: provider.meta.id,
      providerLabel: provider.meta.label,
      providerIsFake: provider.meta.isFake,
      model: provider.meta.model,
      promptVersion: provider.meta.promptVersion,
      time: new Date().toISOString(),
    }
  })
}
