/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { App } from "./App.js"

const HEALTH = {
  status: "ok",
  version: "0.1.0",
  provider: "fake",
  providerLabel: "Fake heuristic",
  providerIsFake: true,
  model: null,
  promptVersion: "fake-1",
  time: "2026-08-12T08:00:00.000Z",
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.location.hash = ""
})

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/health")) return Promise.resolve(jsonResponse(HEALTH))
      if (url.endsWith("/api/shifts")) return Promise.resolve(jsonResponse([]))
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
})

describe("App routing", () => {
  it("serves the landing page at the bare hash", () => {
    window.location.hash = "#/"
    render(<App />)
    expect(
      screen.getByRole("heading", { name: "Turn messy work into an explainable plan." }),
    ).toBeDefined()
  })

  it("opens the workspace from the hero CTA", async () => {
    window.location.hash = "#/"
    render(<App />)

    await userEvent.click(screen.getAllByRole("button", { name: "Open ShiftPilot" })[0]!)
    await screen.findByRole("button", { name: "Create today's shift" })
    expect(window.location.hash).toMatch(/^#\/app\/intake$/)
  })

  it("loads a workspace directly from an app hash", async () => {
    window.location.hash = "#/app/plan"
    render(<App />)
    await screen.findByRole("button", { name: "Create today's shift" })
    expect(window.location.hash).toMatch(/^#\/app\/plan$/)
  })

  it("warns honestly when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      }),
    )
    window.location.hash = "#/app"
    render(<App />)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("API unavailable")
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0),
    )
  })
})
