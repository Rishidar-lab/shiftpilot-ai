import { describe, expect, it } from "vitest"

import { FakeAiProvider } from "./fake.js"
import type { ExtractionCandidate } from "@shiftpilot/contracts"

describe("FakeAiProvider", () => {
  const provider = new FakeAiProvider()
  const ctx = {
    id: "shift-1",
    date: "2026-08-12",
    startAt: "2026-08-12T06:00:00.000Z",
    endAt: "2026-08-12T14:00:00.000Z",
  }

  describe("extractTasks", () => {
    it("splits lines into candidate tasks deterministically", async () => {
      const attempt = await provider.extractTasks("- Restock aisle 3\ncall Mrs Chen\n", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const tasks = attempt.raw as { tasks: ExtractionCandidate[] }
      expect(tasks.tasks).toHaveLength(2)
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).title).toBe(
        "Restock aisle 3",
      )
      expect((tasks.tasks[1] as ExtractionCandidate as ExtractionCandidate).title).toBe(
        "call Mrs Chen",
      )
      // Nullable fields are present and explicit (never fabricated).
      for (const t of tasks.tasks) {
        expect(t.description).toBeNull()
        expect(t.deadlineAt).toBeNull()
        expect(t.estimatedMinutes).toBeNull()
        expect(t.explicitUrgency).toBeNull()
        expect(t.category).toBeNull()
        expect(t.dependencies).toEqual([])
        expect(t.ambiguity).toEqual([])
        expect(typeof t.sourceText).toBe("string")
      }
    })

    it("strips bullet markers and ignores blank lines", async () => {
      const attempt = await provider.extractTasks("- a\n\n* b\n\u2022 c\n   \n", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const tasks = attempt.raw as { tasks: ExtractionCandidate[] }
      expect(tasks.tasks.map((t) => t.title)).toEqual(["a", "b", "c"])
    })

    it("detects deadline vocabulary against the shift date", async () => {
      const attempt = await provider.extractTasks(
        "Submit safety report by 3pm\nFinalize by end of shift",
        ctx,
      )
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const tasks = attempt.raw as { tasks: ExtractionCandidate[] }
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).deadlineAt).toBe(
        "2026-08-12T15:00:00.000Z",
      )
      expect((tasks.tasks[1] as ExtractionCandidate as ExtractionCandidate).deadlineAt).toBe(
        ctx.endAt,
      )
    })

    it("parses durations in minutes and hours", async () => {
      const attempt = await provider.extractTasks(
        "Deep clean for 45 minutes\nTraining for 1 hour",
        ctx,
      )
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const tasks = attempt.raw as { tasks: ExtractionCandidate[] }
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).estimatedMinutes).toBe(
        45,
      )
      expect((tasks.tasks[1] as ExtractionCandidate as ExtractionCandidate).estimatedMinutes).toBe(
        60,
      )
    })

    it("classifies urgency and category from keywords", async () => {
      const attempt = await provider.extractTasks(
        "URGENT: evacuate if alarm\nHigh priority customer complaint\nLunch break",
        ctx,
      )
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const tasks = attempt.raw as { tasks: ExtractionCandidate[] }
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).explicitUrgency).toBe(
        "critical",
      )
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).category).toBe("safety")
      expect((tasks.tasks[1] as ExtractionCandidate as ExtractionCandidate).explicitUrgency).toBe(
        "high",
      )
      expect((tasks.tasks[1] as ExtractionCandidate as ExtractionCandidate).category).toBe(
        "customer",
      )
      expect((tasks.tasks[2] as ExtractionCandidate).category).toBe("break")
    })

    it("captures dependency references", async () => {
      const attempt = await provider.extractTasks("Restock #1\nafter the briefing", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const tasks = attempt.raw as { tasks: ExtractionCandidate[] }
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).dependencies).toEqual([
        "#1",
      ])
      expect((tasks.tasks[1] as ExtractionCandidate as ExtractionCandidate).dependencies).toEqual([
        "the briefing",
      ])
    })

    it("applies recorded fixtures for paragraph briefings", async () => {
      const attempt = await provider.extractTasks("Morning huddle and shift briefing", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const tasks = attempt.raw as { tasks: ExtractionCandidate[] }
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).title).toBe(
        "Run shift briefing with incoming team",
      )
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).category).toBe(
        "training",
      )
    })

    it("flags urgent tasks that have no deadline as ambiguous", async () => {
      const attempt = await provider.extractTasks("URGENT fix the printer", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const tasks = attempt.raw as { tasks: ExtractionCandidate[] }
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).explicitUrgency).toBe(
        "critical",
      )
      expect((tasks.tasks[0] as ExtractionCandidate as ExtractionCandidate).ambiguity).toContain(
        "Flagged urgent but no deadline was detected",
      )
    })

    it("returns an empty task list for empty input", async () => {
      const attempt = await provider.extractTasks("   ", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      expect((attempt.raw as { tasks: ExtractionCandidate[] }).tasks).toEqual([])
    })

    it("exposes non-misleading provenance metadata", () => {
      expect(provider.meta.id).toBe("fake")
      expect(provider.meta.label.toLowerCase()).toContain("fake")
      expect(provider.meta.label.toLowerCase()).not.toContain("claude")
      expect(provider.meta.promptVersion).toMatch(/^fake-/)
    })

    it("can be forced to fail for deterministic failure-path tests", async () => {
      const failing = new FakeAiProvider({ kind: "timeout" })
      const attempt = await failing.extractTasks("anything", ctx)
      expect(attempt.ok).toBe(false)
      if (attempt.ok) return
      expect(attempt.failure.kind).toBe("timeout")
    })
  })

  describe("generateHandover", () => {
    it("produces a deterministic summary from structured facts", async () => {
      const attempt = await provider.generateHandover({
        shiftId: "shift-1",
        date: "2026-08-12",
        generatedAt: "2026-08-12T13:00:00.000Z",
        counts: {
          total: 5,
          active: 1,
          inProgress: 1,
          completed: 2,
          blocked: 1,
          cancelled: 0,
          overdue: 1,
          waiting: 1,
        },
        completed: [],
        pending: [],
        blocked: [],
        overdue: [],
        upcomingDeadlines: [],
        warnings: [{ type: "dependency_cycle", taskIds: ["a", "b"] }],
        recommendations: [],
      })
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      expect(attempt.raw).toEqual({
        summary:
          "Shift 2026-08-12: 2 completed, 0 cancelled, 2 in progress, 1 blocked, 1 overdue. 1 warning(s): dependency_cycle.",
      })
    })
  })
})
