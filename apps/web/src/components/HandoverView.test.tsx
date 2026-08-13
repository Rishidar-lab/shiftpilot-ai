/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClient, ApiError } from "../api/client.js"
import { HandoverView } from "./HandoverView.js"
import type { HandoverFacts, HandoverResponse } from "@shiftpilot/contracts"

afterEach(cleanup)

const FACTS: HandoverFacts = {
  shiftId: "shift-1",
  date: "2026-08-12",
  generatedAt: "2026-08-12T13:00:00.000Z",
  counts: {
    total: 2,
    active: 1,
    inProgress: 0,
    completed: 1,
    blocked: 0,
    cancelled: 0,
    overdue: 1,
    waiting: 0,
  },
  completed: [{ taskId: "c1", title: "Cold chain check", completedAt: "2026-08-12T07:00:00.000Z" }],
  pending: [
    {
      taskId: "p1",
      title: "Unfreeze walk-in",
      priorityBucket: "high",
      deadlineAt: "2026-08-12T07:00:00.000Z",
      dueInMin: -360,
    },
  ],
  blocked: [],
  overdue: [{ taskId: "p1", title: "Unfreeze walk-in", overdueMin: 360 }],
  upcomingDeadlines: [],
  warnings: [],
  recommendations: [],
}

function clientWith(narrative: () => Promise<HandoverResponse>): ApiClient {
  const client = new ApiClient()
  vi.spyOn(client, "getHandover").mockResolvedValue(FACTS)
  vi.spyOn(client, "generateHandoverNarrative").mockImplementation(narrative)
  return client
}

/** Wait for the deterministic facts to finish loading. */
async function renderView(client: ApiClient) {
  render(<HandoverView client={client} shiftId="shift-1" />)
  await screen.findByText("Cold chain check")
}

describe("HandoverView — deterministic facts", () => {
  it("renders the facts without calling the AI provider", async () => {
    const generate = vi.fn()
    const client = clientWith(generate)
    await renderView(client)

    expect(screen.getByText("Cold chain check")).toBeDefined()
    // Appears under both Pending and Overdue, which is correct.
    expect(screen.getAllByText("Unfreeze walk-in").length).toBe(2)
    // Prose costs money; it must never be requested just by opening the tab.
    expect(generate).not.toHaveBeenCalled()
  })

  it("keeps the facts visible while prose is being written", async () => {
    let release: (value: HandoverResponse) => void = () => {}
    const client = clientWith(() => new Promise((resolve) => (release = resolve)))
    await renderView(client)

    await userEvent.click(screen.getByRole("button", { name: /write ai summary/i }))
    expect(screen.getByRole("status")).toBeDefined()
    expect(screen.getByText("Cold chain check")).toBeDefined()

    release({
      facts: FACTS,
      narrative: { headline: "Steady", summary: "Fine.", attention: [] },
      degraded: null,
      provider: "fake",
      promptVersion: "fake-1",
    })
    await waitFor(() => expect(screen.getByText("Steady")).toBeDefined())
  })
})

describe("HandoverView — AI prose", () => {
  it("labels AI-written text and titles attention items from the facts", async () => {
    const client = clientWith(async () => ({
      facts: FACTS,
      narrative: {
        headline: "One item carried over",
        summary: "Most of the list cleared.",
        // The model supplies an id and a reason — never a title.
        attention: [{ taskId: "p1", why: "Past its deadline." }],
      },
      degraded: null,
      provider: "claude",
      promptVersion: "claude-1",
    }))
    await renderView(client)
    await userEvent.click(screen.getByRole("button", { name: /write ai summary/i }))

    await screen.findByText("One item carried over")
    expect(screen.getByText(/AI-written/)).toBeDefined()
    // The title rendered next to the reason comes from the facts.
    expect(screen.getAllByText("Unfreeze walk-in").length).toBeGreaterThan(0)
    expect(screen.getByText(/Past its deadline/)).toBeDefined()
  })
})

describe("HandoverView — degraded mode", () => {
  it("shows a labelled degraded state and keeps the facts when the provider fails", async () => {
    const client = clientWith(async () => ({
      facts: FACTS,
      narrative: null,
      degraded: { reason: "provider_failure", detail: "The AI provider did not respond in time." },
      provider: "claude",
      promptVersion: "claude-1",
    }))
    await renderView(client)
    await userEvent.click(screen.getByRole("button", { name: /write ai summary/i }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/AI summary unavailable/i)
    expect(alert.textContent).toMatch(/did not respond in time/i)
    // The whole point: the handover itself survives.
    expect(screen.getByText("Cold chain check")).toBeDefined()
    expect(screen.getAllByText("Unfreeze walk-in").length).toBe(2)
  })

  it("explains a rejected hallucination rather than showing it", async () => {
    const client = clientWith(async () => ({
      facts: FACTS,
      narrative: null,
      degraded: { reason: "unknown_task_reference", detail: "referenced 1 task id(s) absent" },
      provider: "claude",
      promptVersion: "claude-1",
    }))
    await renderView(client)
    await userEvent.click(screen.getByRole("button", { name: /write ai summary/i }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/not in this shift/i)
  })

  it("surfaces a transport failure instead of rendering an empty success", async () => {
    // A failed request must never look like a blank summary (audit A-24).
    const client = clientWith(async () => {
      throw new ApiError("ai_unavailable", "The AI provider is unavailable.")
    })
    await renderView(client)
    await userEvent.click(screen.getByRole("button", { name: /write ai summary/i }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/AI summary unavailable/i)
    expect(screen.getByText("Cold chain check")).toBeDefined()
  })

  it("offers a retry that can succeed on a second attempt", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("ai_unavailable", "temporarily down"))
      .mockResolvedValueOnce({
        facts: FACTS,
        narrative: { headline: "Recovered", summary: "Second try worked.", attention: [] },
        degraded: null,
        provider: "claude",
        promptVersion: "claude-1",
      })
    const client = clientWith(generate)
    await renderView(client)

    await userEvent.click(screen.getByRole("button", { name: /write ai summary/i }))
    await screen.findByRole("alert")
    await userEvent.click(screen.getByRole("button", { name: /try again/i }))

    await waitFor(() => expect(screen.getByText("Recovered")).toBeDefined())
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
