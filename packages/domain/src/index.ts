export const TASK_TITLE_MAX_LENGTH = 120
export const TASK_TITLE_MIN_LENGTH = 1

export type TaskTitleValidation =
  { ok: true } | { ok: false; reason: "empty" | "too_long" | "not_a_string" }

/**
 * Policy rule from docs/architecture.md §6: AI-derived titles are untrusted and
 * must pass policy validation before they may enter application state.
 * Used by the validation pipeline (M2); unit-tested here as pure domain logic.
 */
export function validateTaskTitle(title: unknown): TaskTitleValidation {
  if (typeof title !== "string") {
    return { ok: false, reason: "not_a_string" }
  }
  const trimmed = title.trim()
  if (trimmed.length < TASK_TITLE_MIN_LENGTH) {
    return { ok: false, reason: "empty" }
  }
  if (trimmed.length > TASK_TITLE_MAX_LENGTH) {
    return { ok: false, reason: "too_long" }
  }
  return { ok: true }
}
