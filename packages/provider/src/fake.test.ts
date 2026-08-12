import { describe, expect, it } from "vitest"

import { FakeAiProvider } from "./fake.js"

describe("FakeAiProvider", () => {
  const provider = new FakeAiProvider()
  const ctx = { date: "2026-08-12", startMin: 540, endMin: 1080 }

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
    it("produces a deterministic summary from facts", async () => {
      const attempt = await provider.generateHandover({
        completedTitles: ["Cold chain check", "Restock aisle 3"],
        pendingTitles: ["Counts"],
        blockedTitles: [],
      })
      expect(attempt.ok).toBe(true)
      if (!attempt.ok) return
      expect(attempt.raw).toEqual({
        summary:
          "Shift complete. 2 task(s) finished. 1 task(s) left for handover. 0 task(s) blocked.",
      })
    })
  })
})
