import { describe, expect, it } from "vitest"

import { parseAppConfig } from "./config.js"

describe("parseAppConfig", () => {
  it("applies defaults for an empty environment", () => {
    const config = parseAppConfig({})
    expect(config.port).toBe(8787)
    expect(config.host).toBe("localhost")
    expect(config.corsOrigin).toBe("http://localhost:5173")
    expect(config.nodeEnv).toBe("development")
    expect(config.aiProvider).toBe("fake")
    expect(config.aiTimeoutMs).toBe(30000)
  })

  it("parses explicit values", () => {
    const config = parseAppConfig({
      PORT: "9000",
      CORS_ORIGIN: "https://app.example.com",
      NODE_ENV: "production",
      AI_PROVIDER: "fake",
    })
    expect(config.port).toBe(9000)
    expect(config.corsOrigin).toBe("https://app.example.com")
    expect(config.nodeEnv).toBe("production")
  })

  it("fails fast on invalid values", () => {
    expect(() => parseAppConfig({ PORT: "not-a-number" })).toThrow(
      /Invalid environment configuration/,
    )
    expect(() => parseAppConfig({ AI_PROVIDER: "gemini" })).toThrow(
      /Invalid environment configuration/,
    )
    expect(() => parseAppConfig({ CORS_ORIGIN: "nope" })).toThrow(
      /Invalid environment configuration/,
    )
  })

  it("treats an empty value as unset (dotenv convention), never as 0", () => {
    const config = parseAppConfig({ PORT: "" })
    expect(config.port).toBe(8787)
  })

  it("fails fast on AI_PROVIDER=claude until the real provider is wired", () => {
    expect(() => parseAppConfig({ AI_PROVIDER: "claude" })).toThrow(
      /AI_PROVIDER=claude is not wired yet/,
    )
  })

  it("applies cost-control defaults and honours overrides", () => {
    const defaults = parseAppConfig({})
    expect(defaults.aiMaxInputChars).toBe(8000)
    expect(defaults.aiRateLimit).toBe(10)
    expect(defaults.aiRateLimitWindowMs).toBe(60_000)

    const custom = parseAppConfig({
      AI_MAX_INPUT_CHARS: "500",
      AI_RATE_LIMIT: "3",
      AI_RATE_LIMIT_WINDOW_MS: "1000",
    })
    expect(custom.aiMaxInputChars).toBe(500)
    expect(custom.aiRateLimit).toBe(3)
    expect(custom.aiRateLimitWindowMs).toBe(1000)
  })

  it("rejects cost-control values that would disable the protection", () => {
    expect(() => parseAppConfig({ AI_RATE_LIMIT: "0" })).toThrow(
      /Invalid environment configuration/,
    )
    expect(() => parseAppConfig({ AI_MAX_INPUT_CHARS: "99999" })).toThrow(
      /Invalid environment configuration/,
    )
  })
})
