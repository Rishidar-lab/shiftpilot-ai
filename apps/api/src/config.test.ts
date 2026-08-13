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

  describe("claude provider configuration", () => {
    it("refuses to start when the key or model is missing", () => {
      expect(() => parseAppConfig({ AI_PROVIDER: "claude" })).toThrow(
        /requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL/,
      )
      expect(() => parseAppConfig({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "sk-test" })).toThrow(
        /requires ANTHROPIC_MODEL/,
      )
      expect(() => parseAppConfig({ AI_PROVIDER: "claude", ANTHROPIC_MODEL: "a-model" })).toThrow(
        /requires ANTHROPIC_API_KEY/,
      )
    })

    // Failing to start is the point: silently serving simulated output while the
    // operator believes a real model is running would be worse than an outage.
    it("never degrades to the fake provider when claude is misconfigured", () => {
      expect(() => parseAppConfig({ AI_PROVIDER: "claude" })).toThrow()
      expect(parseAppConfig({ AI_PROVIDER: "fake" }).anthropic).toBeNull()
    })

    it("resolves claude settings with documented defaults", () => {
      const config = parseAppConfig({
        AI_PROVIDER: "claude",
        ANTHROPIC_API_KEY: "sk-test",
        ANTHROPIC_MODEL: "a-model",
      })
      expect(config.aiProvider).toBe("claude")
      expect(config.anthropic).toEqual({
        apiKey: "sk-test",
        model: "a-model",
        maxOutputTokens: 4096,
        maxRetries: 2,
      })
    })

    it("honours explicit output, retry and effort overrides", () => {
      const config = parseAppConfig({
        AI_PROVIDER: "claude",
        ANTHROPIC_API_KEY: "sk-test",
        ANTHROPIC_MODEL: "a-model",
        ANTHROPIC_MAX_OUTPUT_TOKENS: "2048",
        ANTHROPIC_MAX_RETRIES: "1",
        ANTHROPIC_EFFORT: "low",
      })
      expect(config.anthropic?.maxOutputTokens).toBe(2048)
      expect(config.anthropic?.maxRetries).toBe(1)
      expect(config.anthropic?.effort).toBe("low")
    })

    it("rejects unbounded retry and output settings", () => {
      const base = { AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" }
      expect(() => parseAppConfig({ ...base, ANTHROPIC_MAX_RETRIES: "50" })).toThrow(
        /Invalid environment configuration/,
      )
      expect(() => parseAppConfig({ ...base, ANTHROPIC_MAX_OUTPUT_TOKENS: "9999999" })).toThrow(
        /Invalid environment configuration/,
      )
      expect(() => parseAppConfig({ ...base, ANTHROPIC_EFFORT: "turbo" })).toThrow(
        /Invalid environment configuration/,
      )
    })
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
