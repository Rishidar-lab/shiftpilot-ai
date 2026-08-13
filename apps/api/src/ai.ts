import type { AiProvider } from "@shiftpilot/provider"
import { FakeAiProvider } from "@shiftpilot/provider"
import type { AppConfig } from "./config.js"

/**
 * Build the single AiProvider used by the server. The provider boundary is the
 * ONLY place AI enters the system (docs/architecture.md §5). Today only the
 * deterministic, offline FakeAiProvider ships; the Claude provider lands later
 * behind the same interface. `config.aiProvider` is already constrained to
 * "fake" at boot (config.parseAppConfig rejects "claude").
 */
export function makeProvider(config: AppConfig): AiProvider {
  switch (config.aiProvider) {
    case "fake":
      return new FakeAiProvider()
    default:
      throw new Error(`Unsupported AI_PROVIDER: ${config.aiProvider}`)
  }
}
