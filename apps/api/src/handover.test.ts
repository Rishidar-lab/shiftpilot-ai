import { describe, expect, it } from "vitest"

import { HandoverResponse } from "@shiftpilot/contracts"
import type {
  ExtractionAttempt,
  HandoverAttempt,
  AiProvider,
  ProviderFailure,
} from "@shiftpilot/provider"
import { FakeAiProvider } from "@shiftpilot/provider"
import type { HandoverFacts, ShiftContext } from "@shiftpilot/contracts"
import { buildApp } from "./app.js"
import { parseAppConfig } from "./config.js"
import { openDatabase } from "./db/index.js"
import type { FastifyInstance, InjectOptions } from "fastify"

/**
 * Handover narrative: the AI trust boundary for prose.
 *
 * The property under test throughout is that the deterministic facts survive
 * every possible provider behaviour — success, outage, malformed output and
 * outright fabrication. The prose is allowed to disappear. The facts are not.
 */

/** A provider whose handover response is whatever the test dictates. */
class HandoverStub implements AiProvider {
  meta = {
    id: "stub",
    label: "stub",
    isFake: true,
    model: null,
    promptId: "p",
    promptVersion: "fake-1",
    handoverPromptId: "h",
    handoverPromptVersion: "fake-1",
  }
  constructor(private readonly result: { raw: unknown } | { failure: ProviderFailure }) {}
  async extractTasks(_input: string, _ctx: ShiftContext): Promise<ExtractionAttempt> {
    return { ok: true, raw: { tasks: [] } }
  }
  async generateHandover(_facts: HandoverFacts): Promise<HandoverAttempt> {
    if ("failure" in this.result) return { ok: false, failure: this.result.failure }
    return { ok: true, raw: this.result.raw }
  }
}

const SHIFT = {
  date: "2026-08-12",
  startAt: "2026-08-12T06:00:00.000Z",
  endAt: "2026-08-12T14:00:00.000Z",
  timezone: "UTC",
}

function json(payload: unknown): InjectOptions {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    payload: payload as string | object,
  }
}

function makeApp(provider: AiProvider): FastifyInstance {
  const config = parseAppConfig({ NODE_ENV: "test" })
  return buildApp({ config, db: openDatabase(":memory:"), provider })
}

/** A shift with one completed and one overdue task, so facts are non-trivial. */
async function seed(app: FastifyInstance): Promise<{ shiftId: string; taskIds: string[] }> {
  const shiftId = (await app.inject({ url: "/api/shifts", ...json(SHIFT) })).json().id
  const done = await app.inject({
    url: `/api/shifts/${shiftId}/tasks`,
    ...json({ title: "Cold chain check", estimatedMinutes: 20 }),
  })
  const late = await app.inject({
    url: `/api/shifts/${shiftId}/tasks`,
    ...json({ title: "Unfreeze walk-in", deadlineAt: "2026-08-12T07:00:00.000Z" }),
  })
  await app.inject({
    url: `/api/tasks/${done.json().id}`,
    method: "PATCH",
    headers: { "content-type": "application/json" },
    payload: { status: "completed" },
  })
  return { shiftId, taskIds: [done.json().id, late.json().id] }
}

const NOW = "?now=2026-08-12T08:00:00.000Z"

describe("handover narrative — success path", () => {
  it("returns validated prose alongside the deterministic facts", async () => {
    const app = makeApp(new FakeAiProvider())
    const { shiftId } = await seed(app)

    const res = await app.inject({
      url: `/api/shifts/${shiftId}/handover/narrative${NOW}`,
      method: "POST",
    })
    expect(res.statusCode).toBe(200)

    const body = HandoverResponse.parse(res.json())
    expect(body.narrative).not.toBeNull()
    expect(body.degraded).toBeNull()
    // Facts are present and computed, not echoed from the model.
    expect(body.facts.counts.total).toBe(2)
    expect(body.facts.counts.completed).toBe(1)
    expect(body.provider).toBe("fake")
  })

  it("is deterministic on the fake provider path", async () => {
    const app = makeApp(new FakeAiProvider())
    const { shiftId } = await seed(app)
    const url = `/api/shifts/${shiftId}/handover/narrative${NOW}`

    const first = await app.inject({ url, method: "POST" })
    const second = await app.inject({ url, method: "POST" })
    expect(first.json()).toEqual(second.json())
  })

  it("only references task ids that exist in the shift", async () => {
    const app = makeApp(new FakeAiProvider())
    const { shiftId, taskIds } = await seed(app)
    const res = await app.inject({
      url: `/api/shifts/${shiftId}/handover/narrative${NOW}`,
      method: "POST",
    })
    const body = HandoverResponse.parse(res.json())
    for (const item of body.narrative?.attention ?? []) {
      expect(taskIds).toContain(item.taskId)
    }
  })
})

describe("handover narrative — facts stay authoritative", () => {
  it("preserves the full facts when the provider is down", async () => {
    const app = makeApp(new HandoverStub({ failure: { kind: "network", message: "down" } }))
    const { shiftId } = await seed(app)

    const res = await app.inject({
      url: `/api/shifts/${shiftId}/handover/narrative${NOW}`,
      method: "POST",
    })
    // Degraded, not failed: an outage must not cost the worker their handover.
    expect(res.statusCode).toBe(200)
    const body = HandoverResponse.parse(res.json())
    expect(body.narrative).toBeNull()
    expect(body.degraded?.reason).toBe("provider_failure")
    expect(body.facts.counts.total).toBe(2)
    expect(body.facts.counts.completed).toBe(1)
  })

  it.each<ProviderFailure>([
    { kind: "timeout" },
    { kind: "rate_limited" },
    { kind: "quota" },
    { kind: "unauthorized" },
    { kind: "misconfigured", detail: "bad model" },
  ])("degrades rather than erroring on $kind", async (failure) => {
    const app = makeApp(new HandoverStub({ failure }))
    const { shiftId } = await seed(app)
    const res = await app.inject({
      url: `/api/shifts/${shiftId}/handover/narrative${NOW}`,
      method: "POST",
    })
    expect(res.statusCode).toBe(200)
    const body = HandoverResponse.parse(res.json())
    expect(body.degraded?.reason).toBe("provider_failure")
    expect(body.facts.counts.total).toBe(2)
  })

  it("never leaks a raw provider message about credentials", async () => {
    const app = makeApp(new HandoverStub({ failure: { kind: "unauthorized" } }))
    const { shiftId } = await seed(app)
    const res = await app.inject({
      url: `/api/shifts/${shiftId}/handover/narrative${NOW}`,
      method: "POST",
    })
    expect(JSON.stringify(res.json())).not.toMatch(/sk-ant|api[_-]?key/i)
  })
})

describe("handover narrative — model output cannot mutate facts", () => {
  it("rejects a narrative that invents a task id", async () => {
    const app = makeApp(
      new HandoverStub({
        raw: {
          headline: "All clear",
          summary: "Everything was finished.",
          attention: [{ taskId: "task-invented-by-the-model", why: "Needs review." }],
        },
      }),
    )
    const { shiftId } = await seed(app)

    const res = await app.inject({
      url: `/api/shifts/${shiftId}/handover/narrative${NOW}`,
      method: "POST",
    })
    const body = HandoverResponse.parse(res.json())
    expect(body.narrative).toBeNull()
    expect(body.degraded?.reason).toBe("unknown_task_reference")
    // The counts are untouched by the model's claim that everything was done.
    expect(body.facts.counts.completed).toBe(1)
    expect(body.facts.counts.overdue).toBe(1)
  })

  it("ignores counts the model tries to supply", async () => {
    const app = makeApp(
      new HandoverStub({
        raw: {
          headline: "Perfect shift",
          summary: "Nothing outstanding.",
          attention: [],
          counts: { total: 999, completed: 999, overdue: 0 },
        },
      }),
    )
    const { shiftId } = await seed(app)

    const res = await app.inject({
      url: `/api/shifts/${shiftId}/handover/narrative${NOW}`,
      method: "POST",
    })
    const body = HandoverResponse.parse(res.json())
    // .strict() refuses the extra field outright — there is no path by which a
    // model-supplied number reaches the response.
    expect(body.degraded?.reason).toBe("invalid_narrative")
    expect(body.facts.counts.total).toBe(2)
  })

  it.each([
    ["plain text", "The shift went well."],
    ["null", null],
    ["an array", []],
    ["a wrong shape", { summary: 42 }],
  ])("degrades cleanly on %s", async (_label, raw) => {
    const app = makeApp(new HandoverStub({ raw }))
    const { shiftId } = await seed(app)
    const res = await app.inject({
      url: `/api/shifts/${shiftId}/handover/narrative${NOW}`,
      method: "POST",
    })
    expect(res.statusCode).toBe(200)
    const body = HandoverResponse.parse(res.json())
    expect(body.narrative).toBeNull()
    expect(body.degraded?.reason).toBe("invalid_narrative")
    expect(body.facts.counts.total).toBe(2)
  })
})

describe("handover narrative — cost controls", () => {
  it("leaves the deterministic handover endpoint free of any provider call", async () => {
    // If GET /handover called the provider, every page load would spend money.
    const app = makeApp(new HandoverStub({ failure: { kind: "network", message: "down" } }))
    const { shiftId } = await seed(app)
    const res = await app.inject({ url: `/api/shifts/${shiftId}/handover${NOW}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().counts.total).toBe(2)
  })

  it("throttles narrative generation like any other spending endpoint", async () => {
    const config = parseAppConfig({ NODE_ENV: "test", AI_RATE_LIMIT: "2" })
    const app = buildApp({
      config,
      db: openDatabase(":memory:"),
      provider: new FakeAiProvider(),
    })
    const { shiftId } = await seed(app)
    const url = `/api/shifts/${shiftId}/handover/narrative${NOW}`

    expect((await app.inject({ url, method: "POST" })).statusCode).toBe(200)
    expect((await app.inject({ url, method: "POST" })).statusCode).toBe(200)
    const third = await app.inject({ url, method: "POST" })
    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe("rate_limited")
  })

  it("is not reachable by GET, so a prefetch cannot spend tokens", async () => {
    const app = makeApp(new FakeAiProvider())
    const { shiftId } = await seed(app)
    const res = await app.inject({ url: `/api/shifts/${shiftId}/handover/narrative` })
    expect(res.statusCode).toBe(404)
  })
})
