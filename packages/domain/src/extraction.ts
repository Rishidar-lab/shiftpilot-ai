import {
  AiExtractionOutput,
  ExtractionCandidate,
  ExtractionDraft,
  type ExtractionRejectionReason,
  type ExtractionReport,
  type ShiftContext,
} from "@shiftpilot/contracts"
import type { Category, UrgencyLevel } from "@shiftpilot/contracts"
import { validateTaskTitle, TASK_TITLE_MAX_LENGTH } from "./policy.js"
import { resolveDeadlineHint } from "./time.js"

/**
 * Deterministic validation + normalization pipeline that turns a provider's
 * UNTRUSTED extraction output into reviewable ExtractionDrafts
 * (docs/architecture.md §6). Every field an AI produced is re-derived against
 * domain policy; nothing it emits may enter application state until a human
 * approves the resulting report.
 *
 * Pure: the only clock input is `now`, supplied by the caller, so the same
 * request always produces the same report.
 */
export interface ExtractRequest {
  rawInputId: string
  provider: string
  promptVersion: string
  /** Untrusted raw output returned by AiProvider.extractTasks. */
  raw: unknown
  shift: ShiftContext
  /** Titles of existing ACTIONABLE tasks in the shift, for duplicate detection. */
  existingTitles: string[]
  /** Character length of the original utterance, for the oversized-input warning. */
  inputLength?: number
  /** Reference instant for relative hints ("in 30m") and the report timestamp. */
  now: Date
}

const MAX_INPUT_LENGTH = 5000
const MAX_SOURCE_TEXT_LENGTH = 20000
const MAX_REASON_LENGTH = 500
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_HINT_LENGTH = 200
const MAX_DEPENDENCY_REFS = 50

/** Index + title of every candidate that parsed, aligned with the source array. */
type ParsedCandidate = { index: number; title: string } | null

export function runExtraction(req: ExtractRequest): ExtractionReport {
  const generatedAt = req.now.toISOString()
  const warnings: string[] = []
  if (req.inputLength !== undefined && req.inputLength > MAX_INPUT_LENGTH) {
    warnings.push(`Input was large (${req.inputLength} chars); extraction quality may degrade`)
  }

  const source = readEnvelope(req.raw, warnings)

  // Pass 1 — shape-check every candidate up front so that dependency references
  // can point FORWARD as well as backward ("do B, but only after C below").
  const parsed = source.map((item) => ExtractionCandidate.safeParse(item))
  const index: ParsedCandidate[] = parsed.map((result, i) =>
    result.success ? { index: i, title: result.data.title } : null,
  )

  // Pass 2 — policy, normalization and dependency resolution over the full set.
  const seenTitles = new Set(req.existingTitles.map(normalize))
  const drafts: ExtractionDraft[] = []
  let malformedCount = 0

  for (let i = 0; i < source.length; i++) {
    const result = parsed[i]!
    if (!result.success) {
      malformedCount += 1
      drafts.push(
        guard(
          {
            id: `draft-${i}`,
            index: i,
            disposition: "rejected",
            title: clamp(
              stringOrFallback(
                (source[i] as { title?: unknown })?.title,
                "(unparseable candidate)",
              ),
              TASK_TITLE_MAX_LENGTH,
            ),
            description: null,
            category: null,
            estimatedMinutes: null,
            estimateSource: "unknown",
            deadlineAt: null,
            deadlineSource: "unresolved",
            deadlineHint: null,
            explicitUrgency: "none",
            dependsOn: [],
            sourceText: clamp(sourceTextOf(source[i]), MAX_SOURCE_TEXT_LENGTH),
            rejectionReason: "malformed_provider_output",
            reasons: ["Provider returned a candidate that did not match the expected shape"],
          },
          i,
        ),
      )
      continue
    }

    const c = result.data

    if (!validateTaskTitle(c.title).ok) {
      drafts.push(rejected(i, c, "missing_title", "Candidate had no usable title"))
      continue
    }

    const normTitle = normalize(c.title)
    if (seenTitles.has(normTitle)) {
      drafts.push(
        rejected(i, c, "duplicate_candidate", "A task with this title already exists in the shift"),
      )
      continue
    }
    seenTitles.add(normTitle)

    if (
      c.estimatedMinutes !== null &&
      (!Number.isInteger(c.estimatedMinutes) || c.estimatedMinutes < 1 || c.estimatedMinutes > 480)
    ) {
      drafts.push(
        rejected(
          i,
          c,
          "invalid_duration",
          `Duration ${c.estimatedMinutes} is outside the allowed 1–480 minutes`,
        ),
      )
      continue
    }

    // Deadlines are resolved HERE, never by the provider: the model reports the
    // words it saw, the domain owns the calendar (packages/domain/src/time.ts).
    const deadline = resolveDeadlineHint(c.deadlineHint, req.shift, req.now)
    const reasons: string[] = c.ambiguity.map((note) => clamp(note, MAX_REASON_LENGTH))

    if (deadline.status === "resolved") {
      const resolvedAt = new Date(deadline.deadlineAt).getTime()
      const shiftStart = new Date(req.shift.startAt).getTime()
      if (Number.isFinite(shiftStart) && resolvedAt < shiftStart) {
        drafts.push(
          rejected(
            i,
            c,
            "deadline_before_shift",
            `"${c.deadlineHint ?? ""}" resolves to before the shift starts`,
          ),
        )
        continue
      }
    }
    if (deadline.status === "unresolved") {
      reasons.push(`Deadline "${deadline.hint}" could not be resolved — set one manually`)
    }

    const dep = resolveDependencies(c.dependencies.slice(0, MAX_DEPENDENCY_REFS), i, index)
    if (dep.unresolved.length > 0) {
      reasons.push(`Unresolved dependency reference(s): ${dep.unresolved.join(", ")}`)
    }
    if (dep.ambiguous) {
      reasons.push("A dependency reference matched more than one task")
    }

    drafts.push(
      guard(
        {
          id: `draft-${i}`,
          index: i,
          disposition: reasons.length > 0 ? "needsReview" : "accepted",
          title: clamp(c.title.trim(), TASK_TITLE_MAX_LENGTH),
          description: c.description === null ? null : clamp(c.description, MAX_DESCRIPTION_LENGTH),
          category: c.category as Category | null,
          estimatedMinutes: c.estimatedMinutes,
          estimateSource: estimateSourceOf(c),
          deadlineAt: deadline.status === "resolved" ? deadline.deadlineAt : null,
          deadlineSource: deadline.status === "resolved" ? "parsed" : "unresolved",
          deadlineHint: c.deadlineHint === null ? null : clamp(c.deadlineHint, MAX_HINT_LENGTH),
          explicitUrgency: (c.explicitUrgency ?? "none") as UrgencyLevel,
          dependsOn: dep.resolved,
          sourceText: clamp(c.sourceText, MAX_SOURCE_TEXT_LENGTH),
          rejectionReason: null,
          reasons,
        },
        i,
      ),
    )
  }

  if (malformedCount > 0) {
    warnings.push(
      `${malformedCount} provider candidate(s) were malformed and were not turned into tasks`,
    )
  }

  return {
    rawInputId: req.rawInputId,
    provider: req.provider,
    promptVersion: req.promptVersion,
    generatedAt,
    drafts,
    warnings,
  }
}

/**
 * Accept the documented envelope `{ tasks: [...] }`, a bare array, or an object
 * whose `tasks` key is an array. Anything else is a report-level warning and an
 * empty extraction — never a thrown error, because the raw text is already
 * durable and the worker must still be able to retry.
 */
function readEnvelope(raw: unknown, warnings: string[]): unknown[] {
  const parsed = AiExtractionOutput.safeParse(raw)
  if (parsed.success) return parsed.data.tasks
  if (Array.isArray(raw)) return raw
  if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as { tasks?: unknown }).tasks)
  ) {
    return (raw as { tasks: unknown[] }).tasks
  }
  warnings.push("Provider output did not match the expected schema")
  return []
}

/**
 * Final contract guard. Drafts are persisted and re-read through
 * ExtractionDraft, so a draft that does not satisfy the schema would poison the
 * intake and make it permanently unreadable. Anything that still fails here is
 * downgraded to a minimal rejected draft rather than escaping the pipeline.
 */
function guard(draft: ExtractionDraft, index: number): ExtractionDraft {
  const result = ExtractionDraft.safeParse(draft)
  if (result.success) return result.data
  return {
    id: `draft-${index}`,
    index,
    disposition: "rejected",
    title: "(unrepresentable candidate)",
    description: null,
    category: null,
    estimatedMinutes: null,
    estimateSource: "unknown",
    deadlineAt: null,
    deadlineSource: "unresolved",
    deadlineHint: null,
    explicitUrgency: "none",
    dependsOn: [],
    sourceText: "",
    rejectionReason: "malformed_provider_output",
    reasons: ["Candidate could not be represented as a reviewable draft"],
  }
}

/**
 * Resolve dependency references against the whole batch of candidates.
 * "#n" references the n-th candidate (1-based); free-text references are matched
 * against candidate titles. Resolved references become draft ids; anything that
 * cannot be resolved uniquely is reported for human review (the approval step
 * drops edges whose target was not approved).
 */
function resolveDependencies(
  refs: string[],
  selfIndex: number,
  candidates: ParsedCandidate[],
): { resolved: string[]; unresolved: string[]; ambiguous: boolean } {
  const resolved: string[] = []
  const unresolved: string[] = []
  let ambiguous = false

  for (const ref of refs) {
    const hash = ref.match(/^#(\d+)$/)
    if (hash && hash[1]) {
      const idx = parseInt(hash[1], 10) - 1
      if (candidates[idx] && idx !== selfIndex) resolved.push(`draft-${idx}`)
      else unresolved.push(ref)
      continue
    }

    const normRef = normalize(ref)
    if (normRef.length === 0) {
      unresolved.push(ref)
      continue
    }
    const matches = candidates.filter(
      (c): c is { index: number; title: string } =>
        c !== null &&
        c.index !== selfIndex &&
        (normalize(c.title).includes(normRef) || normRef.includes(normalize(c.title))),
    )
    if (matches.length === 1) resolved.push(`draft-${matches[0]!.index}`)
    else {
      if (matches.length > 1) ambiguous = true
      unresolved.push(ref)
    }
  }

  return { resolved: [...new Set(resolved)], unresolved, ambiguous }
}

function rejected(
  index: number,
  c: ExtractionCandidate,
  reason: ExtractionRejectionReason,
  explanation: string,
): ExtractionDraft {
  return guard(
    {
      id: `draft-${index}`,
      index,
      disposition: "rejected",
      title: clamp(stringOrFallback(c.title, "(untitled)"), TASK_TITLE_MAX_LENGTH),
      description: c.description === null ? null : clamp(c.description, MAX_DESCRIPTION_LENGTH),
      category: c.category,
      // Out-of-range values are the reason for rejection; do not echo them into
      // a field the contract constrains.
      estimatedMinutes: null,
      estimateSource: "unknown",
      deadlineAt: null,
      deadlineSource: "unresolved",
      deadlineHint: c.deadlineHint === null ? null : clamp(c.deadlineHint, MAX_HINT_LENGTH),
      explicitUrgency: c.explicitUrgency ?? "none",
      dependsOn: [],
      sourceText: clamp(c.sourceText, MAX_SOURCE_TEXT_LENGTH),
      rejectionReason: reason,
      reasons: [clamp(explanation, MAX_REASON_LENGTH)],
    },
    index,
  )
}

/**
 * Provenance of a duration. A value with no declared source is treated as
 * INFERRED, never as stated: we can only claim the worker said something when
 * the provider actually reports that they did.
 */
function estimateSourceOf(c: ExtractionCandidate): ExtractionDraft["estimateSource"] {
  if (c.estimatedMinutes === null) return "unknown"
  return c.estimatedMinutesSource === "stated" ? "stated" : "inferred"
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

function sourceTextOf(item: unknown): string {
  if (typeof item === "string") return item
  try {
    return JSON.stringify(item) ?? ""
  } catch {
    return ""
  }
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback
}
