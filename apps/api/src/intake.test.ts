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
import type { ExtractionDraft, Task } from "@shiftpilot/contracts"

/** Controllable provider for deterministic API tests (no real LLM). */
class StubProvider implements AiProvider {
  meta = {
    id: "fake",
    label: "stub",
    isFake: true,
    model: null,
    promptId: "p",
    promptVersion: "fake-1",
    handoverPromptId: "h",
    handoverPromptVersion: "fake-1",
  }
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

function setup(
  provider: AiProvider,
  env: Record<string, string> = {},
): { app: FastifyInstance; db: Database } {
  const config = parseAppConfig({ NODE_ENV: "test", ...env })
  const db = openDatabase(":memory:")
  return { app: buildApp({ config, db, provider }), db }
}

const SHIFT = {
  date: "2026-08-12",
  startAt: "2026-08-12T06:00:00.000Z",
  endAt: "2026-08-12T14:00:00.000Z",
  timezone: "UTC",
}

async function createShift(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/shifts", payload: SHIFT })
  return (res.json() as { id: string }).id
}

async function capture(
  app: FastifyInstance,
  shiftId: string,
  rawText = "batch",
): Promise<IntakeResult> {
  const res = await app.inject({
    method: "POST",
    url: `/api/shifts/${shiftId}/intake`,
    payload: { shiftId, rawText },
  })
  return res.json() as IntakeResult
}

const CANDIDATE = (over: Record<string, unknown> = {}) => ({
  title: "Do the thing",
  description: null,
  deadlineHint: null,
  estimatedMinutes: null,
  estimatedMinutesSource: null,
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
    expect(rows[0]?.rawText).toBe("anything")
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
          CANDIDATE({ title: "Too early", deadlineHint: "5:00" }),
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
    const drafts = (await capture(app, shiftId)).report.drafts
    const byTitle = Object.fromEntries(drafts.map((d) => [d.title, d]))
    expect((byTitle["Too early"] as ExtractionDraft).disposition).toBe("rejected")
    expect((byTitle["Too early"] as ExtractionDraft).rejectionReason).toBe("deadline_before_shift")
    expect((byTitle["Already exists"] as ExtractionDraft).rejectionReason).toBe(
      "duplicate_candidate",
    )
  })

  // Regression — audit A-21: dedupe compared against every task ever created,
  // so re-adding work the worker had cancelled was refused as a duplicate.
  it("does not treat a cancelled task's title as a duplicate", async () => {
    const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE({ title: "Restock" })] }))
    const shiftId = await createShift(app)
    const created = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/tasks`,
      payload: { title: "Restock", category: "other" },
    })
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${(created.json() as Task).id}`,
      payload: { status: "cancelled" },
    })

    const drafts = (await capture(app, shiftId)).report.drafts
    expect(drafts[0]?.disposition).toBe("accepted")
    expect(drafts[0]?.rejectionReason).toBeNull()
  })

  it("flags unresolved dependency references as needsReview", async () => {
    const { app } = setup(
      new StubProvider("ok", {
        tasks: [CANDIDATE({ title: "Solo", dependencies: ["#5", "nonexistent"] })],
      }),
    )
    const shiftId = await createShift(app)
    const draft = (await capture(app, shiftId, "solo")).report.drafts[0] as ExtractionDraft
    expect(draft.disposition).toBe("needsReview")
    expect(draft.reasons.some((r) => /unresolved dependency/i.test(r))).toBe(true)
  })

  it("retrieves a persisted intake report (resumable review)", async () => {
    const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }))
    const shiftId = await createShift(app)
    const id = (await capture(app, shiftId, "One task")).rawInput.id
    const get = await app.inject({ method: "GET", url: `/api/intake/${id}` })
    expect(get.statusCode).toBe(200)
    expect((get.json() as IntakeResult).report.drafts).toHaveLength(1)
  })

  // Regression — audit A-2: untrusted provider strings were persisted unclamped,
  // so a draft could be written that failed its own schema on read-back. The
  // capture succeeded and every later GET returned 422 — the intake was bricked.
  it("survives a provider candidate with an oversized title", async () => {
    const { app } = setup(
      new StubProvider("ok", {
        tasks: [{ ...CANDIDATE({ title: "A".repeat(400) }), unexpectedField: 1 }],
      }),
    )
    const shiftId = await createShift(app)
    const created = await capture(app, shiftId, "long")
    expect(created.report.drafts[0]?.disposition).toBe("rejected")

    const get = await app.inject({ method: "GET", url: `/api/intake/${created.rawInput.id}` })
    expect(get.statusCode).toBe(200)
    expect((get.json() as IntakeResult).report.drafts).toHaveLength(1)
  })

  // Regression — audit A-3: the client could name the provider in the request
  // body and have that name recorded as provenance, letting a fake extraction
  // be labelled "claude" in the UI and the database.
  it("refuses a client-supplied provider and records the server's own", async () => {
    const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }))
    const shiftId = await createShift(app)
    const res = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId, rawText: "x", provider: "claude" },
    })
    expect(res.statusCode).toBe(422)

    const clean = await capture(app, shiftId, "x")
    expect(clean.rawInput.provider).toBe("fake")
  })

  // Regression — audit A-23: the body's shiftId was accepted and then ignored,
  // so a caller could believe it captured against a different shift.
  it("rejects a body shiftId that disagrees with the URL", async () => {
    const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }))
    const shiftId = await createShift(app)
    const res = await app.inject({
      method: "POST",
      url: `/api/shifts/${shiftId}/intake`,
      payload: { shiftId: "some-other-shift", rawText: "x" },
    })
    expect(res.statusCode).toBe(422)
    expect((res.json() as { error: { code: string } }).error.code).toBe("validation_error")
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
    const report = (await capture(app, shiftId, "two")).report
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
    const report = (await capture(app, shiftId, "two")).report
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

  // Regression — audit A-4: approval never looked at the pipeline's verdict, so
  // a candidate that failed policy could be promoted to a live task anyway.
  it("refuses to approve a draft the pipeline rejected", async () => {
    const { app } = setup(
      new StubProvider("ok", {
        tasks: [CANDIDATE({ title: "Too early", deadlineHint: "5:00" })],
      }),
    )
    const shiftId = await createShift(app)
    const report = (await capture(app, shiftId)).report
    expect(report.drafts[0]?.disposition).toBe("rejected")

    const approve = await app.inject({
      method: "POST",
      url: `/api/intake/${report.rawInputId}/approve`,
      payload: { decisions: [{ draftId: report.drafts[0]!.id, action: "approve" }] },
    })
    expect(approve.statusCode).toBe(422)

    const tasks = await app.inject({ method: "GET", url: `/api/shifts/${shiftId}/tasks` })
    expect(tasks.json() as Task[]).toHaveLength(0)
  })

  // Regression — audit A-7: tasks were inserted in one transaction and the
  // intake status flipped in a separate statement, so a failure between them
  // left the intake approvable again and duplicated every task on retry.
  it("rejects approval when the intake is not awaiting review, creating no duplicates", async () => {
    const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }))
    const shiftId = await createShift(app)
    const report = (await capture(app, shiftId, "one")).report
    const payload = {
      decisions: [{ draftId: (report.drafts[0] as ExtractionDraft).id, action: "approve" }],
    }

    const first = await app.inject({
      method: "POST",
      url: `/api/intake/${report.rawInputId}/approve`,
      payload,
    })
    expect(first.statusCode).toBe(200)

    const again = await app.inject({
      method: "POST",
      url: `/api/intake/${report.rawInputId}/approve`,
      payload,
    })
    expect(again.statusCode).toBe(409)

    const tasks = await app.inject({ method: "GET", url: `/api/shifts/${shiftId}/tasks` })
    expect(tasks.json() as Task[]).toHaveLength(1)
  })

  it("rejects duplicate decisions for the same draft", async () => {
    const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }))
    const shiftId = await createShift(app)
    const report = (await capture(app, shiftId, "one")).report
    const draftId = (report.drafts[0] as ExtractionDraft).id

    const res = await app.inject({
      method: "POST",
      url: `/api/intake/${report.rawInputId}/approve`,
      payload: {
        decisions: [
          { draftId, action: "approve" },
          { draftId, action: "approve" },
        ],
      },
    })
    expect(res.statusCode).toBe(422)
  })

  it("returns 404 for a missing intake", async () => {
    const { app } = setup(new StubProvider("ok"))
    await createShift(app)
    const res = await app.inject({ method: "GET", url: "/api/intake/does-not-exist" })
    expect(res.statusCode).toBe(404)
  })

  // Regression — audit A-25: capture is the only endpoint that spends provider
  // tokens and had no throttle or size cap, so an unauthenticated loop could
  // drain the account once a real key was configured.
  describe("cost controls", () => {
    it("throttles repeated captures with 429 and a retry-after header", async () => {
      const { app } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }), {
        AI_RATE_LIMIT: "2",
        AI_RATE_LIMIT_WINDOW_MS: "60000",
      })
      const shiftId = await createShift(app)
      const send = () =>
        app.inject({
          method: "POST",
          url: `/api/shifts/${shiftId}/intake`,
          payload: { shiftId, rawText: "x" },
        })

      expect((await send()).statusCode).toBe(201)
      expect((await send()).statusCode).toBe(201)
      const limited = await send()
      expect(limited.statusCode).toBe(429)
      expect((limited.json() as { error: { code: string } }).error.code).toBe("rate_limited")
      expect(limited.headers["retry-after"]).toBeDefined()
    })

    it("refuses input beyond the configured character cap before calling the provider", async () => {
      const { app, db } = setup(new StubProvider("ok", { tasks: [CANDIDATE()] }), {
        AI_MAX_INPUT_CHARS: "50",
      })
      const shiftId = await createShift(app)
      const res = await app.inject({
        method: "POST",
        url: `/api/shifts/${shiftId}/intake`,
        payload: { shiftId, rawText: "x".repeat(51) },
      })
      expect(res.statusCode).toBe(422)
      // Rejected before anything was persisted or spent.
      expect(db.select().from(rawInputs).all()).toHaveLength(0)
    })
  })
})
