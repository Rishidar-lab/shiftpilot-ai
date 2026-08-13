import { randomUUID } from "node:crypto"

import type { AiProvider, ProviderFailure } from "@shiftpilot/provider"
import { runExtraction } from "@shiftpilot/domain"
import { checkDependencies } from "@shiftpilot/domain"
import type { Database } from "../db/index.js"
import {
  getRawInputRow,
  insertDrafts,
  insertRawInput,
  listDraftRows,
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
  ExtractionReport,
  RawInput,
  ShiftContext,
  Task,
} from "@shiftpilot/contracts"
import { ConflictError, NotFoundError, ProviderError } from "./errors.js"

export interface IntakeResult {
  rawInput: RawInput
  report: ExtractionReport
}

export interface ApprovalResult {
  rawInput: RawInput
  createdTasks: Task[]
  report: ExtractionReport
}

function toShiftContext(shift: {
  id: string
  date: string
  startAt: string
  endAt: string
}): ShiftContext {
  return { id: shift.id, date: shift.date, startAt: shift.startAt, endAt: shift.endAt }
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
  }
}

function mapFailure(failure: ProviderFailure): ProviderError {
  switch (failure.kind) {
    case "invalid_response":
      return new ProviderError("ai_invalid_response", failure.kind, failure.detail)
    case "budget_exceeded":
      return new ProviderError("ai_budget_exceeded", failure.kind, "AI budget exceeded")
    default:
      return new ProviderError("ai_unavailable", failure.kind, failureMessage(failure))
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => ProviderFailure,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Capture a worker's free-text intake. The RawInput is persisted with status
 * "received" BEFORE the provider is called, so a provider outage loses nothing.
 * On provider failure the RawInput is marked "failed" (auditable) and a
 * ProviderError surfaces the stable ai_* code. On success the domain pipeline
 * produces reviewable drafts persisted for the approval workflow.
 */
export async function captureIntake(
  db: Database,
  provider: AiProvider,
  shiftId: string,
  dto: CreateIntakeRequest,
  timeoutMs: number,
): Promise<IntakeResult> {
  const shift = getShift(db, shiftId)
  const now = new Date().toISOString()
  const providerId = dto.provider ?? provider.meta.id
  const promptVersion = provider.meta.promptVersion

  const rawInputId = randomUUID()
  insertRawInput(db, {
    id: rawInputId,
    shiftId,
    rawText: dto.rawText,
    status: "received",
    provider: providerId,
    promptVersion,
    createdAt: now,
    processedAt: null,
    failureKind: null,
    failureMessage: null,
    reportWarnings: "[]",
  })

  const attempt = await withTimeout(
    provider.extractTasks(dto.rawText, toShiftContext(shift)),
    timeoutMs,
    () => ({ kind: "timeout" as const }),
  ).catch((error) => {
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

  const existingTitles = listTasksByShift(db, shiftId).map((t) => t.row.title)
  const report = runExtraction({
    rawInputId,
    provider: providerId,
    promptVersion,
    raw: attempt.raw,
    shift: toShiftContext(shift),
    existingTitles,
    inputLength: dto.rawText.length,
  })

  insertDrafts(db, rawInputId, report.drafts)
  updateRawInput(db, rawInputId, {
    status: "review_required",
    processedAt: report.generatedAt,
    reportWarnings: JSON.stringify(report.warnings),
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
    warnings: JSON.parse(row.reportWarnings) as string[],
  }
  return { rawInput, report }
}

/**
 * Approve (or reject) an intake's drafts. Approved drafts are promoted to real
 * M1 Tasks inside a single transaction; dependency edges are resolved to task
 * ids in a second pass (after every row exists) so forward references never
 * violate the FK. Rejected drafts are simply not promoted.
 */
export function approveIntake(
  db: Database,
  rawInputId: string,
  dto: ApproveIntakeRequest,
): ApprovalResult {
  const row = getRawInputRow(db, rawInputId)
  if (row === undefined) throw new NotFoundError("raw_input", rawInputId)
  if (row.status !== "review_required") {
    throw new ConflictError("intake is not awaiting review")
  }

  const drafts = listDraftRows(db, rawInputId).map(toDraft)
  if (drafts.length === 0) throw new ConflictError("intake has no drafts to approve")

  const draftById = new Map(drafts.map((d) => [d.id, d]))
  for (const decision of dto.decisions) {
    if (!draftById.has(decision.draftId)) {
      throw new NotFoundError("draft", decision.draftId)
    }
  }

  const now = new Date().toISOString()
  const approved: Array<{ draftId: string; task: Task; refs: string[] }> = []

  for (const decision of dto.decisions) {
    if (decision.action !== "approve") continue
    const draft = draftById.get(decision.draftId)!
    const fields = CreateTaskRequest.parse({
      title: decision.edits?.title ?? draft.title,
      category: decision.edits?.category ?? draft.category ?? "other",
      estimatedMinutes: decision.edits?.estimatedMinutes ?? draft.estimatedMinutes,
      deadlineAt:
        decision.edits?.deadlineAt !== undefined ? decision.edits.deadlineAt : draft.deadlineAt,
      explicitUrgency: decision.edits?.explicitUrgency ?? draft.explicitUrgency,
      dependsOn: [],
      notes: null,
    })
    const deadlineSource =
      fields.deadlineAt === null
        ? "unresolved"
        : decision.edits?.deadlineAt !== undefined
          ? "manual"
          : draft.deadlineSource === "parsed"
            ? "parsed"
            : "manual"
    const taskId = randomUUID()
    const task: Task = {
      id: taskId,
      shiftId: row.shiftId,
      title: fields.title,
      category: fields.category,
      estimatedMinutes: fields.estimatedMinutes ?? null,
      deadlineAt: fields.deadlineAt ?? null,
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
    approved.push({
      draftId: decision.draftId,
      task,
      refs: decision.edits?.dependsOn ?? draft.dependsOn,
    })
  }

  const draftIdToTaskId = new Map(approved.map((a) => [a.draftId, a.task.id]))
  const validIds = new Set(approved.map((a) => a.task.id))

  const titleToTaskId = new Map(
    approved.map((a) => [a.task.title.trim().toLowerCase(), a.task.id] as const),
  )

  for (const entry of approved) {
    const resolved: string[] = []
    for (const ref of entry.refs) {
      const hash = ref.match(/^draft-(\d+)$/i)
      if (hash) {
        const target = draftIdToTaskId.get(`draft-${hash[1]}`)
        if (target) resolved.push(target)
        continue
      }
      const match = titleToTaskId.get(ref.trim().toLowerCase())
      if (match) resolved.push(match)
    }
    const check = checkDependencies(resolved, entry.task.id, validIds)
    entry.task.dependsOn =
      check.invalid.length === 0 ? resolved : resolved.filter((d) => validIds.has(d))
  }

  db.transaction((tx) => {
    for (const entry of approved) insertTaskRow(tx, entry.task)
    for (const entry of approved) insertDependencies(tx, entry.task.id, entry.task.dependsOn)
  })

  const approvedCount = approved.length
  const status: RawInput["status"] =
    approvedCount === drafts.length ? "approved" : "partially_approved"
  updateRawInput(db, rawInputId, { status })

  const refreshed = getIntake(db, rawInputId)
  return {
    rawInput: refreshed.rawInput,
    createdTasks: approved.map((a) => a.task),
    report: refreshed.report,
  }
}
