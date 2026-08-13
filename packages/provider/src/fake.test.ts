import { describe, expect, it } from "vitest"

import { FakeAiProvider } from "./fake.js"
import type { ExtractionAttempt } from "./types.js"
import type { ExtractionCandidate, HandoverFacts } from "@shiftpilot/contracts"

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
    /** Internally consistent facts: the lists agree with the counts. */
    const FACTS: HandoverFacts = {
      shiftId: "shift-1",
      date: "2026-08-12",
      generatedAt: "2026-08-12T13:00:00.000Z",
      counts: {
        total: 4,
        active: 1,
        inProgress: 0,
        completed: 2,
        blocked: 1,
        cancelled: 0,
        overdue: 1,
        waiting: 0,
      },
      completed: [
        { taskId: "c1", title: "Cold chain check", completedAt: "2026-08-12T07:00:00.000Z" },
        { taskId: "c2", title: "Restock aisle 3", completedAt: "2026-08-12T09:00:00.000Z" },
      ],
      pending: [
        {
          taskId: "p1",
          title: "Unfreeze walk-in",
          priorityBucket: "high",
          deadlineAt: "2026-08-12T07:00:00.000Z",
          dueInMin: -360,
        },
      ],
      blocked: [{ taskId: "b1", title: "Install shelving", blockedBy: ["Parts delivery"] }],
      overdue: [{ taskId: "p1", title: "Unfreeze walk-in", overdueMin: 360 }],
      upcomingDeadlines: [],
      warnings: [{ type: "dependency_cycle", taskIds: ["a", "b"] }],
      recommendations: [],
    }

    it("produces a deterministic narrative from structured facts", async () => {
      const attempt = await provider.generateHandover(FACTS)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      expect(attempt.raw).toEqual({
        headline: "Handover for 2026-08-12",
        summary:
          "The list did not fully clear, and some items are past their deadline. " +
          "The planner raised dependency_cycle.",
        attention: [
          { taskId: "p1", why: "Past its deadline." },
          { taskId: "b1", why: "Waiting on Parts delivery." },
        ],
      })
    })

    it("returns the identical result on repeated calls", async () => {
      const first = await provider.generateHandover(FACTS)
      const second = await provider.generateHandover(FACTS)
      expect(first).toEqual(second)
    })

    it("only ever references task ids present in the facts", async () => {
      const attempt = await provider.generateHandover(FACTS)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      const known = new Set(["c1", "c2", "p1", "b1"])
      const raw = attempt.raw as { attention: Array<{ taskId: string }> }
      for (const item of raw.attention) expect(known.has(item.taskId)).toBe(true)
    })

    it("caps attention at the five entries the contract allows", async () => {
      const many: HandoverFacts = {
        ...FACTS,
        overdue: Array.from({ length: 8 }, (_, i) => ({
          taskId: `o${i}`,
          title: `Late ${i}`,
          overdueMin: 10,
        })),
      }
      const attempt = await provider.generateHandover(many)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      expect((attempt.raw as { attention: unknown[] }).attention).toHaveLength(5)
    })

    it("can be forced to fail so degraded handover has an offline twin", async () => {
      const failing = new FakeAiProvider({ kind: "network", message: "down" })
      const attempt = await failing.generateHandover(FACTS)
      expect(attempt.ok).toBe(false)
      if (attempt.ok) return
      expect(attempt.failure.kind).toBe("network")
    })
  })
})
