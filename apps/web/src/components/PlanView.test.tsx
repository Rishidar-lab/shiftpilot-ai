/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClient, ApiError } from "../api/client.js"
import { PlanView } from "./PlanView.js"
import type { NextDecision, Task, WorkPlan } from "@shiftpilot/contracts"

afterEach(cleanup)

const TASK: Task = {
  id: "task-1",
  shiftId: "shift-1",
  title: "Restock aisle 3",
  category: "other",
  estimatedMinutes: 15,
  deadlineAt: null,
  deadlineSource: "unresolved",
  explicitUrgency: "none",
  status: "active",
  dependsOn: [],
  blockReason: null,
  notes: null,
  createdAt: "2026-08-12T06:00:00.000Z",
  updatedAt: "2026-08-12T06:00:00.000Z",
  completedAt: null,
}

const PLAN: WorkPlan = {
  shiftId: "shift-1",
  date: "2026-08-12",
  generatedAt: "2026-08-12T08:00:00.000Z",
  now: "2026-08-12T08:00:00.000Z",
  sequence: [
    {
      task: TASK,
      position: 0,
      priority: { score: 8, bucket: "low", factors: [] },
      state: "ready",
      startAt: "2026-08-12T08:00:00.000Z",
      endAt: "2026-08-12T08:15:00.000Z",
      fits: true,
      reasons: ["other impact"],
      taskWarnings: [],
    },
  ],
  completedTasks: [],
  cancelledTasks: [],
  next: { kind: "done" },
  warnings: [],
  load: { availableMinutes: 360, scheduledMinutes: 15 },
}

const NEXT: NextDecision = {
  kind: "task",
  taskId: "task-1",
  title: "Restock aisle 3",
  startAt: "2026-08-12T08:00:00.000Z",
  reasons: ["other impact"],
  alternatives: [],
}

function stubClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const client = new ApiClient("http://api.test")
  return Object.assign(client, {
    getPlan: vi.fn().mockResolvedValue(PLAN),
    getNext: vi.fn().mockResolvedValue(NEXT),
    ...overrides,
  })
}

describe("PlanView", () => {
  it("shows the plan and the next action once loaded", async () => {
    render(<PlanView client={stubClient()} shiftId="shift-1" />)

    expect(await screen.findByText(/Next up:/)).toBeDefined()
    expect(screen.getAllByText("Restock aisle 3").length).toBeGreaterThan(0)
  })

  // Regression — audit A-24: the next panel rendered only on success, so a
  // failed request produced silent blank space that looked like "no next task".
  it("surfaces a failed next-action request with a retry action", async () => {
    const getNext = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("ai_unavailable", "provider down"))
      .mockResolvedValue(NEXT)
    render(<PlanView client={stubClient({ getNext })} shiftId="shift-1" />)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Could not load the next action")
    expect(alert.textContent).toContain("provider down")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(screen.getByText(/Next up:/)).toBeDefined())
    expect(getNext).toHaveBeenCalledTimes(2)
  })

  it("surfaces a failed plan request with a retry action", async () => {
    const getPlan = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("internal", "boom"))
      .mockResolvedValue(PLAN)
    render(<PlanView client={stubClient({ getPlan })} shiftId="shift-1" />)

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((el) => el.textContent?.includes("Could not load the plan")),
      ).toBe(true),
    )
    await userEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!)
    await waitFor(() => expect(getPlan).toHaveBeenCalledTimes(2))
  })

  it("shows a loading state before data arrives", () => {
    const pending = new Promise<WorkPlan>(() => {})
    render(
      <PlanView
        client={stubClient({ getPlan: vi.fn().mockReturnValue(pending) })}
        shiftId="shift-1"
      />,
    )
    expect(screen.getByText("Loading plan…")).toBeDefined()
  })

  it("explains an empty plan instead of showing an empty list", async () => {
    const empty = { ...PLAN, sequence: [] }
    render(
      <PlanView
        client={stubClient({ getPlan: vi.fn().mockResolvedValue(empty) })}
        shiftId="shift-1"
      />,
    )
    expect(await screen.findByText(/Nothing scheduled yet/)).toBeDefined()
  })

  it("explains a blocked next-decision that has no named blocker", async () => {
    const blocked: NextDecision = { kind: "blocked", blockedBy: [], cycleTaskIds: [] }
    render(
      <PlanView
        client={stubClient({ getNext: vi.fn().mockResolvedValue(blocked) })}
        shiftId="shift-1"
      />,
    )
    expect(await screen.findByText(/every remaining task is waiting/)).toBeDefined()
  })

  // Completing a task must re-derive the plan rather than patch it locally:
  // the plan is a projection of task state (docs/architecture.md §4).
  it("completes a task and reloads both projections", async () => {
    const getPlan = vi.fn().mockResolvedValue(PLAN)
    const getNext = vi.fn().mockResolvedValue(NEXT)
    const updateTask = vi.fn().mockResolvedValue({ ...TASK, status: "completed" })
    render(<PlanView client={stubClient({ getPlan, getNext, updateTask })} shiftId="shift-1" />)

    await screen.findByText(/Next up:/)
    await userEvent.click(screen.getByRole("button", { name: "Mark done" }))

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("task-1", { status: "completed" }))
    await waitFor(() => expect(getPlan).toHaveBeenCalledTimes(2))
    expect(getNext).toHaveBeenCalledTimes(2)
  })

  it("reports a failed task action without losing the plan", async () => {
    const updateTask = vi.fn().mockRejectedValue(new ApiError("conflict", "stale task"))
    render(<PlanView client={stubClient({ updateTask })} shiftId="shift-1" />)

    await screen.findByText(/Next up:/)
    await userEvent.click(screen.getByRole("button", { name: "Mark done" }))

    await waitFor(() =>
      expect(
        screen.getAllByRole("alert").some((el) => el.textContent?.includes("stale task")),
      ).toBe(true),
    )
    expect(screen.getAllByText("Restock aisle 3").length).toBeGreaterThan(0)
  })

  it("requires a reason before a task can be blocked", async () => {
    const blockTask = vi.fn().mockResolvedValue({ ...TASK, status: "blocked" })
    render(<PlanView client={stubClient({ blockTask })} shiftId="shift-1" />)

    await screen.findByText(/Next up:/)
    await userEvent.click(screen.getByRole("button", { name: "Block" }))

    const save = screen.getByRole("button", { name: "Save" })
    expect(save.hasAttribute("disabled")).toBe(true)

    await userEvent.type(screen.getByLabelText("Why is it blocked?"), "waiting on delivery")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(blockTask).toHaveBeenCalledWith("task-1", "waiting on delivery"))
  })
})
