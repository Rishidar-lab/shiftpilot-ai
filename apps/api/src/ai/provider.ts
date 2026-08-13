import type { AppConfig } from "../config.js"
import { FakeAiProvider } from "@shiftpilot/provider"
import type { AiProvider } from "@shiftpilot/provider"

/**
 * Provider selection by configuration, never by domain logic
 * (docs/architecture.md §5). One factory; implementations stay private.
 */
export function createAiProvider(config: AppConfig): AiProvider {
  switch (config.aiProvider) {
    case "fake":
      return new FakeAiProvider()
    case "claude":
      // Cannot be reached: parseAppConfig already rejects claude until M3.
      throw new Error("claude provider not implemented — set AI_PROVIDER=fake")
  }
}
