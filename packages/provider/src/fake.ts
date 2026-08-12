import type { HandoverFacts, ShiftContext } from "@shiftpilot/contracts"
import type { AiProvider, ExtractionAttempt, HandoverAttempt } from "./types.js"

/**
 * Deterministic offline implementation of AiProvider (docs/architecture.md §3, §5).
 * Used for development, demos, and the entire test suite — it is a REAL
 * implementation, not a stub: it must behave exactly per the interface contract.
 *
 * M0 scope: line-heuristic extraction (titles only). Refinement of this provider
 * to the full heuristic (deadline vocabulary, category keywords, estimates)
 * lands in M2 (docs/implementation-plan.md A-03).
 */
export class FakeAiProvider implements AiProvider {
  async extractTasks(input: string, _ctx: ShiftContext): Promise<ExtractionAttempt> {
    const tasks = splitLines(input)
      .map(stripListMarker)
      .filter(isNonEmpty)
      .map((title) => ({ title }))
    return { ok: true, raw: { tasks } }
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

function splitLines(input: string): string[] {
  return input.split("\n")
}

function stripListMarker(line: string): string {
  return line.replace(/^[-*•]\s*/, "").trim()
}

function isNonEmpty(line: string): boolean {
  return line.length > 0
}
