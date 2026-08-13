import { z } from "zod"

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
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["fake", "claude"]).optional()),
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

export interface AppConfig {
  port: number
  host: string
  corsOrigin: string
  nodeEnv: "development" | "test" | "production"
  aiProvider: "fake" | "claude"
  aiTimeoutMs: number
  aiMaxInputChars: number
  aiRateLimit: number
  aiRateLimitWindowMs: number
  databasePath: string
  anthropic: AnthropicConfig | null
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
  if (config.aiProvider !== "claude") return config

  // Fail fast and loudly: a half-configured Claude mode must never start and
  // must never quietly degrade to the offline provider, or an operator could
  // believe real AI is running when it is not.
  const missing: string[] = []
  if (result.data.ANTHROPIC_API_KEY === undefined) missing.push("ANTHROPIC_API_KEY")
  if (result.data.ANTHROPIC_MODEL === undefined) missing.push("ANTHROPIC_MODEL")
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
      apiKey: result.data.ANTHROPIC_API_KEY!,
      model: result.data.ANTHROPIC_MODEL!,
      maxOutputTokens: result.data.ANTHROPIC_MAX_OUTPUT_TOKENS ?? 4096,
      maxRetries: result.data.ANTHROPIC_MAX_RETRIES ?? 2,
      ...(result.data.ANTHROPIC_EFFORT ? { effort: result.data.ANTHROPIC_EFFORT } : {}),
    },
  }
}
