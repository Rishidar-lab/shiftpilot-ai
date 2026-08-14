import type { AiProvider } from "@shiftpilot/provider"
import { ClaudeProvider, FakeAiProvider, OpenRouterProvider } from "@shiftpilot/provider"
import type { AppConfig } from "./config.js"

/**
 * Build the single AiProvider used by the server. The provider boundary is the
 * ONLY place AI enters the system (docs/architecture.md §5), and selection is
 * explicit configuration — never a runtime guess and never a fallback.
 *
 * There is deliberately no "real provider, but fall back to fake if it fails to
 * construct" path: an operator who asked for real AI must get real AI or a
 * refusal to start, otherwise simulated output could be mistaken for a model's.
 */
export function makeProvider(config: AppConfig): AiProvider {
  switch (config.aiProvider) {
    case "fake":
      return new FakeAiProvider()
    case "claude": {
      if (config.anthropic === null) {
        // parseAppConfig rejects this combination first; this guard keeps the
        // invariant local rather than assuming a caller validated for us.
        throw new Error("AI_PROVIDER=claude selected without Anthropic configuration")
      }
      return new ClaudeProvider({
        apiKey: config.anthropic.apiKey,
        model: config.anthropic.model,
        maxOutputTokens: config.anthropic.maxOutputTokens,
        maxRetries: config.anthropic.maxRetries,
        timeoutMs: config.aiTimeoutMs,
        ...(config.anthropic.effort ? { effort: config.anthropic.effort } : {}),
      })
    }
    case "openrouter": {
      if (config.openrouter === null) {
        // parseAppConfig rejects this combination first; this guard keeps the
        // invariant local rather than assuming a caller validated for us.
        throw new Error("AI_PROVIDER=openrouter selected without OpenRouter configuration")
      }
      return new OpenRouterProvider({
        apiKey: config.openrouter.apiKey,
        model: config.openrouter.model,
        maxOutputTokens: config.openrouter.maxOutputTokens,
        timeoutMs: config.aiTimeoutMs,
        maxRetries: config.openrouter.maxRetries,
        baseUrl: config.openrouter.baseUrl,
      })
    }
  }
}
