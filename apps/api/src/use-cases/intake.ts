import { randomUUID } from "node:crypto"

import type { AiProvider, ProviderFailure } from "@shiftpilot/provider"
import { runExtraction } from "@shiftpilot/domain"
import type { Database } from "../db/index.js"
import {
  getRawInputRow,
  insertDrafts,
  insertRawInput,
  listDraftRows,
  parseJsonArray,
  toDraft,
  toRawInput,
  updateRawInput,
} from "../repos/intake.js"
import { getShift } from "./shift.js"
import { insertDependencies, insertTaskRow, listTasksByShift } from "../repos/task.js"
import { CreateTaskRequest } from "@shiftpilot/contracts"
import type {
  ApproveIntakeRequest,
  CreateIntakeRequest,
  ExtractionDraft,
  ExtractionReport,
  RawInput,
  Shift,
  ShiftContext,
  Task,
} from "@shiftpilot/contracts"
import { ConflictError, NotFoundError, ProviderError, ValidationError } from "./errors.js"

export interface IntakeResult {
  rawInput: RawInput
  report: ExtractionReport
}

export interface ApprovalResult {
  rawInput: RawInput
  createdTasks: Task[]
  report: ExtractionReport
}

function toShiftContext(shift: Shift): ShiftContext {
  return {
    id: shift.id,
    date: shift.date,
    startAt: shift.startAt,
    endAt: shift.endAt,
    timezone: shift.timezone,
  }
}

function isProviderFailure(value: unknown): value is ProviderFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as ProviderFailure).kind === "string"
  )
}

function failureMessage(failure: ProviderFailure): string {
  switch (failure.kind) {
    case "timeout":
      return "The AI provider did not respond in time."
    case "rate_limited":
      return `The AI provider was rate limited${failure.retryAfterMs ? ` (retry after ${failure.retryAfterMs}ms)` : ""}.`
    case "quota":
      return "The AI provider quota was exceeded."
    case "network":
      return `AI provider network error: ${failure.message}`
    case "invalid_response":
      return `The AI provider returned an invalid response: ${failure.detail}`
    case "budget_exceeded":
      return "The AI provider budget was exceeded."
    case "unauthorized":
      return "The AI provider rejected the server's credentials."
    case "misconfigured":
      return `The AI provider could not process the request: ${failure.detail}`
  }
}

function mapFailure(failure: ProviderFailure): ProviderError {
  switch (failure.kind) {
    case "invalid_response":
      return new ProviderError("ai_invalid_response", failure.kind, failure.detail)
    case "budget_exceeded":
      return new ProviderError("ai_budget_exceeded", failure.kind, "AI budget exceeded")
    case "quota":
      return new ProviderError("ai_budget_exceeded", failure.kind, failureMessage(failure))
    case "unauthorized":
    case "misconfigured":
      // An operator problem, not a user problem: surface it as the AI being
      // unavailable and keep the provider detail out of the client message.
      return new ProviderError(
        "ai_unavailable",
        failure.kind,
        "The AI provider is not correctly configured on the server.",
      )
    default:
      return new ProviderError("ai_unavailable", failure.kind, failureMessage(failure))
  }
}

/**
 * Bound the provider call in wall-clock time AND actually abort it. Rejecting
 * without aborting leaves the HTTP request running and still spending quota
 * after we have stopped caring about the answer (audit A-18).
 */
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  onTimeout: () => ProviderFailure,
): Promise<T> {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(onTimeout())
    }, ms)
  })
  try {
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Capture a worker's free-text intake.
 *
 * Ordering is the durability contract (docs/architecture.md §5): the RawInput
 * row exists before the provider is called and is flipped to "processing" for
 * the duration of the call, so a crash or outage leaves a durable, auditable,
 * retryable record instead of losing the worker's words. Which provider ran is
 * recorded from the SERVER's provider metadata — never from client input.
 */
export async function captureIntake(
  db: Database,
  provider: AiProvider,
  shiftId: string,
  dto: CreateIntakeRequest,
  timeoutMs: number,
): Promise<IntakeResult> {
  if (dto.shiftId !== undefined && dto.shiftId !== shiftId) {
    throw new ValidationError(
      `shiftId in the request body ("${dto.shiftId}") does not match the URL ("${shiftId}")`,
    )
  }

  const shift = getShift(db, shiftId)
  const now = new Date()
  const rawInputId = randomUUID()

  insertRawInput(db, {
    id: rawInputId,
    shiftId,
    rawText: dto.rawText,
    status: "received",
    provider: provider.meta.id,
    promptVersion: provider.meta.promptVersion,
    createdAt: now.toISOString(),
    processedAt: null,
    failureKind: null,
    failureMessage: null,
    reportWarnings: "[]",
  })
  updateRawInput(db, rawInputId, { status: "processing" })

  const attempt = await withTimeout(
    (signal) => provider.extractTasks(dto.rawText, toShiftContext(shift), signal),
    timeoutMs,
    () => ({ kind: "timeout" as const }),
  ).catch((error: unknown) => {
    if (isProviderFailure(error)) return { ok: false, failure: error } as const
    throw error
  })

  if (!attempt.ok) {
    const failure = attempt.failure
    updateRawInput(db, rawInputId, {
      status: "failed",
      processedAt: new Date().toISOString(),
      failureKind: failure.kind,
      failureMessage: failureMessage(failure),
    })
    throw mapFailure(failure)
  }

  // Duplicate detection compares against tasks that still represent real work.
  // Cancelled tasks are explicitly excluded: re-adding something the worker
  // previously cancelled is a legitimate action, not a duplicate (audit A-21).
  const existingTitles = listTasksByShift(db, shiftId)
    .filter((t) => t.row.status !== "cancelled")
    .map((t) => t.row.title)

  const report = runExtraction({
    rawInputId,
    provider: provider.meta.id,
    promptVersion: provider.meta.promptVersion,
    raw: attempt.raw,
    shift: toShiftContext(shift),
    existingTitles,
    inputLength: dto.rawText.length,
    now,
  })

  db.transaction((tx) => {
    insertDrafts(tx, rawInputId, report.drafts)
    updateRawInput(tx, rawInputId, {
      status: "review_required",
      processedAt: report.generatedAt,
      reportWarnings: JSON.stringify(report.warnings),
    })
  })

  return { rawInput: getRawInput(db, rawInputId), report }
}

export function getRawInput(db: Database, id: string): RawInput {
  const row = getRawInputRow(db, id)
  if (row === undefined) throw new NotFoundError("raw_input", id)
  return toRawInput(row)
}

/**
 * Reconstruct the full intake + extraction report from durable state so the
 * review workflow is resumable after a refresh or a crash.
 */
export function getIntake(db: Database, id: string): IntakeResult {
  const row = getRawInputRow(db, id)
  if (row === undefined) throw new NotFoundError("raw_input", id)
  const drafts = listDraftRows(db, id).map(toDraft)
  const rawInput = toRawInput(row)
  const report: ExtractionReport = {
    rawInputId: rawInput.id,
    provider: rawInput.provider,
    promptVersion: rawInput.promptVersion,
    generatedAt: rawInput.processedAt ?? rawInput.createdAt,
    drafts,
    warnings: parseJsonArray(row.reportWarnings),
  }
  return { rawInput, report }
}

/**
 * Approve (or reject) an intake's drafts.
 *
 * Two invariants this function exists to protect:
 *  1. A candidate the deterministic pipeline REJECTED can never become a task,
 *     whatever the client asks for. Review means choosing among candidates that
 *     passed policy, not overriding policy (audit A-4).
 *  2. Task creation, dependency edges and the intake status flip are ONE
 *     transaction. Splitting them let a crash create tasks while leaving the
 *     intake approvable again, duplicating every task on retry (audit A-7).
 */
export function approveIntake(
  db: Database,
  rawInputId: string,
  dto: ApproveIntakeRequest,
): ApprovalResult {
  const row = getRawInputRow(db, rawInputId)
  if (row === undefined) throw new NotFoundError("raw_input", rawInputId)
  if (row.status !== "review_required") {
    throw new ConflictError(
      `intake is not awaiting review (status: ${row.status}); it cannot be approved twice`,
    )
  }

  const drafts = listDraftRows(db, rawInputId).map(toDraft)
  if (drafts.length === 0) throw new ConflictError("intake has no drafts to approve")

  const draftById = new Map(drafts.map((d) => [d.id, d]))
  const seenDecisions = new Set<string>()
  for (const decision of dto.decisions) {
    const draft = draftById.get(decision.draftId)
    if (draft === undefined) throw new NotFoundError("draft", decision.draftId)
    if (seenDecisions.has(decision.draftId)) {
      throw new ValidationError(`duplicate decision for draft "${decision.draftId}"`)
    }
    seenDecisions.add(decision.draftId)
    if (decision.action === "approve" && draft.disposition === "rejected") {
      throw new ValidationError(
        `draft "${decision.draftId}" was rejected by validation (${draft.rejectionReason ?? "policy"}) and cannot be approved`,
      )
    }
  }

  const now = new Date().toISOString()
  const approved: Array<{ draftId: string; task: Task; refs: string[] }> = []

  for (const decision of dto.decisions) {
    if (decision.action !== "approve") continue
    const draft = draftById.get(decision.draftId)!
    approved.push({
      draftId: decision.draftId,
      task: toTaskDraft(draft, decision.edits, row.shiftId, now),
      refs: decision.edits?.dependsOn ?? draft.dependsOn,
    })
  }

  resolveApprovedDependencies(approved)

  const status: RawInput["status"] =
    approved.length === drafts.length ? "approved" : "partially_approved"

  db.transaction((tx) => {
    for (const entry of approved) insertTaskRow(tx, entry.task)
    for (const entry of approved) insertDependencies(tx, entry.task.id, entry.task.dependsOn)
    updateRawInput(tx, rawInputId, { status })
  })

  const refreshed = getIntake(db, rawInputId)
  return {
    rawInput: refreshed.rawInput,
    createdTasks: approved.map((a) => a.task),
    report: refreshed.report,
  }
}

/** Apply a reviewer's edits over a draft and re-validate through contracts. */
function toTaskDraft(
  draft: ExtractionDraft,
  edits: NonNullable<ApproveIntakeRequest["decisions"][number]["edits"]> | undefined,
  shiftId: string,
  now: string,
): Task {
  const fields = CreateTaskRequest.parse({
    title: edits?.title ?? draft.title,
    category: edits?.category ?? draft.category ?? "other",
    estimatedMinutes: edits?.estimatedMinutes ?? draft.estimatedMinutes,
    deadlineAt: edits?.deadlineAt !== undefined ? edits.deadlineAt : draft.deadlineAt,
    explicitUrgency: edits?.explicitUrgency ?? draft.explicitUrgency,
    dependsOn: [],
    notes: null,
  })

  const deadlineAt = fields.deadlineAt ?? null
  const deadlineSource: Task["deadlineSource"] =
    deadlineAt === null
      ? "unresolved"
      : edits?.deadlineAt !== undefined
        ? "manual"
        : draft.deadlineSource === "parsed"
          ? "parsed"
          : "manual"

  return {
    id: randomUUID(),
    shiftId,
    title: fields.title,
    category: fields.category,
    estimatedMinutes: fields.estimatedMinutes ?? null,
    deadlineAt,
    deadlineSource,
    explicitUrgency: fields.explicitUrgency,
    status: "active",
    dependsOn: [],
    blockReason: null,
    notes: fields.notes ?? null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }
}

/**
 * Map draft-level references onto the ids of the tasks actually created.
 * References to drafts that were NOT approved are dropped (their target does
 * not exist), and a reference that resolves to the task itself is dropped
 * rather than written — a self-edge violates the task_dependencies CHECK
 * constraint and previously surfaced as a 500 (audit A-6/A-22).
 */
function resolveApprovedDependencies(
  approved: Array<{ draftId: string; task: Task; refs: string[] }>,
): void {
  const draftIdToTaskId = new Map(approved.map((a) => [a.draftId, a.task.id]))
  const titleToTaskId = new Map(approved.map((a) => [a.task.title.trim().toLowerCase(), a.task.id]))
  const validIds = new Set(approved.map((a) => a.task.id))

  for (const entry of approved) {
    const resolved: string[] = []
    for (const ref of entry.refs) {
      const byDraft = draftIdToTaskId.get(ref)
      const target = byDraft ?? titleToTaskId.get(ref.trim().toLowerCase())
      if (target === undefined) continue
      if (target === entry.task.id) continue
      if (!validIds.has(target)) continue
      resolved.push(target)
    }
    entry.task.dependsOn = [...new Set(resolved)]
  }
}
