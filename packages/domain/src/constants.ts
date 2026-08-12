import type { Category, UrgencyLevel } from "@shiftpilot/contracts"

/**
 * Centralized, documented constants for the deterministic engines.
 * Every tunable number lives here (or in PRIORITY/Category weight tables)
 * so the scoring model can be audited and adjusted in one place.
 */

/** How long a task with no stated duration is assumed to take. */
export const DEFAULT_DURATION_MINUTES = 15

/** Latest acceptable deadline for the proximity factor to matter (8h window). */
export const DEADLINE_WINDOW_MINUTES = 480

/**
 * Priority scoring model (packages/domain/src/priority.ts).
 * Total score = sum of contributing factors; buckets derived from the score.
 *
 *   explicitUrgency  critical 40 · high 25 · medium 12 · low 0 · none 0
 *   overdue          50 (a single overdue task lands in the critical bucket)
 *   deadline         0–40 linear decay over DEADLINE_WINDOW_MINUTES
 *   unblocks         5 × dependent task count, capped 20
 *   category         compliance 12 · safety 12 · customer 10 · walkthrough 8
 *                    training 6 · other 5 · admin 4 · break 1
 *   waiting          1 × whole hour since capture, capped 5
 *   quick            +3 when estimated ≤ QUICK_TASK_MAX_MINUTES
 *
 * Buckets:   ≥55 critical · ≥35 high · ≥15 medium · <15 low
 *
 * This is a transparent heuristic, NOT machine learning. Every factor is
 * attributable and returned in PriorityReason.factors for explainability.
 */
export const PRIORITY = {
  urgency: {
    critical: 40,
    high: 25,
    medium: 12,
    low: 0,
    none: 0,
  } as Record<UrgencyLevel, number>,
  overdueScore: 50,
  deadlineMax: 40,
  deadlineWindowMinutes: DEADLINE_WINDOW_MINUTES,
  blocksPerDependent: 5,
  blocksMax: 20,
  category: {
    compliance: 12,
    safety: 12,
    customer: 10,
    walkthrough: 8,
    training: 6,
    other: 5,
    admin: 4,
    break: 1,
  } as Record<Category, number>,
  waitingPerHour: 1,
  waitingMax: 5,
  quickTaskMaxMinutes: 15,
  quickTaskScore: 3,
  /** Applied ONLY to in_progress tasks when choosing "what next" (continuity). */
  continuityBonus: 15,
  bucketCritical: 55,
  bucketHigh: 35,
  bucketMedium: 15,
} as const

/**
 * Deterministic tie-breaking order when scores are equal:
 * earlier deadline first, then longer-waiting (earlier createdAt), then id.
 */
export const TIE_BREAK = {
  by: ["score", "deadlineAt", "createdAt", "id"] as const,
} as const
