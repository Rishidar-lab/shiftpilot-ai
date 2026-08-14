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

  describe("openrouter provider configuration", () => {
    const PAID = [
      "anthropic/claude-sonnet-5",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.3-70b-instruct",
    ]

    it("refuses to start when the key or model is missing", () => {
      expect(() => parseAppConfig({ AI_PROVIDER: "openrouter" })).toThrow(
        /requires OPENROUTER_API_KEY and OPENROUTER_MODEL/,
      )
      expect(() =>
        parseAppConfig({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-v1-x" }),
      ).toThrow(/requires OPENROUTER_MODEL/)
      expect(() =>
        parseAppConfig({ AI_PROVIDER: "openrouter", OPENROUTER_MODEL: "openrouter/free" }),
      ).toThrow(/requires OPENROUTER_API_KEY/)
    })

    // The mandatory guard lives here too: a paid OPENROUTER_MODEL must be
    // refused at parse time, before any provider could be constructed.
    it("rejects every paid/non-free OPENROUTER_MODEL at parse time", () => {
      for (const model of PAID) {
        expect(
          () =>
            parseAppConfig({
              AI_PROVIDER: "openrouter",
              OPENROUTER_API_KEY: "sk-or-v1-x",
              OPENROUTER_MODEL: model,
            }),
          model,
        ).toThrow(/Paid\/non-free OpenRouter model rejected/)
      }
    })

    it("never degrades to the fake provider when openrouter is misconfigured", () => {
      expect(() => parseAppConfig({ AI_PROVIDER: "openrouter" })).toThrow()
      expect(parseAppConfig({ AI_PROVIDER: "fake" }).openrouter).toBeNull()
    })

    it("resolves free openrouter settings with documented defaults", () => {
      const config = parseAppConfig({
        AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-v1-x",
        OPENROUTER_MODEL: "openrouter/free",
      })
      expect(config.aiProvider).toBe("openrouter")
      expect(config.openrouter).toEqual({
        apiKey: "sk-or-v1-x",
        model: "openrouter/free",
        maxOutputTokens: 1024,
        maxRetries: 0,
        baseUrl: "https://openrouter.ai/api/v1",
      })
    })

    it("accepts any <vendor>/<model>:free id", () => {
      const config = parseAppConfig({
        AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-v1-x",
        OPENROUTER_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
      })
      expect(config.openrouter?.model).toBe("meta-llama/llama-3.3-70b-instruct:free")
    })

    it("honours explicit base URL and output overrides", () => {
      const config = parseAppConfig({
        AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-v1-x",
        OPENROUTER_MODEL: "openrouter/free",
        OPENROUTER_BASE_URL: "https://proxy.example.com/api/v1",
        OPENROUTER_MAX_OUTPUT_TOKENS: "256",
      })
      expect(config.openrouter?.baseUrl).toBe("https://proxy.example.com/api/v1")
      expect(config.openrouter?.maxOutputTokens).toBe(256)
    })

    it("rejects an output ceiling outside the free-tier bounds", () => {
      const base = {
        AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-v1-x",
        OPENROUTER_MODEL: "openrouter/free",
      }
      expect(() => parseAppConfig({ ...base, OPENROUTER_MAX_OUTPUT_TOKENS: "63" })).toThrow(
        /Invalid environment configuration/,
      )
      expect(() => parseAppConfig({ ...base, OPENROUTER_MAX_OUTPUT_TOKENS: "4097" })).toThrow(
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
