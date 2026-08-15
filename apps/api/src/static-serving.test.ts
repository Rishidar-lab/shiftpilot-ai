import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { buildApp } from "./app.js"
import { parseAppConfig } from "./config.js"
import { openDatabase } from "./db/index.js"
import { makeProvider } from "./ai.js"

/**
 * Single-service production mode (docs/deployment.md): one Node process serves
 * the built browser app AND the API from one origin, because the web client's
 * base URL is the relative "/api".
 *
 * The load-bearing rule is the split in the not-found handler: page requests
 * fall back to the SPA shell, /api requests stay JSON. Getting that backwards
 * means a mistyped endpoint answers 200 text/html and every client error turns
 * into an unparseable page.
 */

const dirs: string[] = []

function makeWebRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "shiftpilot-web-"))
  dirs.push(root)
  writeFileSync(join(root, "index.html"), "<!doctype html><title>ShiftPilot</title><div id=root>")
  mkdirSync(join(root, "assets"))
  writeFileSync(join(root, "assets", "app.js"), "export const built = true\n")
  return root
}

function makeApp(env: Record<string, string | undefined>) {
  const config = parseAppConfig({ NODE_ENV: "test", ...env })
  const db = openDatabase(":memory:")
  return buildApp({ config, db, provider: makeProvider(config) })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("single-service static serving", () => {
  it("serves the built app at /", async () => {
    const app = makeApp({ WEB_ROOT: makeWebRoot() })
    const response = await app.inject({ method: "GET", url: "/" })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.body).toContain("ShiftPilot")
  })

  it("serves built assets", async () => {
    const app = makeApp({ WEB_ROOT: makeWebRoot() })
    const response = await app.inject({ method: "GET", url: "/assets/app.js" })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("built = true")
  })

  it("falls back to the app shell for client-side routes", async () => {
    const app = makeApp({ WEB_ROOT: makeWebRoot() })
    const response = await app.inject({ method: "GET", url: "/shifts/some-client-route" })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.body).toContain("ShiftPilot")
  })

  it("keeps unknown /api routes a JSON 404, never the app shell", async () => {
    const app = makeApp({ WEB_ROOT: makeWebRoot() })
    const response = await app.inject({ method: "GET", url: "/api/not-a-real-endpoint" })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: { code: "not_found", message: "route not found" } })
  })

  it("does not fall back for non-page methods", async () => {
    const app = makeApp({ WEB_ROOT: makeWebRoot() })
    const response = await app.inject({ method: "POST", url: "/definitely-not-a-page" })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: { code: "not_found", message: "route not found" } })
  })

  it("still serves the API alongside the app", async () => {
    const app = makeApp({ WEB_ROOT: makeWebRoot() })
    const response = await app.inject({ method: "GET", url: "/api/health" })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: "ok", provider: "fake" })
  })

  it("refuses to start when WEB_ROOT has no built app in it", () => {
    const empty = mkdtempSync(join(tmpdir(), "shiftpilot-empty-"))
    dirs.push(empty)

    expect(() => makeApp({ WEB_ROOT: empty })).toThrow(/no index\.html/)
  })

  it("keeps the API-only 404 behaviour when WEB_ROOT is unset", async () => {
    const app = makeApp({})
    const response = await app.inject({ method: "GET", url: "/" })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: { code: "not_found", message: "route not found" } })
  })
})
