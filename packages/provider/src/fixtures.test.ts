import { describe, expect, it } from "vitest"

import { listExtractionFixtures } from "./fixtures.js"
import { AiExtractionOutput, ExtractionCandidate } from "@shiftpilot/contracts"

describe("extraction fixtures", () => {
  const fixtures = listExtractionFixtures()

  it("ships fixtures for the pipeline to exercise", () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  it("declares provenance honestly on every fixture", () => {
    for (const fixture of fixtures) {
      expect(["synthetic", "recorded"]).toContain(fixture.source)
      // A recorded fixture must say which model and prompt produced it, or its
      // claim to be real output is unverifiable.
      if (fixture.source === "recorded") {
        expect(fixture.model).toBeTruthy()
        expect(fixture.promptVersion).toBeTruthy()
        expect(fixture.recordedAt).toBeTruthy()
      }
    }
  })

  it("contains no credential-shaped material", () => {
    // Fixtures are committed, so a leaked key would be a public key.
    for (const fixture of fixtures) {
      const serialized = JSON.stringify(fixture)
      expect(serialized).not.toMatch(/sk-ant-/)
      expect(serialized).not.toMatch(/ANTHROPIC_API_KEY/)
      expect(serialized).not.toMatch(/authorization/i)
    }
  })

  it("matches the provider output contract, so a real response would too", () => {
    for (const fixture of fixtures) {
      const envelope = AiExtractionOutput.safeParse(fixture.output)
      expect(envelope.success, `${fixture.name} envelope`).toBe(true)
      if (!envelope.success) continue
      for (const candidate of envelope.data.tasks) {
        expect(ExtractionCandidate.safeParse(candidate).success, `${fixture.name} candidate`).toBe(
          true,
        )
      }
    }
  })

  it("keeps deadline hints verbatim rather than resolved instants", () => {
    // A fixture containing an ISO timestamp would quietly re-legitimise the
    // provider doing date arithmetic (audit A-19/A-20).
    for (const fixture of listExtractionFixtures()) {
      const tasks = (fixture.output as { tasks: Array<{ deadlineHint: string | null }> }).tasks
      for (const task of tasks) {
        if (task.deadlineHint !== null) {
          expect(task.deadlineHint, `${fixture.name}`).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
        }
      }
    }
  })
})
