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
})

type ParsedEnv = z.infer<typeof envSchema>

export interface AppConfig {
  port: number
  host: string
  corsOrigin: string
  nodeEnv: "development" | "test" | "production"
  aiProvider: "fake" | "claude"
  aiTimeoutMs: number
}

export const DEFAULT_CONFIG: AppConfig = {
  port: 8787,
  host: "localhost",
  corsOrigin: "http://localhost:5173",
  nodeEnv: "development",
  aiProvider: "fake",
  aiTimeoutMs: 30000,
}

function applyDefaults(env: ParsedEnv): AppConfig {
  return {
    port: env.PORT ?? DEFAULT_CONFIG.port,
    host: env.HOST ?? DEFAULT_CONFIG.host,
    corsOrigin: env.CORS_ORIGIN ?? DEFAULT_CONFIG.corsOrigin,
    nodeEnv: env.NODE_ENV ?? DEFAULT_CONFIG.nodeEnv,
    aiProvider: env.AI_PROVIDER ?? DEFAULT_CONFIG.aiProvider,
    aiTimeoutMs: env.AI_TIMEOUT_MS ?? DEFAULT_CONFIG.aiTimeoutMs,
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
    throw new Error(
      "AI_PROVIDER=claude is not available yet: the Claude provider ships in M2 " +
        "(docs/implementation-plan.md A-04). Keep AI_PROVIDER=fake for now.",
    )
  }
  return config
}
