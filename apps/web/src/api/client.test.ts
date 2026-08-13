import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClient, ApiError } from "./client.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("ApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("decodes a valid health response through zod", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "ok",
          version: "0.1.0",
          provider: "fake",
          providerLabel: "Fake (offline heuristic) — simulated, not a real LLM",
          providerIsFake: true,
          model: null,
          promptVersion: "fake-1",
          time: "2026-08-12T00:00:00.000Z",
        }),
      ),
    )

    const health = await new ApiClient("http://api.test").getHealth()
    expect(health.status).toBe("ok")
    expect(health.provider).toBe("fake")
    expect(health.providerIsFake).toBe(true)
  })

  it("maps a typed API error envelope to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: "ai_unavailable", message: "provider down" } }, 503),
        ),
    )

    const error = await new ApiClient("http://api.test").getHealth().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) return
    expect(error.code).toBe("ai_unavailable")
    expect(error.message).toBe("provider down")
  })

  it("rejects a malformed success payload as internal error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "weird" })))

    const error = await new ApiClient("http://api.test").getHealth().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) return
    expect(error.code).toBe("internal")
  })
})
