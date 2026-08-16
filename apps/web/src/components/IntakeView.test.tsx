/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClient, ApiError } from "../api/client.js"
import type { IntakeResult } from "../api/client.js"
import { FakeProviderBadge } from "./FakeProviderBadge.js"
import { IntakeView } from "./IntakeView.js"
import type { ExtractionDraft } from "@shiftpilot/contracts"

afterEach(cleanup)

function draft(over: Partial<ExtractionDraft> = {}): ExtractionDraft {
  return {
    id: "draft-0",
    index: 0,
    disposition: "accepted",
    title: "Restock aisle 3",
    description: null,
    category: "other",
    estimatedMinutes: 15,
    estimateSource: "stated",
    deadlineAt: null,
    deadlineSource: "unresolved",
    deadlineHint: null,
    explicitUrgency: "none",
    dependsOn: [],
    sourceText: "Restock aisle 3",
    rejectionReason: null,
    reasons: [],
    ...over,
  }
}

function intake(drafts: ExtractionDraft[]): IntakeResult {
  return {
    rawInput: {
      id: "raw-1",
      shiftId: "shift-1",
      rawText: "Restock aisle 3",
      status: "review_required",
      provider: "fake",
      promptVersion: "fake-1",
      createdAt: "2026-08-12T08:00:00.000Z",
      processedAt: "2026-08-12T08:00:00.000Z",
      failureKind: null,
      failureMessage: null,
    },
    report: {
      rawInputId: "raw-1",
      provider: "fake",
      promptVersion: "fake-1",
      generatedAt: "2026-08-12T08:00:00.000Z",
      drafts,
      warnings: [],
    },
  }
}

function stubClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return Object.assign(new ApiClient("http://api.test"), {
    createIntake: vi.fn().mockResolvedValue(intake([draft()])),
    approveIntake: vi.fn(),
    ...overrides,
  })
}

const COMPOSER_LABEL = "What needs to happen this shift?"

describe("IntakeView", () => {
  it("labels the capture control for assistive technology", () => {
    render(<IntakeView client={stubClient()} shiftId="shift-1" onApproved={() => {}} />)
    expect(screen.getByLabelText(COMPOSER_LABEL)).toBeDefined()
  })

  it("disables extraction until there is text", async () => {
    render(<IntakeView client={stubClient()} shiftId="shift-1" onApproved={() => {}} />)
    const button = screen.getByRole("button", { name: "Build my shift" })
    expect(button.hasAttribute("disabled")).toBe(true)

    await userEvent.type(screen.getByLabelText(COMPOSER_LABEL), "Restock")
    expect(button.hasAttribute("disabled")).toBe(false)
  })

  it("fills the composer from the demo workload without calling the backend", async () => {
    const createIntake = vi.fn().mockResolvedValue(intake([draft()]))
    render(
      <IntakeView client={stubClient({ createIntake })} shiftId="shift-1" onApproved={() => {}} />,
    )

    await userEvent.click(screen.getByRole("button", { name: "Try demo workload" }))

    const composer = screen.getByLabelText(COMPOSER_LABEL) as HTMLTextAreaElement
    expect(composer.value).toContain("Restock aisle 3 by 11am")
    expect(composer.value).toContain("Full inventory recount at end of day")
    expect(createIntake).not.toHaveBeenCalled()
  })

  it("submits with Ctrl+Enter on the composer", async () => {
    const createIntake = vi
      .fn()
      .mockResolvedValueOnce(intake([draft()]))
      .mockResolvedValue(intake([draft()]))
    render(
      <IntakeView client={stubClient({ createIntake })} shiftId="shift-1" onApproved={() => {}} />,
    )

    await userEvent.type(screen.getByLabelText(COMPOSER_LABEL), "Restock")
    await userEvent.keyboard("{Control>}{Enter}{/Control}")
    await waitFor(() => expect(createIntake).toHaveBeenCalledTimes(1))
  })

  it("shows the extracted drafts with editable, labelled fields", async () => {
    render(<IntakeView client={stubClient()} shiftId="shift-1" onApproved={() => {}} />)
    await userEvent.type(screen.getByLabelText(COMPOSER_LABEL), "Restock")
    await userEvent.click(screen.getByRole("button", { name: "Build my shift" }))

    expect(await screen.findByLabelText("Task title")).toBeDefined()
    expect(screen.getByLabelText("Duration (min)")).toBeDefined()
    expect(screen.getByRole("button", { name: "Approve 1 task" })).toBeDefined()
  })

  it("surfaces an extraction failure with a retry and reassurance the text was kept", async () => {
    const createIntake = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("ai_unavailable", "provider down"))
      .mockResolvedValue(intake([draft()]))
    render(
      <IntakeView client={stubClient({ createIntake })} shiftId="shift-1" onApproved={() => {}} />,
    )
    await userEvent.type(screen.getByLabelText(COMPOSER_LABEL), "Restock")
    await userEvent.click(screen.getByRole("button", { name: "Build my shift" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Free AI capacity is temporarily unavailable")
    expect(alert.textContent).toContain("Your text was saved")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(createIntake).toHaveBeenCalledTimes(2))
  })

  it("phrases rate limits as capacity noise, never as a lost input", async () => {
    const createIntake = vi.fn().mockRejectedValue(new ApiError("rate_limited", "429"))
    render(
      <IntakeView client={stubClient({ createIntake })} shiftId="shift-1" onApproved={() => {}} />,
    )
    await userEvent.type(screen.getByLabelText(COMPOSER_LABEL), "Restock")
    await userEvent.click(screen.getByRole("button", { name: "Build my shift" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("AI capacity is busy right now. Nothing was lost.")
  })

  // Regression — audit A-4 (client half): a draft the pipeline rejected must
  // never be submitted for approval, and the reason must be visible.
  it("never submits a pipeline-rejected draft and explains why it was dropped", async () => {
    const approveIntake = vi.fn().mockResolvedValue({
      rawInput: intake([]).rawInput,
      createdTasks: [],
      report: intake([]).report,
    })
    const createIntake = vi.fn().mockResolvedValue(
      intake([
        draft(),
        draft({
          id: "draft-1",
          index: 1,
          disposition: "rejected",
          title: "Too early",
          rejectionReason: "deadline_before_shift",
          reasons: ["“5:00” resolves to before the shift starts"],
        }),
      ]),
    )
    render(
      <IntakeView
        client={stubClient({ createIntake, approveIntake })}
        shiftId="shift-1"
        onApproved={() => {}}
      />,
    )
    await userEvent.type(screen.getByLabelText(COMPOSER_LABEL), "x")
    await userEvent.click(screen.getByRole("button", { name: "Build my shift" }))

    expect(await screen.findByText(/deadline_before_shift/)).toBeDefined()
    await userEvent.click(screen.getByRole("button", { name: "Approve 1 task" }))

    await waitFor(() => expect(approveIntake).toHaveBeenCalled())
    const decisions = approveIntake.mock.calls[0]![1] as Array<{ draftId: string }>
    expect(decisions.map((d) => d.draftId)).toEqual(["draft-0"])
  })

  it("shows the phrase a deadline was read from", async () => {
    const createIntake = vi
      .fn()
      .mockResolvedValue(intake([draft({ deadlineHint: "next leap day" })]))
    render(
      <IntakeView client={stubClient({ createIntake })} shiftId="shift-1" onApproved={() => {}} />,
    )
    await userEvent.type(screen.getByLabelText(COMPOSER_LABEL), "x")
    await userEvent.click(screen.getByRole("button", { name: "Build my shift" }))

    expect((await screen.findAllByText(/next leap day/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/please set it yourself/)).toBeDefined()
  })

  it("explains an empty extraction instead of showing nothing", async () => {
    const createIntake = vi.fn().mockResolvedValue(intake([]))
    render(
      <IntakeView client={stubClient({ createIntake })} shiftId="shift-1" onApproved={() => {}} />,
    )
    await userEvent.type(screen.getByLabelText(COMPOSER_LABEL), "???")
    await userEvent.click(screen.getByRole("button", { name: "Build my shift" }))

    expect(await screen.findByText(/No tasks could be read/)).toBeDefined()
  })
})

describe("FakeProviderBadge", () => {
  const health = {
    status: "ok" as const,
    version: "0.1.0",
    promptVersion: "fake-1",
    time: "2026-08-12T08:00:00.000Z",
  }

  it("labels simulated output as simulated", () => {
    render(
      <FakeProviderBadge
        health={{
          ...health,
          provider: "fake",
          providerLabel: "Fake heuristic",
          providerIsFake: true,
          model: null,
        }}
      />,
    )
    expect(screen.getByText(/Simulated AI/)).toBeDefined()
  })

  it("labels a real provider by name", () => {
    render(
      <FakeProviderBadge
        health={{
          ...health,
          provider: "claude",
          providerLabel: "Claude",
          providerIsFake: false,
          model: "test-model-id",
        }}
      />,
    )
    expect(screen.getByText(/Live AI · test-model-id/)).toBeDefined()
  })
})
