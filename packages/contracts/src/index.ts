import { z } from "zod"

/**
 * Single source of truth for data shapes shared across packages.
 *
 * M1: the domain model — entities, enums, derived projections
 * (plan / next / handover facts) and request DTOs. Schemas crossing API
 * boundaries are zod-validated at the request edge and in tests; the web
 * client (M4) decodes responses through the same schemas.
 */

// ---------------------------------------------------------------------------
// Enums (constrained unions — never stringly-typed state)
// ---------------------------------------------------------------------------

export const TaskStatus = z.enum([
  "draft",
  "active",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
])
export type TaskStatus = z.infer<typeof TaskStatus>

/** Operational impact class; weights live in packages/domain (PRIORITY.category). */
export const Category = z.enum([
  "compliance",
  "safety",
  "customer",
  "walkthrough",
  "training",
  "admin",
  "break",
  "other",
])
export type Category = z.infer<typeof Category>

/** User-set urgency override. The explicit escape hatch over computed rank. */
export const UrgencyLevel = z.enum(["none", "low", "medium", "high", "critical"])
export type UrgencyLevel = z.infer<typeof UrgencyLevel>

export const DeadlineSource = z.enum(["manual", "parsed", "unresolved"])
export type DeadlineSource = z.infer<typeof DeadlineSource>

export const PriorityBucket = z.enum(["critical", "high", "medium", "low"])
export type PriorityBucket = z.infer<typeof PriorityBucket>

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

const isoDatetime = z.string().datetime()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")

/** Context a shift provides for resolving hints and planning. */
export const ShiftContext = z
  .object({
    id: z.string().min(1),
    date: isoDate,
    startAt: isoDatetime,
    endAt: isoDatetime,
  })
  .strict()
export type ShiftContext = z.infer<typeof ShiftContext>

export const Shift = z
  .object({
    id: z.string().min(1),
    date: isoDate,
    startAt: isoDatetime,
    endAt: isoDatetime,
    role: z.string().max(200).nullable(),
    createdAt: isoDatetime,
  })
  .strict()
export type Shift = z.infer<typeof Shift>

export const Task = z
  .object({
    id: z.string().min(1),
    shiftId: z.string().min(1),
    title: z.string().min(1).max(120),
    category: Category,
    /** null = unknown duration (scheduler assumes the documented default). */
    estimatedMinutes: z.number().int().min(1).max(480).nullable(),
    deadlineAt: isoDatetime.nullable(),
    deadlineSource: DeadlineSource,
    explicitUrgency: UrgencyLevel,
    status: TaskStatus,
    /** Predecessor task ids; ordering constraint for the scheduler. */
    dependsOn: z.array(z.string()).max(50),
    blockReason: z.string().max(500).nullable(),
    notes: z.string().max(2000).nullable(),
    createdAt: isoDatetime,
    updatedAt: isoDatetime,
    completedAt: isoDatetime.nullable(),
  })
  .strict()
export type Task = z.infer<typeof Task>

// ---------------------------------------------------------------------------
// Derived projections (computed by packages/domain — never persisted)
// ---------------------------------------------------------------------------

export const PriorityFactorKind = z.enum([
  "explicit_urgency",
  "deadline",
  "overdue",
  "unblocks",
  "category",
  "waiting",
  "quick",
])
export type PriorityFactorKind = z.infer<typeof PriorityFactorKind>

export const PriorityFactor = z
  .object({
    kind: PriorityFactorKind,
    label: z.string(),
    contribution: z.number().int(),
  })
  .strict()
export type PriorityFactor = z.infer<typeof PriorityFactor>

export const PriorityReason = z
  .object({
    score: z.number().int(),
    bucket: PriorityBucket,
    factors: z.array(PriorityFactor),
  })
  .strict()
export type PriorityReason = z.infer<typeof PriorityReason>

export const ScheduledTaskState = z.enum(["ready", "waiting", "blocked", "cycle", "draft"])
export type ScheduledTaskState = z.infer<typeof ScheduledTaskState>

export const ScheduledTask = z
  .object({
    task: Task,
    position: z.number().int().min(0),
    priority: PriorityReason.nullable(),
    state: ScheduledTaskState,
    startAt: isoDatetime.nullable(),
    endAt: isoDatetime.nullable(),
    fits: z.boolean(),
    reasons: z.array(z.string()),
    taskWarnings: z.array(z.string()),
  })
  .strict()
export type ScheduledTask = z.infer<typeof ScheduledTask>

export const PlanWarning = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dependency_cycle"), taskIds: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("cannot_fit"), taskIds: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("missing_duration"), taskIds: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("shift_ended") }).strict(),
  z.object({ type: z.literal("empty_workload") }).strict(),
  z.object({ type: z.literal("draft_not_approved"), taskIds: z.array(z.string()) }).strict(),
])
export type PlanWarning = z.infer<typeof PlanWarning>

export const NextDecision = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("task"),
      taskId: z.string(),
      title: z.string(),
      startAt: isoDatetime.nullable(),
      reasons: z.array(z.string()),
      alternatives: z.array(z.object({ taskId: z.string(), title: z.string() }).strict()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("blocked"),
      blockedBy: z.array(z.string()),
      cycleTaskIds: z.array(z.string()),
    })
    .strict(),
  z.object({ kind: z.literal("done") }).strict(),
  z.object({ kind: z.literal("shift_ended") }).strict(),
])
export type NextDecision = z.infer<typeof NextDecision>

export const WorkPlan = z
  .object({
    shiftId: z.string(),
    date: isoDate,
    generatedAt: isoDatetime,
    now: isoDatetime,
    sequence: z.array(ScheduledTask),
    completedTasks: z.array(Task),
    cancelledTasks: z.array(Task),
    next: NextDecision,
    warnings: z.array(PlanWarning),
    load: z
      .object({ availableMinutes: z.number().int(), scheduledMinutes: z.number().int() })
      .strict(),
  })
  .strict()
export type WorkPlan = z.infer<typeof WorkPlan>

export const HandoverFacts = z
  .object({
    shiftId: z.string(),
    date: isoDate,
    generatedAt: isoDatetime,
    counts: z
      .object({
        total: z.number().int(),
        active: z.number().int(),
        inProgress: z.number().int(),
        completed: z.number().int(),
        blocked: z.number().int(),
        cancelled: z.number().int(),
        overdue: z.number().int(),
        waiting: z.number().int(),
      })
      .strict(),
    completed: z.array(
      z
        .object({ taskId: z.string(), title: z.string(), completedAt: isoDatetime.nullable() })
        .strict(),
    ),
    pending: z.array(
      z
        .object({
          taskId: z.string(),
          title: z.string(),
          priorityBucket: PriorityBucket,
          deadlineAt: isoDatetime.nullable(),
          dueInMin: z.number().int().nullable(),
        })
        .strict(),
    ),
    blocked: z.array(
      z.object({ taskId: z.string(), title: z.string(), blockedBy: z.array(z.string()) }).strict(),
    ),
    overdue: z.array(
      z.object({ taskId: z.string(), title: z.string(), overdueMin: z.number().int() }).strict(),
    ),
    upcomingDeadlines: z.array(
      z.object({ taskId: z.string(), title: z.string(), dueInMin: z.number().int() }).strict(),
    ),
    warnings: z.array(PlanWarning),
    recommendations: z.array(z.object({ taskId: z.string(), title: z.string() }).strict()),
  })
  .strict()
export type HandoverFacts = z.infer<typeof HandoverFacts>

// ---------------------------------------------------------------------------
// Request DTOs (validated at the API boundary)
// ---------------------------------------------------------------------------

export const CreateShiftRequest = z
  .object({
    date: isoDate,
    startAt: isoDatetime,
    endAt: isoDatetime,
    role: z.string().max(200).nullable().optional(),
  })
  .strict()
export type CreateShiftRequest = z.infer<typeof CreateShiftRequest>

export const CreateTaskRequest = z
  .object({
    title: z.string().min(1).max(120),
    category: Category.default("other"),
    estimatedMinutes: z.number().int().min(1).max(480).nullable().optional(),
    deadlineAt: isoDatetime.nullable().optional(),
    explicitUrgency: UrgencyLevel.default("none"),
    dependsOn: z.array(z.string()).max(50).default([]),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>

export const UpdateTaskRequest = z
  .object({
    title: z.string().min(1).max(120).optional(),
    category: Category.optional(),
    estimatedMinutes: z.number().int().min(1).max(480).nullable().optional(),
    deadlineAt: isoDatetime.nullable().optional(),
    explicitUrgency: UrgencyLevel.optional(),
    dependsOn: z.array(z.string()).max(50).optional(),
    notes: z.string().max(2000).nullable().optional(),
    status: TaskStatus.optional(),
  })
  .strict()
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>

export const BlockTaskRequest = z.object({ reason: z.string().min(1).max(500) }).strict()
export type BlockTaskRequest = z.infer<typeof BlockTaskRequest>

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export const HealthResponse = z
  .object({
    status: z.literal("ok"),
    version: z.string(),
    provider: z.string(),
    time: z.string(),
  })
  .strict()
export type HealthResponse = z.infer<typeof HealthResponse>

export const ApiErrorCode = z.enum([
  "validation_error",
  "not_found",
  "conflict",
  "ai_unavailable",
  "ai_invalid_response",
  "ai_budget_exceeded",
  "internal",
])
export type ApiErrorCode = z.infer<typeof ApiErrorCode>

export const ApiErrorEnvelope = z
  .object({
    error: z.object({
      code: ApiErrorCode,
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .strict()
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>
