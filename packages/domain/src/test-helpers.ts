import type { Shift, Task } from "@shiftpilot/contracts"

let idCounter = 0

/** Fixed timeline: shift 06:00–14:00 UTC on 2026-08-12, now = 08:00. */
export const SHIFT_START = "2026-08-12T06:00:00.000Z"
export const SHIFT_END = "2026-08-12T14:00:00.000Z"
export const NOW = new Date("2026-08-12T08:00:00.000Z")

export function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "shift-1",
    date: "2026-08-12",
    startAt: SHIFT_START,
    endAt: SHIFT_END,
    timezone: "UTC",
    role: null,
    createdAt: "2026-08-12T05:00:00.000Z",
    ...overrides,
  }
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  idCounter += 1
  const id = overrides.id ?? `task-${idCounter}`
  const createdAt = overrides.createdAt ?? "2026-08-12T06:00:00.000Z"
  return {
    id,
    shiftId: "shift-1",
    title: `Task ${idCounter}`,
    category: "other",
    estimatedMinutes: null,
    deadlineAt: null,
    deadlineSource: "manual",
    explicitUrgency: "none",
    status: "active",
    dependsOn: [],
    blockReason: null,
    notes: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    ...overrides,
  }
}

export function resetIds(): void {
  idCounter = 0
}
