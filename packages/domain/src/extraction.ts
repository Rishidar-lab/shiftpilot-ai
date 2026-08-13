import {
  AiExtractionOutput,
  ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionReport,
  type ShiftContext,
} from "@shiftpilot/contracts"
import type { Category, UrgencyLevel } from "@shiftpilot/contracts"
import { validateTaskTitle } from "./policy.js"

/**
 * Deterministic validation + normalization pipeline that turns a provider's
 * UNTRUSTED extraction output into reviewable ExtractionDrafts
 * (docs/architecture.md §5). It is pure and has zero runtime dependencies:
 * no network, no clock dependency beyond the report timestamp. Every field an
 * AI produced is re-derived against domain policy; nothing it emits may enter
 * application state until a human approves the resulting report.
 */
export interface ExtractRequest {
  rawInputId: string
  provider: string
  promptVersion: string
  /** Untrusted raw output returned by AiProvider.extractTasks. */
  raw: unknown
  shift: ShiftContext
  /** Titles of existing non-cancelled tasks in the shift, for duplicate detection. */
  existingTitles: string[]
  /** Character length of the original utterance, for the oversized-input warning. */
  inputLength?: number
}

const MAX_INPUT_LENGTH = 5000

type ParsedCandidate = { index: number; title: string } | null

export function runExtraction(req: ExtractRequest): ExtractionReport {
  const generatedAt = new Date().toISOString()
  const warnings: string[] = []
  if (req.inputLength !== undefined && req.inputLength > MAX_INPUT_LENGTH) {
    warnings.push(`Input was large (${req.inputLength} chars); extraction quality may degrade`)
  }

  let source: unknown[] = []
  const parsed = AiExtractionOutput.safeParse(req.raw)
  if (parsed.success) {
    source = parsed.data.tasks
  } else if (Array.isArray(req.raw)) {
    source = req.raw
  } else if (
    req.raw !== null &&
    typeof req.raw === "object" &&
    Array.isArray((req.raw as { tasks?: unknown }).tasks)
  ) {
    source = (req.raw as { tasks?: unknown }).tasks as unknown[]
  } else {
    warnings.push("Provider output did not match the expected schema")
  }

  const shiftStart = parseIso(req.shift.startAt)
  const seenTitles = new Set(req.existingTitles.map(normalize))

  const drafts: ExtractionDraft[] = []
  const parsedCandidates: ParsedCandidate[] = []

  for (let i = 0; i < source.length; i++) {
    const result = ExtractionCandidate.safeParse(source[i])
    if (!result.success) {
      parsedCandidates.push(null)
      drafts.push({
        id: `draft-${i}`,
        index: i,
        disposition: "rejected",
        title: stringOrFallback(
          (source[i] as { title?: unknown })?.title,
          "(unparseable candidate)",
        ),
        description: null,
        category: null,
        estimatedMinutes: null,
        deadlineAt: null,
        deadlineSource: "unresolved",
        explicitUrgency: "none",
        dependsOn: [],
        sourceText: sourceTextOf(source[i]),
        reasons: ["malformed_provider_output"],
      })
      warnings.push("One or more provider candidates were malformed and skipped")
      continue
    }

    const c = result.data
    parsedCandidates.push({ index: i, title: c.title })

    const titleCheck = validateTaskTitle(c.title)
    if (!titleCheck.ok) {
      drafts.push(rejectedDraft(i, c, "missing_title"))
      continue
    }

    const normTitle = normalize(c.title)
    if (seenTitles.has(normTitle)) {
      drafts.push(rejectedDraft(i, c, "duplicate_candidate"))
      continue
    }
    seenTitles.add(normTitle)

    const deadlineAt: string | null = c.deadlineAt
    const deadlineSource: ExtractionDraft["deadlineSource"] = deadlineAt ? "parsed" : "unresolved"
    if (deadlineAt !== null) {
      const d = parseIso(deadlineAt)
      if (!d) {
        drafts.push(rejectedDraft(i, c, "invalid_deadline"))
        continue
      }
      if (shiftStart && d.getTime() < shiftStart.getTime()) {
        drafts.push(rejectedDraft(i, c, "deadline_before_shift"))
        continue
      }
    }

    if (c.estimatedMinutes !== null) {
      if (
        !Number.isInteger(c.estimatedMinutes) ||
        c.estimatedMinutes < 1 ||
        c.estimatedMinutes > 480
      ) {
        drafts.push(rejectedDraft(i, c, "invalid_duration"))
        continue
      }
    }

    const dep = resolveDependencies(c.dependencies, i, parsedCandidates)
    const reasons: string[] = [...(c.ambiguity ?? [])]
    if (dep.unresolved.length > 0) reasons.push("unresolved_reference")
    if (dep.ambiguous) reasons.push("ambiguous_dependency")

    const disposition: ExtractionDraft["disposition"] =
      reasons.length > 0 ? "needsReview" : "accepted"

    drafts.push({
      id: `draft-${i}`,
      index: i,
      disposition,
      title: c.title.trim(),
      description: c.description,
      category: c.category as Category | null,
      estimatedMinutes: c.estimatedMinutes,
      deadlineAt,
      deadlineSource,
      explicitUrgency: (c.explicitUrgency ?? "none") as UrgencyLevel,
      dependsOn: dep.resolved,
      sourceText: c.sourceText,
      reasons,
    })
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
 * Resolve dependency references against the same batch of candidates.
 * "#n" references the n-th candidate (1-based); free-text references are matched
 * against candidate titles. Resolved references become draft ids; anything that
 * cannot be resolved uniquely is returned as an unresolved raw reference (the
 * approval step will drop invalid edges via policy checkDependencies).
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
    const hash = ref.match(/^#(\d+)$/i)
    if (hash) {
      const idxStr = hash[1]
      if (!idxStr) {
        unresolved.push(ref)
        continue
      }
      const idx = parseInt(idxStr, 10) - 1
      const target = candidates[idx]
      if (target && idx !== selfIndex) resolved.push(`draft-${idx}`)
      else unresolved.push(ref)
      continue
    }

    const normRef = normalize(ref)
    const matches = candidates
      .map((c: ParsedCandidate, i) => ({ c, i }))
      .filter(
        ({ c, i }) =>
          c &&
          i !== selfIndex &&
          (normalize(c.title).includes(normRef) || normRef.includes(normalize(c.title))),
      )
    if (matches.length === 1) resolved.push(`draft-${matches[0]!.i}`)
    else if (matches.length > 1) {
      ambiguous = true
      unresolved.push(ref)
    } else unresolved.push(ref)
  }

  return { resolved, unresolved, ambiguous }
}

function rejectedDraft(index: number, c: ExtractionCandidate, reason: string): ExtractionDraft {
  return {
    id: `draft-${index}`,
    index,
    disposition: "rejected",
    title: stringOrFallback(c?.title, "(untitled)"),
    description: c?.description ?? null,
    category: c?.category ?? null,
    estimatedMinutes: c?.estimatedMinutes ?? null,
    deadlineAt: c?.deadlineAt ?? null,
    deadlineSource: "unresolved",
    explicitUrgency: (c?.explicitUrgency ?? "none") as UrgencyLevel,
    dependsOn: c?.dependencies ?? [],
    sourceText: c?.sourceText ?? "",
    reasons: [reason],
  }
}

function parseIso(s: string): Date | null {
  if (typeof s !== "string") return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

function sourceTextOf(item: unknown): string {
  return typeof item === "string" ? item : JSON.stringify(item)
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}
