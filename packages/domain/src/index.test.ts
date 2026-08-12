import { describe, expect, it } from "vitest"

import { TASK_TITLE_MAX_LENGTH, validateTaskTitle } from "./index.js"

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
    expect(validateTaskTitle(undefined)).toEqual({ ok: false, reason: "not_a_string" })
  })

  it("rejects titles over the policy limit", () => {
    expect(validateTaskTitle("x".repeat(TASK_TITLE_MAX_LENGTH))).toEqual({ ok: true })
    expect(validateTaskTitle("x".repeat(TASK_TITLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    })
  })
})
