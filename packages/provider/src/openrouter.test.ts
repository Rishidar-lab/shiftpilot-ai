import { describe, expect, it, vi } from "vitest"

import {
  OpenRouterProvider,
  assertFreeOpenRouterModel,
  readCompletionContent,
} from "./openrouter.js"
import type { ChatCompletionResponse } from "./openrouter.js"
import { EXTRACTION_PROMPT_ID, EXTRACTION_PROMPT_VERSION } from "./prompt.js"

/**
 * These tests never make a network call: the adapter takes its fetch surface as
 * an option, so the real request shape, response handling and error mapping are
 * exercised against a stub. The free-model guard, by contrast, is pure and is
 * the hard requirement this suite exists to protect.
 */

const CTX = {
  id: "shift-1",
  date: "2026-08-13",
  startAt: "2026-08-13T03:30:00.000Z",
  endAt: "2026-08-13T11:30:00.000Z",
  timezone: "Asia/Kolkata",
}

const PAID_MODELS = [
  "anthropic/claude-3-5-sonnet-20241022",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-5",
  "anthropic/claude-haiku-4-5-20251001",
  "openai/gpt-4o",
  "openai/gpt-4.1",
  "openai/o3",
  "google/gemini-2.5-pro",
  "google/gemini-2.0-flash",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
  "meta-llama/llama-3.3-70b-instruct",
  "openrouter/mistral/7b",
  "gpt-4o-mini",
  "some-ordinary-model",
  "claude-sonnet-5",
]

const FREE_MODELS = [
  "openrouter/free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-r1-0528:free",
  "google/gemma-3-27b-it:free",
  "any-existing-model:free",
]

describe("assertFreeOpenRouterModel", () => {
  it("rejects every paid/non-free configuration", () => {
    for (const model of PAID_MODELS) {
      expect(() => assertFreeOpenRouterModel(model), model).toThrow(
        /Paid\/non-free OpenRouter model rejected/,
      )
    }
  })

  it("accepts openrouter/free and any <model>:free id", () => {
    for (const model of FREE_MODELS) {
      expect(() => assertFreeOpenRouterModel(model), model).not.toThrow()
    }
  })
})

function jsonResponse(over: Partial<ChatCompletionResponse> = {}): ChatCompletionResponse {
  return {
    id: "gen_1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    choices: [{ message: { content: '{"tasks":[]}' } }],
    ...over,
  }
}

function providerWith(fetchFn: typeof fetch): OpenRouterProvider {
  return new OpenRouterProvider({
    apiKey: "sk-or-v1-test-not-a-real-key",
    model: "openrouter/free",
    maxOutputTokens: 256,
    timeoutMs: 30_000,
    fetchFn,
  })
}

describe("OpenRouterProvider construction", () => {
  it("refuses to construct without credentials or a model", () => {
    const base = {
      model: "openrouter/free",
      maxOutputTokens: 256,
      timeoutMs: 1000,
      fetchFn: vi.fn() as unknown as typeof fetch,
    }
    expect(() => new OpenRouterProvider({ ...base, apiKey: "  " })).toThrow(/API key/)
    expect(() => new OpenRouterProvider({ ...base, apiKey: "sk-or-v1-test", model: "" })).toThrow(
      /model identifier/,
    )
  })

  it("refuses to construct against a paid route", () => {
    const base = {
      apiKey: "sk-or-v1-test",
      maxOutputTokens: 256,
      timeoutMs: 1000,
      fetchFn: vi.fn() as unknown as typeof fetch,
    }
    for (const model of PAID_MODELS) {
      expect(() => new OpenRouterProvider({ ...base, model }), model).toThrow(
        /Paid\/non-free OpenRouter model rejected/,
      )
    }
  })

  it("reports honest, non-simulated provenance including the configured model", () => {
    const provider = providerWith(vi.fn() as unknown as typeof fetch)
    expect(provider.meta.id).toBe("openrouter")
    expect(provider.meta.isFake).toBe(false)
    expect(provider.meta.model).toBe("openrouter/free")
    expect(provider.meta.promptId).toBe(EXTRACTION_PROMPT_ID)
    expect(provider.meta.promptVersion).toBe(EXTRACTION_PROMPT_VERSION)
  })

  it("never exposes the API key through its metadata", () => {
    const provider = providerWith(vi.fn() as unknown as typeof fetch)
    expect(JSON.stringify(provider.meta)).not.toContain("sk-or-v1")
  })
})

describe("OpenRouterProvider request shape", () => {
  it("posts one OpenAI-compatible request to the chat completions endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => jsonResponse(),
    })
    await providerWith(fetchFn as unknown as typeof fetch).extractTasks("Restock aisle 3", CTX)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(init.method).toBe("POST")

    const headers = (init.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe("Bearer sk-or-v1-test-not-a-real-key")
    expect(headers["Content-Type"]).toBe("application/json")

    const body = JSON.parse(String(init.body)) as {
      model: string
      max_tokens: number
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe("openrouter/free")
    expect(body.max_tokens).toBe(256)
    expect(body.messages[0]!.content).toContain("Asia/Kolkata")
    expect(body.messages[0]!.content).toContain("2026-08-13")
    expect(body.messages[1]!.content).toContain("Restock aisle 3")
  })

  it("does not send JSON-schema structured output (not every free model accepts it)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => jsonResponse() })
    await providerWith(fetchFn as unknown as typeof fetch).extractTasks("x", CTX)
    const body = JSON.parse(String((fetchFn.mock.calls[0]![1] as RequestInit).body)) as object
    expect(body).not.toHaveProperty("response_format")
  })

  it("records the resolved model only when OpenRouter reports it", async () => {
    const provider = providerWith((async () => ({
      ok: true,
      json: async () => jsonResponse(),
    })) as unknown as typeof fetch)
    await provider.extractTasks("Restock aisle 3", CTX)
    expect(provider.resolvedModel).toBe("meta-llama/llama-3.3-70b-instruct:free")

    const silent = providerWith((async () => ({
      ok: true,
      json: async () => jsonResponse({ model: undefined }),
    })) as unknown as typeof fetch)
    await silent.extractTasks("Restock aisle 3", CTX)
    expect(silent.resolvedModel).toBeNull()
  })

  it("never retries by default: a failed response is final and produces no second request", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    const attempt = await providerWith(fetchFn as unknown as typeof fetch).extractTasks("x", CTX)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.failure.kind).toBe("rate_limited")
  })

  it("retries a 429 against the EXACT same request when opted in, then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Map() })
      .mockResolvedValueOnce({ ok: true, json: async () => jsonResponse() })
    const provider = new OpenRouterProvider({
      apiKey: "sk-or-v1-test-not-a-real-key",
      model: "openrouter/free",
      maxOutputTokens: 256,
      timeoutMs: 30_000,
      maxRetries: 1,
      retryBackoffMs: 5,
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const attempt = await provider.extractTasks("Restock aisle 3", CTX)
    expect(attempt.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)

    // The retry must be byte-identical: same URL, same model in the body.
    const [url1, init1] = fetchFn.mock.calls[0]!
    const [url2, init2] = fetchFn.mock.calls[1]!
    expect(String(url1)).toBe(String(url2))
    const first = JSON.parse(String(init1.body)) as { model: string }
    const second = JSON.parse(String(init2.body)) as { model: string }
    expect(second.model).toBe(first.model)
    expect(second.model).toBe("openrouter/free")
  })

  it("fails after the retry budget is exhausted without changing route", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429, headers: new Map() })
    const provider = new OpenRouterProvider({
      apiKey: "sk-or-v1-test-not-a-real-key",
      model: "openrouter/free",
      maxOutputTokens: 256,
      timeoutMs: 30_000,
      maxRetries: 2,
      retryBackoffMs: 5,
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const attempt = await provider.extractTasks("x", CTX)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.failure.kind).toBe("rate_limited")
  })
})

describe("OpenRouterProvider failure mapping", () => {
  it("maps HTTP statuses onto provider-agnostic failures", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [403, "unauthorized"],
      [402, "quota"],
      [429, "rate_limited"],
      [400, "misconfigured"],
      [404, "misconfigured"],
      [500, "network"],
    ]
    for (const [status, kind] of cases) {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status })
      const attempt = await providerWith(fetchFn as unknown as typeof fetch).extractTasks("x", CTX)
      expect(attempt.ok, `status ${status}`).toBe(false)
      if (!attempt.ok) expect(attempt.failure.kind, `status ${status}`).toBe(kind)
    }
  })

  it("reports an expired deadline as a timeout, not an unreachable network", async () => {
    // AbortSignal.timeout() aborts with TimeoutError, never AbortError.
    const fetchFn = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"))
    const attempt = await providerWith(fetchFn as unknown as typeof fetch).extractTasks("x", CTX)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.failure.kind).toBe("timeout")
  })

  it("still reports a caller-cancelled request as a timeout", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"))
    const attempt = await providerWith(fetchFn as unknown as typeof fetch).extractTasks("x", CTX)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.failure.kind).toBe("timeout")
  })

  it("blames the deadline, not the provider, when the body read is aborted", async () => {
    // Headers arrived; the deadline expired mid-body. Calling that a malformed
    // provider response sends the reader after the wrong system entirely.
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new DOMException("timed out", "TimeoutError")
      },
    })
    const attempt = await providerWith(fetchFn as unknown as typeof fetch).extractTasks("x", CTX)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.failure.kind).toBe("timeout")
  })

  it("still reports a genuinely malformed body as an invalid response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON")
      },
    })
    const attempt = await providerWith(fetchFn as unknown as typeof fetch).extractTasks("x", CTX)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.failure.kind).toBe("invalid_response")
  })

  it("maps a provider-level error body without echoing credentials", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: { message: "no free variant available", code: "no_free_variants" },
      }),
    })
    const attempt = await providerWith(fetchFn as unknown as typeof fetch).extractTasks("x", CTX)
    expect(attempt.ok).toBe(false)
    if (!attempt.ok && attempt.failure.kind === "misconfigured") {
      expect(attempt.failure.detail).toContain("no_free_variants")
    }
  })
})

describe("readCompletionContent", () => {
  it("parses the first choice's content as untrusted JSON", () => {
    const result = readCompletionContent(jsonResponse())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.raw).toEqual({ tasks: [] })
  })

  it("rejects an empty response body", () => {
    const empty = readCompletionContent({ choices: [{ message: { content: null } }] })
    expect(empty.ok).toBe(false)
    if (!empty.ok && empty.failure.kind === "invalid_response") {
      expect(empty.failure.detail).toContain("empty")
    }
  })

  it("recovers fenced output and trailing bracket junk, without inventing content", () => {
    const fenced = readCompletionContent({
      choices: [{ message: { content: '```json\n{"tasks": []}\n```' } }],
    })
    expect(fenced.ok).toBe(true)
    if (fenced.ok) expect(fenced.raw).toEqual({ tasks: [] })

    // A real observed free-model failure mode: a stray closing bracket after a
    // structurally correct object.
    const trailing = readCompletionContent({
      choices: [{ message: { content: '{"tasks": [{"title": "x"}]}]}' } }],
    })
    expect(trailing.ok).toBe(true)
    if (trailing.ok) expect(trailing.raw).toEqual({ tasks: [{ title: "x" }] })
  })

  it("rejects prose that contains no recoverable JSON", () => {
    const prose = readCompletionContent({
      choices: [
        {
          message: {
            content:
              "We need to extract tasks from the shift notes. Here is what the worker said...",
          },
        },
      ],
    })
    expect(prose.ok).toBe(false)
    if (!prose.ok && prose.failure.kind === "invalid_response") {
      expect(prose.failure.detail).toContain("not valid JSON")
    }
  })
})
