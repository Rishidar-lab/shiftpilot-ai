import { describe, expect, it } from "vitest"

import type {
  AiProvider,
  ExtractionAttempt,
  HandoverAttempt,
  ProviderFailure,
} from "@shiftpilot/provider"
import type { HandoverFacts, ShiftContext } from "@shiftpilot/contracts"
import { buildApp } from "./app.js"
import { parseAppConfig } from "./config.js"
import { openDatabase } from "./db/index.js"
import { rawInputs } from "./db/schema.js"
import type { Database } from "./db/index.js"
import type { FastifyInstance } from "fastify"
import { type ApprovalResult, type IntakeResult } from "./use-cases/intake.js"
import type { ExtractionDraft } from "@shiftpilot/contracts"

/** Controllable provider for deterministic API tests (no real LLM). */
class StubProvider implements AiProvider {
  meta = { id: "fake", label: "stub", promptId: "p", promptVersion: "fake-1" }
  constructor(
    private readonly mode: "ok" | ProviderFailure,
    private readonly output: unknown = { tasks: [] },
  ) {}
  async extractTasks(_input: string, _ctx: ShiftContext): Promise<ExtractionAttempt> {
    if (this.mode !== "ok") return { ok: false, failure: this.mode }
    return { ok: true, raw: this.output }
  }
  async generateHandover(_facts: HandoverFacts): Promise<HandoverAttempt> {
    return { ok: true, raw: {} }
  }
}

function setup(provider: AiProvider): { app: FastifyInstance; db: Database } {
  const config = parseAppConfig({ NODE_ENV: "test" })
  const db = openDatabase(":memory:")
  return { app: buildApp({ config, db, provider }), db }
}

const SHIFT = {
  date: "2026-08-12",
  startAt: "2026-08-12T06:00:00.000Z",
  endAt: "2026-08-12T14:00:00.000Z",
}

async function createShift(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/shifts", payload: SHIFT })
  return (res.json() as { id: string }).id
}

const CANDIDATE = (over: Record<string, unknown> = {}) => ({
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
})

describe("intake API", () => {
  it("captures an intake, persists it before extraction, and returns a reviewable report", async () => {
    const { app, db } = setup(
      new StubProvider("ok", {
        tasks: [
          CANDIDATE({ title: "Restock aisle 3" }),
          CANDIDATE({ title: "Call the supervisor" }),
        ],
      }),
    )
    const shiftId = await createShift(app)

    const res = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "Restock aisle 3\nCall the supervisor" },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as IntakeResult
    expect(body.rawInput.status).toBe("review_required")
    expect(body.rawInput.provider).toBe("fake")
    expect(body.rawInput.promptVersion).toBe("fake-1")
    expect(body.report.drafts).toHaveLength(2)
    expect(body.report.drafts.every((d) => d.disposition === "accepted")).toBe(true)

    // The RawInput row exists and predates the AI call (persisted before extraction).
    const rows = db.select().from(rawInputs).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe("review_required")
  })

  it("marks the intake failed and survives when the provider errors", async () => {
    const { app, db } = setup(new StubProvider({ kind: "timeout" }))
    const shiftId = await createShift(app)

    const res = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "anything" },
    })
    expect(res.statusCode).toBe(503)
    expect((res.json() as { error: { code: string } }).error.code).toBe("ai_unavailable")

    const rows = db.select().from(rawInputs).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe("failed")
    expect(rows[0]?.failureKind).toBe("timeout")
  })

  it("maps invalid_response/budget_exceeded to the right status codes", async () => {
    const invalid = setup(new StubProvider({ kind: "invalid_response", detail: "bad json" }))
    const shiftA = await createShift(invalid.app)
    const r1 = await invalid.app.inject({
      method: "POST",
      url: `/api/shifts/${shiftA}/intake`,
      payload: { shiftId: shiftA, rawText: "x" },
    })
    expect(r1.statusCode).toBe(502)

    const budget = setup(new StubProvider({ kind: "budget_exceeded" }))
    const shiftB = await createShift(budget.app)
    const r2 = await budget.app.inject({
      method: "POST",
      url: `/api/shifts/${shiftB}/intake`,
      payload: { shiftId: shiftB, rawText: "x" },
    })
    expect(r2.statusCode).toBe(402)
  })

  it("rejects invalid deadlines and flags duplicates against existing tasks", async () => {
    const { app } = setup(
      new StubProvider("ok", {
        tasks: [
          CANDIDATE({ title: "Too early", deadlineAt: "2026-08-12T05:00:00.000Z" }),
          CANDIDATE({ title: "Already exists" }),
        ],
      }),
    )
    const shiftId = await createShift(app)
    // seed an existing task with the same title
    await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/tasks`,
      payload: { title: "Already exists", category: "other" },
    })
    const res = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "batch" },
    })
    const drafts = (res.json() as IntakeResult).report.drafts
    const byTitle = Object.fromEntries(drafts.map((d) => [d.title, d]))
    expect((byTitle["Too early"] as ExtractionDraft).disposition).toBe("rejected")
    expect((byTitle["Too early"] as ExtractionDraft).reasons).toContain("deadline_before_shift")
    expect((byTitle["Already exists"] as ExtractionDraft).reasons).toContain("duplicate_candidate")
  })

  it("flags unresolved dependency references as needsReview", async () => {
    const { app } = setup(
      new StubProvider("ok", {
        tasks: [CANDIDATE({ title: "Solo", dependencies: ["#5", "nonexistent"] })],
      }),
    )
    const shiftId = await createShift(app)
    const res = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "solo" },
    })
    const draft = (res.json() as IntakeResult).report.drafts[0] as ExtractionDraft
    expect(draft.disposition).toBe("needsReview")
    expect(draft.reasons).toContain("unresolved_reference")
  })

  it("retrieves a persisted intake report (resumable review)", async () => {
    const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }))
    const shiftId = await createShift(app)
    const res = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "One task" },
    })
    const id = (res.json() as IntakeResult).rawInput.id
    const get = await app.inject({ method: "GET", url: `/api/intake/${id}` })
    expect(get.statusCode).toBe(200)
    expect((get.json() as IntakeResult).report.drafts).toHaveLength(1)
  })

  it("approves drafts into tasks within a transaction and resolves dependencies", async () => {
    const { app } = setup(
      new StubProvider("ok", {
        tasks: [
          CANDIDATE({ title: "First", estimatedMinutes: 20 }),
          CANDIDATE({ title: "Second", dependencies: ["#1"] }),
        ],
      }),
    )
    const shiftId = await createShift(app)
    const capture = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "two" },
    })
    const report = (capture.json() as IntakeResult).report
    const first = report.drafts[0] as ExtractionDraft
    const second = report.drafts[1] as ExtractionDraft

    const approve = await app.inject({
      method: "POST",
      url: `/api/intake/${report.rawInputId}/approve`,
      payload: {
        decisions: [
          { draftId: first.id, action: "approve" },
          { draftId: second.id, action: "approve" },
        ],
      },
    })
    expect(approve.statusCode).toBe(200)
    const result = approve.json() as ApprovalResult
    expect(result.rawInput.status).toBe("approved")
    expect(result.createdTasks).toHaveLength(2)

    // second task should depend on first
    const secondTask = result.createdTasks.find((t) => t.title === "Second")
    const firstTask = result.createdTasks.find((t) => t.title === "First")
    expect(secondTask?.dependsOn).toContain(firstTask?.id)
  })

  it("supports partial approval (reject one draft)", async () => {
    const { app } = setup(
      new StubProvider("ok", {
        tasks: [CANDIDATE({ title: "Keep" }), CANDIDATE({ title: "Drop" })],
      }),
    )
    const shiftId = await createShift(app)
    const capture = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "two" },
    })
    const report = (capture.json() as IntakeResult).report
    const keep = report.drafts[0] as ExtractionDraft
    const drop = report.drafts[1] as ExtractionDraft

    const approve = await app.inject({
      method: "POST",
      url: `/api/intake/${report.rawInputId}/approve`,
      payload: {
        decisions: [
          { draftId: keep.id, action: "approve" },
          { draftId: drop.id, action: "reject" },
        ],
      },
    })
    expect((approve.json() as ApprovalResult).rawInput.status).toBe("partially_approved")
    expect((approve.json() as ApprovalResult).createdTasks).toHaveLength(1)
  })

  it("rejects approval when the intake is not awaiting review", async () => {
    const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }))
    const shiftId = await createShift(app)
    const capture = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "one" },
    })
    const report = (capture.json() as IntakeResult).report
    const id = report.rawInputId
    await app.inject({
      method: "POST",
      url: `/api/intake/${id}/approve`,
      payload: {
        decisions: [{ draftId: (report.drafts[0] as ExtractionDraft).id, action: "approve" }],
      },
    })
    // second attempt should conflict
    const again = await app.inject({
      method: "POST",
      url: `/api/intake/${id}/approve`,
      payload: {
        decisions: [{ draftId: (report.drafts[0] as ExtractionDraft).id, action: "approve" }],
      },
    })
    expect(again.statusCode).toBe(409)
  })

  it("returns 404 for a missing intake", async () => {
    const { app } = setup(new StubProvider("ok"))
    await createShift(app)
    const res = await app.inject({ method: "GET", url: "/api/intake/does-not-exist" })
    expect(res.statusCode).toBe(404)
  })
})
