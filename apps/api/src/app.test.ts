import { describe, expect, it } from "vitest"

import { HealthResponse } from "@shiftpilot/contracts"
import { buildApp } from "./app.js"
import { parseAppConfig } from "./config.js"
import { openDatabase } from "./db/index.js"

function makeTestApp() {
  const config = parseAppConfig({ NODE_ENV: "test" })
  const db = openDatabase(":memory:")
  return { app: buildApp({ config, db }), db }
}

describe("GET /health", () => {
  it("returns a valid health envelope at /api/health", async () => {
    const { app } = makeTestApp()
    const response = await app.inject({ method: "GET", url: "/api/health" })

    expect(response.statusCode).toBe(200)
    const parsed = HealthResponse.safeParse(response.json())
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.status).toBe("ok")
    expect(parsed.data.provider).toBe("fake")
  })

  it("exposes a bare /health for infrastructure probes", async () => {
    const { app } = makeTestApp()
    const response = await app.inject({ method: "GET", url: "/health" })
    expect(response.statusCode).toBe(200)
  })

  it("returns a typed 404 envelope for unknown routes", async () => {
    const { app } = makeTestApp()
    const response = await app.inject({ method: "GET", url: "/nope" })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: { code: "not_found", message: "route not found" } })
  })
})
