import { describe, expect, it } from "vitest"

import { runExtraction, type ExtractRequest } from "./extraction.js"
import { ExtractionDraft } from "@shiftpilot/contracts"

const shift = {
  id: "shift-1",
  date: "2026-08-12",
  startAt: "2026-08-12T06:00:00.000Z",
  endAt: "2026-08-12T14:00:00.000Z",
  timezone: "UTC",
}

const NOW = new Date("2026-08-12T08:00:00.000Z")

function req(rawTasks: unknown[], overrides: Partial<ExtractRequest> = {}): ExtractRequest {
  return {
    rawInputId: "raw-1",
    provider: "fake",
    promptVersion: "fake-1",
    raw: { tasks: rawTasks },
    shift,
    existingTitles: [],
    now: NOW,
    ...overrides,
  }
}

function candidate(over: Record<string, unknown> = {}) {
  return {
    title: "Do the thing",
    description: null,
    deadlineHint: null,
    estimatedMinutes: null,
    explicitUrgency: null,
    category: null,
    dependencies: [],
    ambiguity: [],
    sourceText: "Do the thing",
    ...over,
  }
}

/** Every draft leaving the pipeline must satisfy the persisted contract. */
function draftAt(report: { drafts: unknown[] }, index: number) {
  return ExtractionDraft.parse(report.drafts[index])
}

describe("runExtraction", () => {
  it("accepts a clean candidate", () => {
    const report = runExtraction(req([candidate()]))
    expect(report.drafts).toHaveLength(1)
    expect(draftAt(report, 0).disposition).toBe("accepted")
    expect(draftAt(report, 0).reasons).toEqual([])
    expect(draftAt(report, 0).rejectionReason).toBeNull()
  })

  it("rejects candidates whose deadline resolves before the shift starts", () => {
    const report = runExtraction(req([candidate({ title: "Too early", deadlineHint: "5:00" })]))
    expect(draftAt(report, 0).disposition).toBe("rejected")
    expect(draftAt(report, 0).rejectionReason).toBe("deadline_before_shift")
  })

  it("rejects invalid durations without echoing the invalid value", () => {
    const report = runExtraction(req([candidate({ estimatedMinutes: 999 })]))
    expect(draftAt(report, 0).rejectionReason).toBe("invalid_duration")
    expect(draftAt(report, 0).estimatedMinutes).toBeNull()
  })

  it("rejects missing titles via policy", () => {
    const report = runExtraction(req([candidate({ title: "   " })]))
    expect(draftAt(report, 0).rejectionReason).toBe("missing_title")
  })

  it("flags duplicate candidates within the batch", () => {
    const report = runExtraction(req([candidate({ title: "Same" }), candidate({ title: "Same" })]))
    expect(draftAt(report, 0).disposition).not.toBe("rejected")
    expect(draftAt(report, 1).rejectionReason).toBe("duplicate_candidate")
  })

  it("flags duplicates against existing task titles", () => {
    const report = runExtraction(
      req([candidate({ title: "Existing task" })], { existingTitles: ["existing task"] }),
    )
    expect(draftAt(report, 0).rejectionReason).toBe("duplicate_candidate")
  })

  it("resolves #n dependency references to draft ids", () => {
    const report = runExtraction(
      req([candidate({ title: "First" }), candidate({ title: "Second", dependencies: ["#1"] })]),
    )
    expect(draftAt(report, 1).dependsOn).toEqual(["draft-0"])
  })

  // Regression — audit A-8: references were resolved against only the
  // candidates seen SO FAR, so "do this after the stocktake below" could never
  // resolve. Order of mention must not decide whether a dependency exists.
  it("resolves dependency references that point forward in the batch", () => {
    const report = runExtraction(
      req([
        candidate({ title: "Restock aisle 3", dependencies: ["#2"] }),
        candidate({ title: "Count inventory" }),
      ]),
    )
    expect(draftAt(report, 0).dependsOn).toEqual(["draft-1"])
    expect(draftAt(report, 0).disposition).toBe("accepted")
  })

  it("resolves forward free-text references by title", () => {
    const report = runExtraction(
      req([
        candidate({ title: "Restock aisle 3", dependencies: ["count inventory"] }),
        candidate({ title: "Count inventory" }),
      ]),
    )
    expect(draftAt(report, 0).dependsOn).toEqual(["draft-1"])
  })

  it("never resolves a candidate as its own dependency", () => {
    const report = runExtraction(req([candidate({ title: "Solo", dependencies: ["#1", "solo"] })]))
    expect(draftAt(report, 0).dependsOn).toEqual([])
  })

  it("flags unresolved references and routes them to needsReview", () => {
    const report = runExtraction(
      req([candidate({ title: "Only", dependencies: ["#5", "nonexistent task"] })]),
    )
    const only = draftAt(report, 0)
    expect(only.dependsOn).toEqual([])
    expect(only.disposition).toBe("needsReview")
    expect(only.reasons.some((r) => /unresolved dependency/i.test(r))).toBe(true)
  })

  it("flags ambiguous free-text references", () => {
    const report = runExtraction(
      req([
        candidate({ title: "Inspection A" }),
        candidate({ title: "Inspection B" }),
        candidate({ title: "Follow up", dependencies: ["inspection"] }),
      ]),
    )
    const follow = draftAt(report, 2)
    expect(follow.reasons.some((r) => /more than one/i.test(r))).toBe(true)
    expect(follow.disposition).toBe("needsReview")
  })

  it("marks provider-flagged ambiguity as needsReview", () => {
    const report = runExtraction(req([candidate({ ambiguity: ["vague instruction"] })]))
    expect(draftAt(report, 0).disposition).toBe("needsReview")
    expect(draftAt(report, 0).reasons).toContain("vague instruction")
  })

  it("rejects malformed provider candidates", () => {
    const report = runExtraction(req([{ not: "a candidate" }]))
    expect(draftAt(report, 0).rejectionReason).toBe("malformed_provider_output")
    expect(report.warnings.some((w) => /malformed/i.test(w))).toBe(true)
  })

  // Regression — audit A-2: a malformed candidate's untrusted title/sourceText
  // were copied verbatim, producing a draft that violated its own contract. It
  // persisted fine and then threw on every read, bricking the intake.
  it("clamps untrusted strings so every draft satisfies the persisted contract", () => {
    const report = runExtraction(
      req([
        { ...candidate({ title: "A".repeat(400) }), unexpectedField: "x" },
        candidate({ title: "B".repeat(400), sourceText: "C".repeat(30_000) }),
      ]),
    )
    for (const draft of report.drafts) {
      const parsed = ExtractionDraft.safeParse(draft)
      expect(parsed.success).toBe(true)
    }
    expect(draftAt(report, 0).title.length).toBeLessThanOrEqual(120)
    expect(draftAt(report, 1).sourceText.length).toBeLessThanOrEqual(20_000)
  })

  it("warns on oversized input", () => {
    const report = runExtraction(req([candidate()], { inputLength: 9999 }))
    expect(report.warnings.some((w) => /large/i.test(w))).toBe(true)
  })

  it("keeps an unresolvable deadline phrase visible instead of guessing", () => {
    const report = runExtraction(
      req([candidate({ title: "Vague", deadlineHint: "next leap day" })]),
    )
    const draft = draftAt(report, 0)
    expect(draft.deadlineAt).toBeNull()
    expect(draft.deadlineSource).toBe("unresolved")
    expect(draft.deadlineHint).toBe("next leap day")
    expect(draft.disposition).toBe("needsReview")
  })

  it("resolves a supported deadline phrase against the shift clock", () => {
    const report = runExtraction(req([candidate({ deadlineHint: "3pm" })]))
    expect(draftAt(report, 0).deadlineAt).toBe("2026-08-12T15:00:00.000Z")
    expect(draftAt(report, 0).deadlineSource).toBe("parsed")
  })

  it("produces a stable report envelope driven by the supplied clock", () => {
    const report = runExtraction(req([candidate()]))
    expect(report.rawInputId).toBe("raw-1")
    expect(report.provider).toBe("fake")
    expect(report.promptVersion).toBe("fake-1")
    expect(report.generatedAt).toBe(NOW.toISOString())
  })
})
