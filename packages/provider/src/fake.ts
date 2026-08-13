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
    promptId: "shiftpilot.task-extract",
    promptVersion: "fake-1",
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
      raw = { tasks: extractCandidates(input, _ctx) }
    } catch (err) {
      return {
        ok: false,
        failure: { kind: "invalid_response", detail: String(err) },
      }
    }
    return { ok: true, raw }
  }

  async generateHandover(facts: HandoverFacts): Promise<HandoverAttempt> {
    return {
      ok: true,
      raw: {
        summary: [
          `Shift ${facts.date}: ${facts.counts.completed} completed, ${facts.counts.cancelled} cancelled, ${facts.counts.active + facts.counts.inProgress} in progress, ${facts.counts.blocked} blocked, ${facts.counts.overdue} overdue.`,
          ...(facts.warnings.length > 0
            ? [
                `${facts.warnings.length} warning(s): ${facts.warnings.map((w) => w.type).join(", ")}.`,
              ]
            : ["No warnings."]),
        ].join(" "),
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
  deadlineAt: string | null
  estimatedMinutes: number | null
  explicitUrgency: string | null
  category: string | null
  dependencies: string[]
  ambiguity: string[]
  sourceText: string
}

function extractCandidates(input: string, ctx: ShiftContext): CandidateFields[] {
  const text = input.trim()
  if (text.length === 0) return []

  for (const fixture of FIXTURES) {
    if (fixture.match.test(text)) {
      return fixture.tasks.map((t) => ({
        title: t.title ?? "Untitled task",
        description: t.description ?? null,
        deadlineAt: t.deadlineAt ?? null,
        estimatedMinutes: t.estimatedMinutes ?? null,
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
    .map((line) => extractOne(line, ctx))
}

function extractOne(line: string, ctx: ShiftContext): CandidateFields {
  const title = line.trim()
  const deadlineAt = parseDeadline(line, ctx)
  const estimatedMinutes = parseDuration(line)
  const explicitUrgency = parseUrgency(line)
  const category = parseCategory(line)
  const dependencies = parseDependencies(line)

  const ambiguity: string[] = []
  if (explicitUrgency === "critical" && deadlineAt === null) {
    ambiguity.push("Flagged urgent but no deadline was detected")
  }

  return {
    title,
    description: null,
    deadlineAt,
    estimatedMinutes,
    explicitUrgency,
    category,
    dependencies,
    ambiguity,
    sourceText: line,
  }
}

const DEADLINE_CUES = /\b(by|before|due|at|on|eod|end of (?:shift|day)|deadline)\b/i

function parseDeadline(line: string, ctx: ShiftContext): string | null {
  const lower = line.toLowerCase()
  if (/\b(eod|end of (?:shift|day))\b/.test(lower)) return ctx.endAt

  const time12 = line.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  if (time12 && time12[3] && DEADLINE_CUES.test(lower)) {
    const hourStr = time12[1]
    const minStr = time12[2]
    if (!hourStr) return null
    let hour = parseInt(hourStr, 10)
    const minute = minStr ? parseInt(minStr, 10) : 0
    const mer = time12[3].toLowerCase()
    if (mer === "pm" && hour !== 12) hour += 12
    if (mer === "am" && hour === 12) hour = 0
    return toIso(ctx.date, hour, minute)
  }

  const time24 = line.match(/(\d{1,2}):(\d{2})/)
  if (time24 && DEADLINE_CUES.test(lower)) {
    const hourStr = time24[1]
    const minStr = time24[2]
    if (!hourStr || !minStr) return null
    return toIso(ctx.date, parseInt(hourStr, 10), parseInt(minStr, 10))
  }

  const word = lower.match(/\b(morning|noon|afternoon|evening)\b/)
  if (word && word[1] && DEADLINE_CUES.test(lower)) {
    const map: Record<string, [number, number]> = {
      morning: [9, 0],
      noon: [12, 0],
      afternoon: [15, 0],
      evening: [18, 0],
    }
    const mapped = map[word[1]]
    if (!mapped) return null
    const [h, m] = mapped
    return toIso(ctx.date, h, m)
  }

  return null
}

function toIso(date: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, "0")
  const mm = String(minute).padStart(2, "0")
  return `${date}T${hh}:${mm}:00.000Z`
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
