import { z } from "zod"

import { assertFreeOpenRouterModel } from "@shiftpilot/provider"

/**
 * Schema fields mirror the env var names exactly (PORT, HOST, ...): zod objects
 * are case-sensitive, and a mismatched key is silently treated as an unknown
 * key — which would make every env value fall back to defaults without error.
 * `.optional()` (NOT `.default()`) everywhere: in zod 4, `.default()` silently
 * swallows INVALID values as well as missing ones, masking misconfiguration.
 * Defaults are applied explicitly in applyDefaults after a successful parse.
 */
/**
 * Empty env values mean "unset" (dotenv convention: `PORT=` placeholders).
 * Without this, z.coerce.number() would turn PORT="" into 0 (Number("") === 0)
 * — a silent misconfiguration. Invalid NON-empty values still fail fast.
 */
function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value
}

export const envSchema = z.object({
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(65535).optional()),
  HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  CORS_ORIGIN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "test", "production"]).optional(),
  ),
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["fake", "claude", "openrouter"]).optional()),
  AI_TIMEOUT_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  /** Hard cap on a single intake, below the contracts limit of 20000. */
  AI_MAX_INPUT_CHARS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(20000).optional(),
  ),
  /** Requests per window allowed against the AI-backed endpoints. */
  AI_RATE_LIMIT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  AI_RATE_LIMIT_WINDOW_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  DATABASE_PATH: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // --- Claude provider (only consulted when AI_PROVIDER=claude) ---
  /** Server-side only. Never sent to the browser, never logged, never committed. */
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /**
   * Model identifier. Deliberately has NO default: model ids change over time,
   * and a hard-coded one would either rot or silently pin an outdated model.
   */
  ANTHROPIC_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ANTHROPIC_MAX_OUTPUT_TOKENS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(256).max(32000).optional(),
  ),
  ANTHROPIC_MAX_RETRIES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(5).optional(),
  ),
  /** Optional: not every model accepts an effort hint, so it is unset by default. */
  ANTHROPIC_EFFORT: z.preprocess(
    emptyToUndefined,
    z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  ),

  // --- OpenRouter provider (only consulted when AI_PROVIDER=openrouter) ---
  /**
   * Free-tier route only. `openrouter/free` or a `<vendor>/<model>:free` id;
   * anything else is rejected at parse time by assertFreeOpenRouterModel.
   */
  OPENROUTER_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENROUTER_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENROUTER_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default("https://openrouter.ai/api/v1"),
  ),
  /** Free-tier routes cap output; keep the ceiling small. */
  OPENROUTER_MAX_OUTPUT_TOKENS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(64).max(4096).optional(),
  ),
  /**
   * Bounded retries for HTTP 429 ONLY, same route, with backoff. Default 0:
   * a rate-limited free route fails rather than burning time or spending.
   */
  OPENROUTER_MAX_RETRIES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(3).optional(),
  ),
})

type ParsedEnv = z.infer<typeof envSchema>

/** Resolved Claude settings; present only when AI_PROVIDER=claude. */
export interface AnthropicConfig {
  apiKey: string
  model: string
  maxOutputTokens: number
  maxRetries: number
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
}

/** Resolved OpenRouter settings; present only when AI_PROVIDER=openrouter. */
export interface OpenRouterConfig {
  apiKey: string
  /** Always a free-tier route: validated by assertFreeOpenRouterModel. */
  model: string
  maxOutputTokens: number
  /** Bounded 429-only retries, same route, with backoff. Default 0. */
  maxRetries: number
  baseUrl: string
}

export interface AppConfig {
  port: number
  host: string
  corsOrigin: string
  nodeEnv: "development" | "test" | "production"
  aiProvider: "fake" | "claude" | "openrouter"
  aiTimeoutMs: number
  aiMaxInputChars: number
  aiRateLimit: number
  aiRateLimitWindowMs: number
  databasePath: string
  anthropic: AnthropicConfig | null
  openrouter: OpenRouterConfig | null
}

export const DEFAULT_CONFIG: AppConfig = {
  port: 8787,
  host: "localhost",
  corsOrigin: "http://localhost:5173",
  nodeEnv: "development",
  aiProvider: "fake",
  aiTimeoutMs: 30000,
  aiMaxInputChars: 8000,
  aiRateLimit: 10,
  aiRateLimitWindowMs: 60_000,
  databasePath: "data/shiftpilot.db",
  anthropic: null,
  openrouter: null,
}

function applyDefaults(env: ParsedEnv): AppConfig {
  return {
    port: env.PORT ?? DEFAULT_CONFIG.port,
    host: env.HOST ?? DEFAULT_CONFIG.host,
    corsOrigin: env.CORS_ORIGIN ?? DEFAULT_CONFIG.corsOrigin,
    nodeEnv: env.NODE_ENV ?? DEFAULT_CONFIG.nodeEnv,
    aiProvider: env.AI_PROVIDER ?? DEFAULT_CONFIG.aiProvider,
    aiTimeoutMs: env.AI_TIMEOUT_MS ?? DEFAULT_CONFIG.aiTimeoutMs,
    aiMaxInputChars: env.AI_MAX_INPUT_CHARS ?? DEFAULT_CONFIG.aiMaxInputChars,
    aiRateLimit: env.AI_RATE_LIMIT ?? DEFAULT_CONFIG.aiRateLimit,
    aiRateLimitWindowMs: env.AI_RATE_LIMIT_WINDOW_MS ?? DEFAULT_CONFIG.aiRateLimitWindowMs,
    databasePath: env.DATABASE_PATH ?? DEFAULT_CONFIG.databasePath,
    anthropic: null,
    openrouter: null,
  }
}

/**
 * zod-validated environment, fail-fast at boot (docs/architecture.md §7 case 13).
 * Pure: takes an env record so tests can exercise every invalid shape.
 */
export function parseAppConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")
    throw new Error(`Invalid environment configuration: ${detail}`)
  }
  const config = applyDefaults(result.data)
  if (config.aiProvider === "claude") {
    return withClaudeConfig(config, result.data)
  }
  if (config.aiProvider === "openrouter") {
    return withOpenRouterConfig(config, result.data)
  }
  return config
}

/**
 * Fail fast and loudly: a half-configured Claude mode must never start and
 * must never quietly degrade to the offline provider, or an operator could
 * believe real AI is running when it is not.
 */
function withClaudeConfig(config: AppConfig, env: ParsedEnv): AppConfig {
  const missing: string[] = []
  if (env.ANTHROPIC_API_KEY === undefined) missing.push("ANTHROPIC_API_KEY")
  if (env.ANTHROPIC_MODEL === undefined) missing.push("ANTHROPIC_MODEL")
  if (missing.length > 0) {
    throw new Error(
      `AI_PROVIDER=claude requires ${missing.join(" and ")}. ` +
        "Set them in apps/api/.env (never in source control), or use AI_PROVIDER=fake " +
        "for the offline provider. See .env.example.",
    )
  }

  return {
    ...config,
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY!,
      model: env.ANTHROPIC_MODEL!,
      maxOutputTokens: env.ANTHROPIC_MAX_OUTPUT_TOKENS ?? 4096,
      maxRetries: env.ANTHROPIC_MAX_RETRIES ?? 2,
      ...(env.ANTHROPIC_EFFORT ? { effort: env.ANTHROPIC_EFFORT } : {}),
    },
  }
}

/**
 * OpenRouter mode is free-tier only. A paid OPENROUTER_MODEL is refused here,
 * at parse time, before any provider can be constructed — the same guard the
 * provider itself runs before every inference.
 */
function withOpenRouterConfig(config: AppConfig, env: ParsedEnv): AppConfig {
  const missing: string[] = []
  if (env.OPENROUTER_API_KEY === undefined) missing.push("OPENROUTER_API_KEY")
  if (env.OPENROUTER_MODEL === undefined) missing.push("OPENROUTER_MODEL")
  if (missing.length > 0) {
    throw new Error(
      `AI_PROVIDER=openrouter requires ${missing.join(" and ")}. ` +
        "Set them in apps/api/.env (never in source control), or use AI_PROVIDER=fake " +
        "for the offline provider. See .env.example.",
    )
  }

  // The mandatory guard: reject paid/non-free routes before anything runs.
  assertFreeOpenRouterModel(env.OPENROUTER_MODEL!)

  return {
    ...config,
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY!,
      model: env.OPENROUTER_MODEL!,
      maxOutputTokens: env.OPENROUTER_MAX_OUTPUT_TOKENS ?? 1024,
      maxRetries: env.OPENROUTER_MAX_RETRIES ?? 0,
      baseUrl: env.OPENROUTER_BASE_URL!,
    },
  }
}
