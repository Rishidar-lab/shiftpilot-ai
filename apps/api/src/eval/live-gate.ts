import { ClaudeProvider, OpenRouterProvider, assertFreeOpenRouterModel } from "@shiftpilot/provider"
import type { AiProvider } from "@shiftpilot/provider"

import { parseAppConfig } from "../config.js"
import type { AppConfig } from "../config.js"

/**
 * The single gate every money-spending script passes through.
 *
 * Three separate things must be true before a paid call is possible, and they
 * are deliberately not collapsed into one: an explicit opt-in flag, an explicit
 * provider selection, and real credentials. The flag exists so that having a key
 * in your environment — which a developer working on this project normally does
 * — is never on its own enough to start spending. `pnpm test` and CI can
 * therefore never reach a paid call, whatever else is configured.
 *
 * The OpenRouter route is FREE-tier only, so it needs no spending opt-in flag:
 * its gate is the free-model guard, which rejects every paid route before any
 * request can be made. No paid fallback exists anywhere in this file.
 *
 * Nothing here prints, logs or returns the API key.
 */
export interface LiveContext {
  config: AppConfig
  provider: AiProvider
  /** Safe to print: model id and prompt versions, never the credential. */
  banner: string
}

const CLAUDE_USAGE = [
  "This command makes REAL, PAID Anthropic API calls.",
  "",
  "Required:",
  "  ANTHROPIC_LIVE=1        explicit opt-in to spending money",
  "  AI_PROVIDER=claude      select the real provider",
  "  ANTHROPIC_API_KEY=…     your key (set it in apps/api/.env, never in source)",
  "  ANTHROPIC_MODEL=…       a model id your account can call",
  "",
  "Verify the model id against Anthropic's current models documentation before",
  "running; model ids change and this project deliberately hard-codes none.",
].join("\n")

const OPENROUTER_USAGE = [
  "This command makes REAL OpenRouter API calls on the FREE route only.",
  "",
  "Required:",
  "  AI_PROVIDER=openrouter          select the OpenRouter provider",
  "  OPENROUTER_API_KEY=…            your key (set it in apps/api/.env, never in source)",
  "  OPENROUTER_MODEL=openrouter/free  or a <vendor>/<model>:free id",
  "",
  "Any paid/non-free model is REJECTED before a request is made. If the free",
  "route is unavailable or rate-limited the run FAILS — there is no fallback",
  "to a paid model.",
].join("\n")

/**
 * Resolve a live evaluation context for either real provider, or exit
 * non-zero. Exit code 2 means "refused to run", distinct from 1 ("ran and
 * failed"), so a CI or wrapper script can tell a missing opt-in apart from a
 * genuine failure.
 */
export function requireLiveContext(env: NodeJS.ProcessEnv): LiveContext {
  // Parse through the real application config so a live run is subject to the
  // same validation the server boots with — not a looser parallel path.
  const config = parseAppConfig(env as Record<string, string | undefined>)

  if (config.aiProvider === "claude") return requireClaudeContext(config, env)
  if (config.aiProvider === "openrouter") return requireOpenRouterContext(config)
  process.stderr.write(`Refusing to run.\n\n  - AI_PROVIDER must be claude or openrouter\n\n`)
  process.exit(2)
}

/**
 * Gate for the OpenRouter SMOKE script: one FREE request, no opt-in flag
 * (it cannot spend money — the free-model guard guarantees the route).
 */
export function requireOpenRouterSmokeContext(env: NodeJS.ProcessEnv): {
  config: AppConfig
  provider: OpenRouterProvider
  banner: string
} {
  const problems: string[] = []
  if (!env.OPENROUTER_API_KEY) problems.push("OPENROUTER_API_KEY is not set")
  if (env.OPENROUTER_MODEL !== undefined && !isFreeModel(env.OPENROUTER_MODEL)) {
    problems.push(
      `OPENROUTER_MODEL=${env.OPENROUTER_MODEL} is a paid/non-free route — the smoke test only runs openrouter/free`,
    )
  }

  if (problems.length > 0) {
    process.stderr.write(`Refusing to run.\n\n${problems.map((p) => `  - ${p}`).join("\n")}\n\n`)
    process.stderr.write(`${OPENROUTER_USAGE}\n`)
    process.exit(2)
  }

  const config = parseAppConfig({
    ...env,
    AI_PROVIDER: "openrouter",
    OPENROUTER_MODEL: "openrouter/free",
    // Small output ceiling: this is a smoke test, not an evaluation.
    OPENROUTER_MAX_OUTPUT_TOKENS: "256",
  })

  const provider = new OpenRouterProvider({
    apiKey: config.openrouter!.apiKey,
    model: config.openrouter!.model,
    maxOutputTokens: config.openrouter!.maxOutputTokens,
    timeoutMs: config.aiTimeoutMs,
    maxRetries: config.openrouter!.maxRetries,
    baseUrl: config.openrouter!.baseUrl,
  })

  return {
    config,
    provider,
    banner: [
      `route:           openrouter/free (free tier only)`,
      `extract prompt:  ${provider.meta.promptId} ${provider.meta.promptVersion}`,
      `max out tokens:  ${config.openrouter!.maxOutputTokens}`,
      `timeout budget:  ${config.aiTimeoutMs}ms`,
      `retries:         ${config.openrouter!.maxRetries} (429-only, same route; no paid fallback)`,
    ].join("\n"),
  }
}

function requireClaudeContext(config: AppConfig, env: NodeJS.ProcessEnv): LiveContext {
  const problems: string[] = []
  if (env.ANTHROPIC_LIVE !== "1") problems.push("ANTHROPIC_LIVE is not set to 1")
  if (!env.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY is not set")
  if (!env.ANTHROPIC_MODEL) problems.push("ANTHROPIC_MODEL is not set")

  if (problems.length > 0) {
    process.stderr.write(`Refusing to run.\n\n${problems.map((p) => `  - ${p}`).join("\n")}\n\n`)
    process.stderr.write(`${CLAUDE_USAGE}\n`)
    process.exit(2)
  }

  if (config.anthropic === null) {
    process.stderr.write("Refusing to run: Claude configuration did not resolve.\n")
    process.exit(2)
  }

  const provider = new ClaudeProvider({
    apiKey: config.anthropic.apiKey,
    model: config.anthropic.model,
    maxOutputTokens: config.anthropic.maxOutputTokens,
    maxRetries: config.anthropic.maxRetries,
    timeoutMs: config.aiTimeoutMs,
    ...(config.anthropic.effort ? { effort: config.anthropic.effort } : {}),
  })

  return {
    config,
    provider,
    banner: [
      `model:           ${provider.meta.model}`,
      `extract prompt:  ${provider.meta.promptId} ${provider.meta.promptVersion}`,
      `handover prompt: ${provider.meta.handoverPromptId} ${provider.meta.handoverPromptVersion}`,
      `max out tokens:  ${config.anthropic.maxOutputTokens}`,
      `max retries:     ${config.anthropic.maxRetries}`,
      `timeout budget:  ${config.aiTimeoutMs}ms`,
    ].join("\n"),
  }
}

function requireOpenRouterContext(config: AppConfig): LiveContext {
  if (config.openrouter === null) {
    process.stderr.write("Refusing to run: OpenRouter configuration did not resolve.\n")
    process.exit(2)
  }

  const provider = new OpenRouterProvider({
    apiKey: config.openrouter.apiKey,
    model: config.openrouter.model,
    maxOutputTokens: config.openrouter.maxOutputTokens,
    timeoutMs: config.aiTimeoutMs,
    maxRetries: config.openrouter.maxRetries,
    baseUrl: config.openrouter.baseUrl,
  })

  return {
    config,
    provider,
    banner: [
      `route:           ${provider.meta.model} (free tier only)`,
      `extract prompt:  ${provider.meta.promptId} ${provider.meta.promptVersion}`,
      `handover prompt: ${provider.meta.handoverPromptId} ${provider.meta.handoverPromptVersion}`,
      `max out tokens:  ${config.openrouter.maxOutputTokens}`,
      `timeout budget:  ${config.aiTimeoutMs}ms`,
      `retries:         ${config.openrouter.maxRetries} (429-only, same route; no paid fallback)`,
    ].join("\n"),
  }
}

/** True only for the free route; the canonical guard the provider enforces. */
function isFreeModel(model: string): boolean {
  try {
    assertFreeOpenRouterModel(model)
    return true
  } catch {
    return false
  }
}

/**
 * Redact anything credential-shaped before it is written anywhere.
 *
 * A belt-and-braces measure: the scripts never deliberately emit a key, but an
 * SDK error message or an echoed request could carry one, and a recorded
 * artifact is exactly the kind of thing that later gets committed.
 */
export function redact(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]")
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "sk-or-v1-[REDACTED]")
    .replace(/(ANTHROPIC_API_KEY\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(OPENROUTER_API_KEY\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(authorization|x-api-key)(\s*[=:]\s*)\S+/gi, "$1$2[REDACTED]")
}
