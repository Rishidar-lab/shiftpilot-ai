/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

import type { ApiClient } from "../api/client.js"
import type { Shift, WorkPlan } from "@shiftpilot/contracts"
import { ShiftHeader } from "./ShiftHeader.js"

afterEach(cleanup)

const SHIFT = {
  id: "shift-1",
  date: "2026-08-18",
  startAt: "2026-08-18T08:00:00.000Z",
  endAt: "2026-08-18T16:00:00.000Z",
  timezone: "Europe/London",
  role: null,
  createdAt: "2026-08-18T07:00:00.000Z",
} as unknown as Shift

function planWith(taskCount: number, scheduledMinutes: number): WorkPlan {
  return {
    shiftId: "shift-1",
    date: "2026-08-18",
    generatedAt: "2026-08-18T09:00:00.000Z",
    now: "2026-08-18T09:00:00.000Z",
    sequence: Array.from({ length: taskCount }, () => ({})),
    completedTasks: [],
    cancelledTasks: [],
    next: { kind: "done" },
    warnings: [],
    load: { availableMinutes: 480, scheduledMinutes },
  } as unknown as WorkPlan
}

/**
 * The header runs its own plan query, so it needs an explicit signal that the
 * shift changed. Without one it kept rendering the pre-approval numbers — "0
 * tasks remaining" — directly above a plan listing eleven of them.
 */
it("re-reads the plan when the shift changes underneath it", async () => {
  const getPlan = vi
    .fn()
    .mockResolvedValueOnce(planWith(0, 0))
    .mockResolvedValueOnce(planWith(11, 110))
  const client = { getPlan } as unknown as ApiClient

  const { rerender } = render(
    <ShiftHeader client={client} shift={SHIFT} shiftError={null} refreshKey={0} />,
  )
  await waitFor(() => expect(screen.getByText("0m")).toBeDefined())
  expect(getPlan).toHaveBeenCalledTimes(1)

  rerender(<ShiftHeader client={client} shift={SHIFT} shiftError={null} refreshKey={1} />)

  await waitFor(() => expect(screen.getByText("110m")).toBeDefined())
  expect(screen.getByText("11")).toBeDefined()
  expect(getPlan).toHaveBeenCalledTimes(2)
})

it("does not re-query when nothing changed", async () => {
  const getPlan = vi.fn().mockResolvedValue(planWith(3, 45))
  const client = { getPlan } as unknown as ApiClient

  const { rerender } = render(
    <ShiftHeader client={client} shift={SHIFT} shiftError={null} refreshKey={2} />,
  )
  await waitFor(() => expect(screen.getByText("45m")).toBeDefined())
  rerender(<ShiftHeader client={client} shift={SHIFT} shiftError={null} refreshKey={2} />)
  await waitFor(() => expect(getPlan).toHaveBeenCalledTimes(1))
})
