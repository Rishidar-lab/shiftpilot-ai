import { describe, expect, it } from "vitest"

import { FakeAiProvider } from "./fake.js"

describe("FakeAiProvider", () => {
  const provider = new FakeAiProvider()
  const ctx = {
    id: "shift-1",
    date: "2026-08-12",
    startAt: "2026-08-12T06:00:00.000Z",
    endAt: "2026-08-12T14:00:00.000Z",
  }

  describe("extractTasks", () => {
    it("splits lines into titled tasks deterministically", async () => {
      const attempt = await provider.extractTasks("- Restock aisle 3\ncall Mrs Chen\n", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      expect(attempt.raw).toEqual({
        tasks: [{ title: "Restock aisle 3" }, { title: "call Mrs Chen" }],
      })
    })

    it("strips bullet markers and ignores blank lines", async () => {
      const attempt = await provider.extractTasks("- a\n\n* b\n\u2022 c\n   \n", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      expect(attempt.raw).toEqual({ tasks: [{ title: "a" }, { title: "b" }, { title: "c" }] })
    })

    it("returns an empty task list for empty input", async () => {
      const attempt = await provider.extractTasks("", ctx)
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      expect(attempt.raw).toEqual({ tasks: [] })
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
