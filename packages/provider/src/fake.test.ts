import { describe, expect, it } from "vitest"

import { FakeAiProvider } from "./fake.js"
import type { ExtractionAttempt } from "./types.js"
import type { ExtractionCandidate } from "@shiftpilot/contracts"

/** Unwrap a successful attempt's untrusted payload for assertions. */
function tasksOf(attempt: ExtractionAttempt): ExtractionCandidate[] {
  if (!attempt.ok) throw new Error("expected a successful extraction attempt")
  return (attempt.raw as { tasks: ExtractionCandidate[] }).tasks
}

describe("FakeAiProvider", () => {
  const provider = new FakeAiProvider()
  const ctx = {
    id: "shift-1",
    date: "2026-08-12",
    startAt: "2026-08-12T06:00:00.000Z",
    endAt: "2026-08-12T14:00:00.000Z",
    timezone: "UTC",
  }

  describe("extractTasks", () => {
    it("splits lines into candidate tasks deterministically", async () => {
      const tasks = tasksOf(await provider.extractTasks("- Restock aisle 3\ncall Mrs Chen\n", ctx))
      expect(tasks).toHaveLength(2)
      expect(tasks[0]?.title).toBe("Restock aisle 3")
      expect(tasks[1]?.title).toBe("call Mrs Chen")
      // Nullable fields are present and explicit (never fabricated).
      for (const t of tasks) {
        expect(t.description).toBeNull()
        expect(t.deadlineHint).toBeNull()
        expect(t.estimatedMinutes).toBeNull()
        expect(t.explicitUrgency).toBeNull()
        expect(t.category).toBeNull()
        expect(t.dependencies).toEqual([])
        expect(t.ambiguity).toEqual([])
        expect(typeof t.sourceText).toBe("string")
      }
    })

    it("strips bullet markers and ignores blank lines", async () => {
      const tasks = tasksOf(await provider.extractTasks("- a\n\n* b\n• c\n   \n", ctx))
      expect(tasks.map((t) => t.title)).toEqual(["a", "b", "c"])
    })

    it("reports deadline phrases verbatim and never resolves them itself", async () => {
      const tasks = tasksOf(
        await provider.extractTasks("Submit safety report by 3pm\nFinalize by end of shift", ctx),
      )
      expect(tasks[0]?.deadlineHint).toBe("3pm")
      expect(tasks[1]?.deadlineHint).toBe("end of shift")
      // The provider must not do calendar arithmetic: no ISO instants anywhere.
      for (const t of tasks) {
        expect(t.deadlineHint).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
      }
    })

    it("keeps 'tomorrow' attached so the domain can resolve the date", async () => {
      const tasks = tasksOf(await provider.extractTasks("Order stock by 9am tomorrow", ctx))
      expect(tasks[0]?.deadlineHint).toBe("tomorrow 9am")
    })

    it("parses durations in minutes and hours", async () => {
      const tasks = tasksOf(
        await provider.extractTasks("Deep clean for 45 minutes\nTraining for 1 hour", ctx),
      )
      expect(tasks[0]?.estimatedMinutes).toBe(45)
      expect(tasks[1]?.estimatedMinutes).toBe(60)
    })

    it("classifies urgency and category from keywords", async () => {
      const tasks = tasksOf(
        await provider.extractTasks(
          "URGENT: evacuate if alarm\nHigh priority customer complaint\nLunch break",
          ctx,
        ),
      )
      expect(tasks[0]?.explicitUrgency).toBe("critical")
      expect(tasks[0]?.category).toBe("safety")
      expect(tasks[1]?.explicitUrgency).toBe("high")
      expect(tasks[1]?.category).toBe("customer")
      expect(tasks[2]?.category).toBe("break")
    })

    it("captures dependency references", async () => {
      const tasks = tasksOf(await provider.extractTasks("Restock #1\nafter the briefing", ctx))
      expect(tasks[0]?.dependencies).toEqual(["#1"])
      expect(tasks[1]?.dependencies).toEqual(["the briefing"])
    })

    it("applies recorded fixtures for paragraph briefings", async () => {
      const tasks = tasksOf(await provider.extractTasks("Morning huddle and shift briefing", ctx))
      expect(tasks[0]?.title).toBe("Run shift briefing with incoming team")
      expect(tasks[0]?.category).toBe("training")
    })

    it("flags urgent tasks that have no deadline as ambiguous", async () => {
      const tasks = tasksOf(await provider.extractTasks("URGENT fix the printer", ctx))
      expect(tasks[0]?.explicitUrgency).toBe("critical")
      expect(tasks[0]?.ambiguity).toContain("Flagged urgent but no deadline was stated")
    })

    it("returns an empty task list for empty input", async () => {
      expect(tasksOf(await provider.extractTasks("   ", ctx))).toEqual([])
    })

    it("exposes non-misleading provenance metadata", () => {
      expect(provider.meta.id).toBe("fake")
      expect(provider.meta.isFake).toBe(true)
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
