import { z } from "zod"

/**
 * Single source of truth for data shapes shared across packages.
 *
 * M1: the domain model — entities, enums, derived projections
 * (plan / next / handover facts) and request DTOs.
 * M2: AI-assisted intake — RawInput lifecycle, the untrusted ExtractionCandidate
 * contract, the normalized/reviewable ExtractionDraft + ExtractionReport, and
 * the intake/approval request DTOs.
 * Schemas crossing API boundaries are zod-validated at the request edge and in
 * tests; the web client (M4) decodes responses through the same schemas.
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

/**
 * IANA time zone name (e.g. "Europe/London"). A shift is a LOCAL-time concept:
 * "before close" and "by 2pm" mean 2pm where the worker stands, not 2pm UTC.
 * Every shift therefore carries its own zone and all deadline-hint resolution
 * happens against it (docs/architecture.md §4 "Time semantics").
 */
const timeZone = z.string().min(1).max(64).refine(isSupportedTimeZone, {
  message: "expected a valid IANA time zone name",
})

export function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Context a shift provides for resolving hints and planning. */
export const ShiftContext = z
  .object({
    id: z.string().min(1),
    date: isoDate,
    startAt: isoDatetime,
    endAt: isoDatetime,
    timezone: timeZone,
  })
  .strict()
export type ShiftContext = z.infer<typeof ShiftContext>

export const Shift = z
  .object({
    id: z.string().min(1),
    date: isoDate,
    startAt: isoDatetime,
    endAt: isoDatetime,
    /** IANA zone the shift's wall-clock times are expressed in. */
    timezone: timeZone,
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

/**
 * AI-drafted prose ABOUT a HandoverFacts snapshot.
 *
 * The shape is the safety mechanism. The model gets to phrase the shift's story
 * and nothing else: it emits no counts, no timestamps, no deadlines and no task
 * names — `attention` may only carry task IDs, and the pipeline rejects the
 * whole narrative if any ID is absent from the facts it was given. So the model
 * cannot introduce a task, a person, a deadline, a completion state or a number
 * that deterministic domain code did not already compute. Titles shown next to
 * an `attention` entry are looked up from the facts at render time, never taken
 * from the model.
 */
export const HandoverNarrative = z
  .object({
    /** One-line framing of the shift, e.g. "Steady shift, two items carried over". */
    headline: z.string().min(1).max(160),
    /** Short prose summary. Size-bounded so a runaway response cannot fill a page. */
    summary: z.string().min(1).max(1200),
    /** Task IDs worth flagging to the next worker; every ID must exist in the facts. */
    attention: z
      .array(z.object({ taskId: z.string().min(1), why: z.string().min(1).max(240) }).strict())
      .max(5),
  })
  .strict()
export type HandoverNarrative = z.infer<typeof HandoverNarrative>

/**
 * Why prose is missing. Never silent: the UI renders this as an explicit,
 * labelled degraded state alongside the facts, which are always present.
 */
export const HandoverDegradedReason = z.enum([
  /** The provider call failed (outage, timeout, rate limit, credentials, quota). */
  "provider_failure",
  /** The response did not satisfy the narrative contract. */
  "invalid_narrative",
  /** The model referenced a task that does not exist in this shift's facts. */
  "unknown_task_reference",
])
export type HandoverDegradedReason = z.infer<typeof HandoverDegradedReason>

/**
 * The handover endpoint's response. `facts` is ALWAYS populated by deterministic
 * domain code; `narrative` is best-effort. Exactly one of `narrative`/`degraded`
 * is non-null, so a failed draft can never render as an invisible empty success.
 */
export const HandoverResponse = z
  .object({
    facts: HandoverFacts,
    narrative: HandoverNarrative.nullable(),
    degraded: z
      .object({ reason: HandoverDegradedReason, detail: z.string().max(300) })
      .strict()
      .nullable(),
    /** Server-declared provenance of the narrative attempt. */
    provider: z.string(),
    promptVersion: z.string(),
  })
  .strict()
export type HandoverResponse = z.infer<typeof HandoverResponse>

// ---------------------------------------------------------------------------
// Request DTOs (validated at the API boundary)
// ---------------------------------------------------------------------------

export const CreateShiftRequest = z
  .object({
    date: isoDate,
    startAt: isoDatetime,
    endAt: isoDatetime,
    /** Defaults to the server's zone when omitted (single-tenant Week-1 scope). */
    timezone: timeZone.optional(),
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
// M2 — AI-assisted natural-language intake
//
// The boundary is strict: a worker types free text → it is persisted as a
// RawInput BEFORE any AI call → the provider returns untrusted JSON → the
// domain pipeline validates/normalizes it into reviewable ExtractionDrafts →
// a human explicitly approves (or edits/rejects) each draft → only then does
// it become an active M1 Task. The AI never mutates operational state directly.
// ---------------------------------------------------------------------------

/** Lifecycle of one natural-language intake, persisted before any AI call. */
export const RawInputStatus = z.enum([
  "received",
  "processing",
  "review_required",
  "approved",
  "partially_approved",
  "failed",
])
export type RawInputStatus = z.infer<typeof RawInputStatus>

/**
 * A captured utterance plus the provenance of how it was processed.
 * `provider`/`promptVersion` are recorded so every extraction is reproducible
 * and auditable (docs/architecture.md §5). `failureKind` mirrors
 * packages/provider's ProviderFailure kinds for clean mapping.
 */
export const RawInput = z
  .object({
    id: z.string().min(1),
    shiftId: z.string().min(1),
    rawText: z.string().min(1).max(20000),
    status: RawInputStatus,
    provider: z.string().min(1),
    promptVersion: z.string().min(1),
    createdAt: isoDatetime,
    processedAt: isoDatetime.nullable(),
    failureKind: z
      .enum(["timeout", "rate_limited", "quota", "network", "invalid_response", "budget_exceeded"])
      .nullable(),
    failureMessage: z.string().max(1000).nullable(),
  })
  .strict()
export type RawInput = z.infer<typeof RawInput>

/**
 * Machine-classified reason a candidate was rejected or flagged. Every value
 * is deterministic and attributable (no model "confidence" scores).
 */
export const ExtractionRejectionReason = z.enum([
  "invalid_deadline",
  "deadline_before_shift",
  "missing_title",
  "duplicate_candidate",
  "invalid_duration",
  "ambiguous_dependency",
  "unresolved_reference",
  "oversized_input",
  "malformed_provider_output",
])
export type ExtractionRejectionReason = z.infer<typeof ExtractionRejectionReason>

/**
 * The structured shape a provider is expected to emit for one candidate task.
 * This is UNTRUSTED input: missing fields stay missing (we never fabricate),
 * and the domain pipeline re-derives every operational field against policy.
 */
export const ExtractionCandidate = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().max(2000).nullable(),
    /**
     * The VERBATIM deadline phrase from the worker's text ("by 2pm", "before
     * close"), or null when the text states no deadline. Providers must NOT do
     * date arithmetic: resolving a phrase to an instant is a deterministic
     * domain rule (packages/domain/src/time.ts) so that every provider — fake
     * or real — produces identical deadlines for identical words.
     */
    deadlineHint: z.string().max(200).nullable(),
    /** Whole minutes; null = unknown. The pipeline rejects out-of-range values. */
    estimatedMinutes: z.number().int().nullable(),
    /**
     * Where the duration came from. "stated" = the worker gave it; "inferred" =
     * the model guessed a realistic value. Inference is permitted for duration
     * ONLY, and must stay visibly distinguishable from what the worker actually
     * said — a guess must never be presented as a fact (docs/architecture.md §5).
     */
    estimatedMinutesSource: z.enum(["stated", "inferred"]).nullable(),
    explicitUrgency: UrgencyLevel.nullable(),
    /** Operational category; null = classifier abstained. */
    category: Category.nullable(),
    /** References to sibling candidates, e.g. "#1", "the inspection above". */
    dependencies: z.array(z.string().max(200)),
    /** Model-flagged ambiguities (carried forward as review notes). */
    ambiguity: z.array(z.string().max(500)),
    /** The source span this candidate was extracted from (for audit/trace). */
    sourceText: z.string().max(20000),
  })
  .strict()
export type ExtractionCandidate = z.infer<typeof ExtractionCandidate>

/** Envelope the provider should return; validated leniently by the pipeline. */
export const AiExtractionOutput = z.object({ tasks: z.array(ExtractionCandidate) }).passthrough()
export type AiExtractionOutput = z.infer<typeof AiExtractionOutput>

/** One normalized, reviewable item produced by the domain pipeline. */
export const ExtractionDraft = z
  .object({
    /** Stable id within the report (used by the approval workflow). */
    id: z.string().min(1),
    /** Original index of the source candidate in the provider output. */
    index: z.number().int().min(0),
    /** Pipeline verdict: ready / needs human eyes / rejected. */
    disposition: z.enum(["accepted", "needsReview", "rejected"]),
    title: z.string().min(1).max(120),
    description: z.string().max(2000).nullable(),
    category: Category.nullable(),
    estimatedMinutes: z.number().int().min(1).max(480).nullable(),
    /**
     * Provenance of `estimatedMinutes`, surfaced in review so a reviewer can see
     * at a glance which numbers the worker gave and which the model guessed.
     */
    estimateSource: z.enum(["stated", "inferred", "unknown"]),
    /** Resolved by domain normalization from `deadlineHint` — never by the model. */
    deadlineAt: isoDatetime.nullable(),
    deadlineSource: DeadlineSource,
    /** The verbatim phrase the deadline came from, kept for reviewer context. */
    deadlineHint: z.string().max(200).nullable(),
    explicitUrgency: UrgencyLevel,
    /** Resolved/normalized dependency references for human confirmation. */
    dependsOn: z.array(z.string().max(200)),
    sourceText: z.string().max(20000),
    /** Stable machine code when disposition is "rejected"; null otherwise. */
    rejectionReason: ExtractionRejectionReason.nullable(),
    /** Human-readable review notes (model ambiguity flags, unresolved hints). */
    reasons: z.array(z.string().max(500)),
  })
  .strict()
export type ExtractionDraft = z.infer<typeof ExtractionDraft>

/**
 * The full, deterministic output of the extraction pipeline for one RawInput.
 * Never persisted as a unit that mutates state — it is the artifact a human
 * reviews and approves.
 */
export const ExtractionReport = z
  .object({
    rawInputId: z.string().min(1),
    provider: z.string().min(1),
    promptVersion: z.string().min(1),
    generatedAt: isoDatetime,
    drafts: z.array(ExtractionDraft),
    /** Report-level warnings (oversized input, partial malformed output, …). */
    warnings: z.array(z.string().max(500)),
  })
  .strict()
export type ExtractionReport = z.infer<typeof ExtractionReport>

// Request DTOs ---------------------------------------------------------------

/**
 * Capture a worker's free-text intake for a shift.
 *
 * The URL path carries the authoritative shift id. `shiftId` may be repeated in
 * the body (the web client does), but a MISMATCH is rejected rather than
 * silently resolved. There is deliberately no provider field: which model ran
 * is a server fact, never a client claim (docs/architecture.md §5).
 */
export const CreateIntakeRequest = z
  .object({
    shiftId: z.string().min(1).optional(),
    rawText: z.string().min(1).max(20000),
  })
  .strict()
export type CreateIntakeRequest = z.infer<typeof CreateIntakeRequest>

/** A human's decision on a single draft during review/approval. */
export const IntakeApprovalDecision = z
  .object({
    draftId: z.string().min(1),
    action: z.enum(["approve", "reject"]),
    /** Edits applied before promotion (validated like CreateTaskRequest). */
    edits: z
      .object({
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        category: Category.optional(),
        estimatedMinutes: z.number().int().min(1).max(480).nullable().optional(),
        deadlineAt: isoDatetime.nullable().optional(),
        explicitUrgency: UrgencyLevel.optional(),
        dependsOn: z.array(z.string().max(50)).max(50).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type IntakeApprovalDecision = z.infer<typeof IntakeApprovalDecision>

/** Approve (or reject) an intake report; promotes approved drafts to M1 Tasks. */
export const ApproveIntakeRequest = z
  .object({
    decisions: z.array(IntakeApprovalDecision).min(1),
  })
  .strict()
export type ApproveIntakeRequest = z.infer<typeof ApproveIntakeRequest>

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/**
 * `providerIsFake` is declared by the provider itself, not inferred from its id,
 * so the UI can never mislabel simulated output as a real model.
 */
export const HealthResponse = z
  .object({
    status: z.literal("ok"),
    version: z.string(),
    provider: z.string(),
    providerLabel: z.string(),
    providerIsFake: z.boolean(),
    /** Configured model identifier, or null for providers that use no model. */
    model: z.string().nullable(),
    promptVersion: z.string(),
    time: z.string(),
  })
  .strict()
export type HealthResponse = z.infer<typeof HealthResponse>

export const ApiErrorCode = z.enum([
  "validation_error",
  "not_found",
  "conflict",
  /** Server-side throttle on the AI-backed endpoints (HTTP 429). */
  "rate_limited",
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
