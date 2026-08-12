import { describe, expect, it } from "vitest"

import {
  TASK_TITLE_MAX_LENGTH,
  checkDependencies,
  checkTransition,
  validateTaskTitle,
} from "./policy.js"

describe("validateTaskTitle", () => {
  it("accepts a normal title", () => {
    expect(validateTaskTitle("Restock aisle 3")).toEqual({ ok: true })
  })

  it("trims surrounding whitespace before judging length", () => {
    expect(validateTaskTitle("  Restock aisle 3  ")).toEqual({ ok: true })
  })

  it("rejects empty and whitespace-only titles", () => {
    expect(validateTaskTitle("")).toEqual({ ok: false, reason: "empty" })
    expect(validateTaskTitle("   ")).toEqual({ ok: false, reason: "empty" })
  })

  it("rejects non-string input", () => {
    expect(validateTaskTitle(42)).toEqual({ ok: false, reason: "not_a_string" })
    expect(validateTaskTitle(null)).toEqual({ ok: false, reason: "not_a_string" })
  })

  it("rejects titles over the policy limit", () => {
    expect(validateTaskTitle("x".repeat(TASK_TITLE_MAX_LENGTH))).toEqual({ ok: true })
    expect(validateTaskTitle("x".repeat(TASK_TITLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    })
  })
})

describe("checkTransition (task state machine)", () => {
  it("allows the legal life cycle active -> in_progress -> completed", () => {
    expect(checkTransition("active", "in_progress")).toEqual({ ok: true })
    expect(checkTransition("in_progress", "completed")).toEqual({ ok: true })
  })

  it("allows block/unblock, cancel and reopen", () => {
    expect(checkTransition("active", "blocked")).toEqual({ ok: true })
    expect(checkTransition("blocked", "active")).toEqual({ ok: true })
    expect(checkTransition("in_progress", "blocked")).toEqual({ ok: true })
    expect(checkTransition("active", "cancelled")).toEqual({ ok: true })
    expect(checkTransition("completed", "active")).toEqual({ ok: true })
    expect(checkTransition("cancelled", "active")).toEqual({ ok: true })
  })

  it("rejects illegal transitions", () => {
    expect(checkTransition("draft", "in_progress")).toEqual({ ok: false, reason: "not_allowed" })
    expect(checkTransition("completed", "blocked")).toEqual({ ok: false, reason: "not_allowed" })
    expect(checkTransition("cancelled", "completed")).toEqual({ ok: false, reason: "not_allowed" })
    expect(checkTransition("blocked", "in_progress")).toEqual({ ok: false, reason: "not_allowed" })
  })

  it("treats a transition to the same status as an idempotent no-op", () => {
    expect(checkTransition("completed", "completed")).toEqual({ ok: true, reason: "no_op" })
    expect(checkTransition("cancelled", "cancelled")).toEqual({ ok: true, reason: "no_op" })
  })
})

describe("checkDependencies", () => {
  it("accepts dependencies on other tasks of the same shift", () => {
    const result = checkDependencies(
      ["task-2", "task-3"],
      "task-1",
      new Set(["task-1", "task-2", "task-3"]),
    )
    expect(result).toEqual({ ok: true, invalid: [] })
  })

  it("rejects self-references", () => {
    const result = checkDependencies(["task-1"], "task-1", new Set(["task-1"]))
    expect(result.ok).toBe(false)
    expect(result.invalid).toEqual(["task-1"])
  })

  it("rejects references to unknown or foreign tasks", () => {
    const result = checkDependencies(["task-2", "ghost"], "task-1", new Set(["task-1", "task-2"]))
    expect(result.ok).toBe(false)
    expect(result.invalid).toEqual(["ghost"])
  })
})
