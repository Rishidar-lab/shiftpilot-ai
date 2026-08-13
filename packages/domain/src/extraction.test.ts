import { describe, expect, it } from "vitest"

import { runExtraction, type ExtractRequest } from "./extraction.js"
import type { ExtractionDraft } from "@shiftpilot/contracts"

const shift = {
  id: "shift-1",
  date: "2026-08-12",
  startAt: "2026-08-12T06:00:00.000Z",
  endAt: "2026-08-12T14:00:00.000Z",
}

function req(rawTasks: unknown[], overrides: Partial<ExtractRequest> = {}): ExtractRequest {
  return {
    rawInputId: "raw-1",
    provider: "fake",
    promptVersion: "fake-1",
    raw: { tasks: rawTasks },
    shift,
    existingTitles: [],
    ...overrides,
  }
}

function candidate(over: Record<string, unknown> = {}) {
  return {
    title: "Do the thing",
    description: null,
    deadlineAt: null,
    estimatedMinutes: null,
    explicitUrgency: null,
    category: null,
    dependencies: [],
    ambiguity: [],
    sourceText: "Do the thing",
    ...over,
  }
}

describe("runExtraction", () => {
  it("accepts a clean candidate", () => {
    const report = runExtraction(req([candidate()]))
    expect(report.drafts).toHaveLength(1)
    expect((report.drafts[0] as ExtractionDraft).disposition).toBe("accepted")
    expect((report.drafts[0] as ExtractionDraft).reasons).toEqual([])
  })

  it("rejects candidates with a deadline before the shift", () => {
    const report = runExtraction(
      req([candidate({ title: "Too early", deadlineAt: "2026-08-12T05:00:00.000Z" })]),
    )
    expect((report.drafts[0] as ExtractionDraft).disposition).toBe("rejected")
    expect((report.drafts[0] as ExtractionDraft).reasons).toContain("deadline_before_shift")
  })

  it("rejects invalid durations", () => {
    const report = runExtraction(req([candidate({ estimatedMinutes: 999 })]))
    expect((report.drafts[0] as ExtractionDraft).reasons).toContain("invalid_duration")
  })

  it("rejects missing titles via policy", () => {
    const report = runExtraction(req([candidate({ title: "   " })]))
    expect((report.drafts[0] as ExtractionDraft).reasons).toContain("missing_title")
  })

  it("flags duplicate candidates within the batch", () => {
    const report = runExtraction(req([candidate({ title: "Same" }), candidate({ title: "Same" })]))
    expect((report.drafts[0] as ExtractionDraft).disposition).not.toBe("rejected")
    expect((report.drafts[1] as ExtractionDraft).reasons).toContain("duplicate_candidate")
  })

  it("flags duplicates against existing task titles", () => {
    const report = runExtraction(
      req([candidate({ title: "Existing task" })], { existingTitles: ["existing task"] }),
    )
    expect((report.drafts[0] as ExtractionDraft).reasons).toContain("duplicate_candidate")
  })

  it("resolves #n dependency references to draft ids", () => {
    const report = runExtraction(
      req([candidate({ title: "First" }), candidate({ title: "Second", dependencies: ["#1"] })]),
    )
    const second = (report.drafts[1] as ExtractionDraft)!
    expect(second.dependsOn).toEqual(["draft-0"])
  })

  it("flags unresolved references and routes them to needsReview", () => {
    const report = runExtraction(
      req([candidate({ title: "Only", dependencies: ["#5", "nonexistent task"] })]),
    )
    const only = (report.drafts[0] as ExtractionDraft)!
    expect(only.dependsOn).toEqual([])
    expect(only.reasons).toContain("unresolved_reference")
    expect(only.disposition).toBe("needsReview")
  })

  it("flags ambiguous free-text references", () => {
    const report = runExtraction(
      req([
        candidate({ title: "Inspection A" }),
        candidate({ title: "Inspection B" }),
        candidate({ title: "Follow up", dependencies: ["inspection"] }),
      ]),
    )
    const follow = report.drafts[2] as ExtractionDraft
    expect(follow.reasons).toContain("ambiguous_dependency")
    expect(follow.disposition).toBe("needsReview")
  })

  it("marks provider-flagged ambiguity as needsReview", () => {
    const report = runExtraction(req([candidate({ ambiguity: ["vague instruction"] })]))
    expect((report.drafts[0] as ExtractionDraft).disposition).toBe("needsReview")
  })

  it("rejects malformed provider candidates", () => {
    const report = runExtraction(req([{ not: "a candidate" }]))
    expect((report.drafts[0] as ExtractionDraft).reasons).toContain("malformed_provider_output")
    expect(report.warnings.some((w) => /malformed/i.test(w))).toBe(true)
  })

  it("warns on oversized input", () => {
    const report = runExtraction(req([candidate()], { inputLength: 9999 }))
    expect(report.warnings.some((w) => /large/i.test(w))).toBe(true)
  })

  it("produces a stable report envelope", () => {
    const report = runExtraction(req([candidate()]))
    expect(report.rawInputId).toBe("raw-1")
    expect(report.provider).toBe("fake")
    expect(report.promptVersion).toBe("fake-1")
    expect(typeof report.generatedAt).toBe("string")
  })
})
