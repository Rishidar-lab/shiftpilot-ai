import type { HandoverFacts, ShiftContext } from "@shiftpilot/contracts"
import type {
  AiProvider,
  AiProviderMeta,
  ExtractionAttempt,
  HandoverAttempt,
  ProviderFailure,
} from "./types.js"

/**
 * Deterministic offline implementation of AiProvider (docs/architecture.md §3, §5).
 * It is a REAL implementation, not a stub: it applies a transparent line/sentence
 * heuristic plus a few recorded fixtures, so demos and the whole test suite run
 * with zero network and zero LLM. It must never be presented as Claude or any
 * real model — `meta.label` makes that explicit for the UI.
 *
 * The output is UNTRUSTED: missing fields stay missing (we never fabricate), and
 * every field is re-validated and re-derived by the domain pipeline.
 */
export class FakeAiProvider implements AiProvider {
  readonly meta: AiProviderMeta = {
    id: "fake",
    label: "Fake (offline heuristic) — simulated, not a real LLM",
    isFake: true,
    model: null,
    promptId: "shiftpilot.task-extract",
    promptVersion: "fake-1",
    handoverPromptId: "shiftpilot.handover-narrative",
    handoverPromptVersion: "fake-1",
  }

  /**
   * When set, every extraction fails with this ProviderFailure. Used by tests
   * to exercise the timeout/rate-limit/quota/network/invalid/over-budget paths
   * deterministically without any real outage.
   */
  constructor(private readonly forcedFailure?: ProviderFailure) {}

  async extractTasks(input: string, _ctx: ShiftContext): Promise<ExtractionAttempt> {
    if (this.forcedFailure) return { ok: false, failure: this.forcedFailure }

    let raw: unknown
    try {
      raw = { tasks: extractCandidates(input) }
    } catch (err) {
      return {
        ok: false,
        failure: { kind: "invalid_response", detail: String(err) },
      }
    }
    return { ok: true, raw }
  }

  /**
   * Deterministic handover prose. Like the real provider it returns UNTRUSTED
   * `raw` that the domain validates against the same facts, so the offline path
   * exercises the identical pipeline rather than a shortcut. Every phrase is
   * derived from the facts it was handed — this provider cannot invent either.
   */
  async generateHandover(facts: HandoverFacts): Promise<HandoverAttempt> {
    if (this.forcedFailure) return { ok: false, failure: this.forcedFailure }

    const carried = facts.pending.length
    const shape =
      facts.counts.total === 0
        ? "Nothing was captured for this shift."
        : carried === 0
          ? "Everything on the list was closed out; nothing carries over."
          : facts.counts.overdue > 0
            ? "The list did not fully clear, and some items are past their deadline."
            : "Most of the list moved; a few items carry over to the next shift."

    // Attention items are drawn from the facts, overdue first, then blocked —
    // the same ordering a reader would expect, computed rather than chosen.
    const attention = [
      ...facts.overdue.map((t) => ({ taskId: t.taskId, why: "Past its deadline." })),
      ...facts.blocked.map((t) => ({
        taskId: t.taskId,
        why:
          t.blockedBy.length > 0
            ? `Waiting on ${t.blockedBy.join(", ")}.`
            : "Blocked and needs a decision.",
      })),
    ].slice(0, 5)

    return {
      ok: true,
      raw: {
        headline: `Handover for ${facts.date}`,
        summary: [
          shape,
          facts.warnings.length > 0
            ? `The planner raised ${facts.warnings.map((w) => w.type).join(", ")}.`
            : "The planner raised no warnings.",
        ].join(" "),
        attention,
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Extraction heuristic
// ---------------------------------------------------------------------------

const URGENCY_PATTERNS: Array<[RegExp, "critical" | "high" | "medium" | "low"]> = [
  [/\b(critical|urgent|asap|immediately|emergency)\b/i, "critical"],
  [/\b(high[\s-]?priority|important|priorit(?:y|ize))\b/i, "high"],
  [/\b(medium[\s-]?priority)\b/i, "medium"],
  [/\b(low[\s-]?priority|when (?:you )?(?:can|free|possible)|whenever|backlog|someday)\b/i, "low"],
]

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(safety|ppe|hazard|spill|incident|evacuat\w*|fire|first[\s-]?aid|injur\w*|slip)\b/i,
    "safety",
  ],
  [/\b(compliance|audit|regulat|osha|permit|violation|inspection log)\b/i, "compliance"],
  [/\b(customer|guest|client|complaint|service|patron|visitor)\b/i, "customer"],
  [/\b(walk(?:through|ing)|patrol|round|tour|floor[\s-]?check|site check)\b/i, "walkthrough"],
  [/\b(training|onboard|orient|shadow|mentor|teach|brief)\b/i, "training"],
  [/\b(break|lunch|rest|coffee)\b/i, "break"],
  [
    /\b(admin|paperwork|report|filing|timesheet|email|schedule|invoice|document|data entry|note)\b/i,
    "admin",
  ],
]

/**
 * Recorded fixtures for inputs the line heuristic parses poorly (e.g. a single
 * paragraph briefing). Matched against the lowercased text; the first hit wins.
 * Everything else falls through to the line heuristic.
 */
const FIXTURES: Array<{ match: RegExp; tasks: Array<Partial<CandidateFields>> }> = [
  {
    match: /shift (?:briefing|handoff|kickoff)|morning (?:brief|huddle)/i,
    tasks: [
      {
        title: "Run shift briefing with incoming team",
        category: "training",
        estimatedMinutes: 15,
        explicitUrgency: "high",
      },
      {
        title: "Review overnight incident log",
        category: "safety",
        estimatedMinutes: 20,
      },
    ],
  },
]

interface CandidateFields {
  title: string
  description: string | null
  deadlineHint: string | null
  estimatedMinutes: number | null
  estimatedMinutesSource: "stated" | "inferred" | null
  explicitUrgency: string | null
  category: string | null
  dependencies: string[]
  ambiguity: string[]
  sourceText: string
}

function extractCandidates(input: string): CandidateFields[] {
  const text = input.trim()
  if (text.length === 0) return []

  for (const fixture of FIXTURES) {
    if (fixture.match.test(text)) {
      return fixture.tasks.map((t) => ({
        title: t.title ?? "Untitled task",
        description: t.description ?? null,
        deadlineHint: t.deadlineHint ?? null,
        estimatedMinutes: t.estimatedMinutes ?? null,
        estimatedMinutesSource: t.estimatedMinutes === undefined ? null : "stated",
        explicitUrgency: t.explicitUrgency ?? null,
        category: t.category ?? null,
        dependencies: t.dependencies ?? [],
        ambiguity: t.ambiguity ?? [],
        sourceText: text,
      }))
    }
  }

  return splitLines(text)
    .map(stripListMarker)
    .filter((line) => line.length > 0)
    .map(extractOne)
}

function extractOne(line: string): CandidateFields {
  const title = line.trim()
  const deadlineHint = findDeadlineHint(line)
  const estimatedMinutes = parseDuration(line)
  const explicitUrgency = parseUrgency(line)
  const category = parseCategory(line)
  const dependencies = parseDependencies(line)

  const ambiguity: string[] = []
  if (explicitUrgency === "critical" && deadlineHint === null) {
    ambiguity.push("Flagged urgent but no deadline was stated")
  }

  return {
    title,
    description: null,
    deadlineHint,
    estimatedMinutes,
    // This provider only ever reads durations out of the text; it never guesses.
    estimatedMinutesSource: estimatedMinutes === null ? null : "stated",
    explicitUrgency,
    category,
    dependencies,
    ambiguity,
    sourceText: line,
  }
}

const DEADLINE_CUES = /\b(by|before|due|at|on|eod|end of (?:shift|day)|deadline|in)\b/i

/**
 * Locate the VERBATIM deadline phrase — this provider deliberately does no date
 * arithmetic. Turning "by 2pm" into an instant depends on the shift's calendar
 * date and time zone, which is deterministic domain policy
 * (packages/domain/src/time.ts), not a provider concern. Doing it here once
 * produced UTC-stamped local times (audit A-20) and meant the fake and a real
 * model could disagree about what the same words meant.
 */
function findDeadlineHint(line: string): string | null {
  const lower = line.toLowerCase()

  const endOfShift = lower.match(/\b(eod|end of (?:the )?(?:shift|day)|before close|closing)\b/)
  if (endOfShift && endOfShift[0]) return endOfShift[0]

  if (!DEADLINE_CUES.test(lower)) return null

  const relative = lower.match(/\bin \d{1,4}\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/)
  if (relative && relative[0]) return relative[0]

  const time12 = lower.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/)
  if (time12 && time12[0]) return withTomorrow(lower, time12[0])

  const time24 = lower.match(/\b\d{1,2}:\d{2}\b/)
  if (time24 && time24[0]) return withTomorrow(lower, time24[0])

  const named = lower.match(/\b(morning|noon|midday|afternoon|evening|midnight)\b/)
  if (named && named[0]) return withTomorrow(lower, named[0])

  return null
}

/** Keep "tomorrow" attached to the phrase so the domain can resolve the date. */
function withTomorrow(lower: string, phrase: string): string {
  return /\btomorrow\b/.test(lower) ? `tomorrow ${phrase}` : phrase
}

function parseDuration(line: string): number | null {
  const hour = line.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hr|hrs|hour|hours)/i)
  if (hour && hour[1]) return Math.round(parseFloat(hour[1]) * 60)
  const min = line.match(/(\d+)\s*(?:min|mins|minute|minutes)/i)
  if (min && min[1]) return parseInt(min[1], 10)
  if (/\bhalf[\s-]?hour\b/i.test(line)) return 30
  return null
}

function parseUrgency(line: string): string | null {
  for (const [pattern, level] of URGENCY_PATTERNS) {
    if (pattern.test(line)) return level
  }
  return null
}

function parseCategory(line: string): string | null {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(line)) return category
  }
  return null
}

function parseDependencies(line: string): string[] {
  const deps: string[] = []
  const hashRefs = line.match(/#(\d+)/g)
  if (hashRefs) deps.push(...hashRefs.map((r) => r.toUpperCase()))
  const afterPhrase = line.match(/\bafter ((?:the )?.{2,40}?)(?:[.,;]|$)/i)
  if (afterPhrase && afterPhrase[1]) deps.push(afterPhrase[1].trim())
  return deps
}

function splitLines(input: string): string[] {
  return input.split("\n")
}

function stripListMarker(line: string): string {
  return line.replace(/^[-*•]\s*/, "").trim()
}
