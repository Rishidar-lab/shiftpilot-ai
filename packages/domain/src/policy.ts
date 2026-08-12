import type { TaskStatus } from "@shiftpilot/contracts"

export const TASK_TITLE_MAX_LENGTH = 120
export const TASK_TITLE_MIN_LENGTH = 1

export type TaskTitleValidation =
  { ok: true } | { ok: false; reason: "empty" | "too_long" | "not_a_string" }

/**
 * Policy rule from docs/architecture.md §6: AI-derived titles are untrusted and
 * must pass policy validation before they may enter application state.
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

/**
 * Task state machine (docs/architecture.md §4).
 * Each row lists every legal next status; a status transitively reaches itself
 * (idempotent no-op — e.g. completing an already-completed task succeeds).
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  draft: ["draft", "active", "cancelled"],
  active: ["active", "in_progress", "blocked", "completed", "cancelled"],
  in_progress: ["in_progress", "completed", "blocked", "active", "cancelled"],
  blocked: ["blocked", "active", "completed", "cancelled"],
  completed: ["completed", "active"],
  cancelled: ["cancelled", "active"],
}

export interface TransitionCheck {
  ok: boolean
  reason?: "not_allowed" | "no_op"
}

export function checkTransition(from: TaskStatus, to: TaskStatus): TransitionCheck {
  if (from === to) return { ok: true, reason: "no_op" }
  if (ALLOWED_TRANSITIONS[from].includes(to)) return { ok: true }
  return { ok: false, reason: "not_allowed" }
}

export interface DependencyCheck {
  ok: boolean
  /** Dependency ids that reference tasks outside the shift or the task itself. */
  invalid: string[]
}

/**
 * Dependencies must reference other tasks of the same shift and never the task
 * itself (self-loops are also rejected by a CHECK constraint in SQLite).
 */
export function checkDependencies(
  dependsOn: readonly string[],
  taskId: string,
  validIds: ReadonlySet<string>,
): DependencyCheck {
  const invalid = dependsOn.filter((dep) => dep === taskId || !validIds.has(dep))
  return { ok: invalid.length === 0, invalid }
}
