import { beforeEach, describe, expect, it } from "vitest"

import { WorkPlan, HandoverFacts, NextDecision } from "@shiftpilot/contracts"
import { buildApp } from "./app.js"
import { parseAppConfig } from "./config.js"
import { openDatabase } from "./db/index.js"
import { makeProvider } from "./ai.js"
import type { FastifyInstance, InjectOptions } from "fastify"

function makeApp(): FastifyInstance {
  const config = parseAppConfig({ NODE_ENV: "test" })
  const db = openDatabase(":memory:")
  return buildApp({ config, db, provider: makeProvider(config) })
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

describe("shifts API", () => {
  let app: FastifyInstance
  beforeEach(() => {
    app = makeApp()
  })

  it("creates and reads a shift", async () => {
    const created = await app.inject({ url: "/api/shifts", ...json(SHIFT) })
    expect(created.statusCode).toBe(200)
    const shift = created.json()
    expect(shift.id).toMatch(/[0-9a-f-]{36}/)
    expect(shift.createdAt).toBeDefined()

    const fetched = await app.inject({ url: `/api/shifts/${shift.id}` })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.json().id).toBe(shift.id)
  })

  it("rejects an invalid shift body with validation_error", async () => {
    const res = await app.inject({ url: "/api/shifts", ...json({ date: "2026-08-12" }) })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns not_found for a missing shift", async () => {
    const res = await app.inject({ url: "/api/shifts/does-not-exist" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })
})

describe("tasks + planning API", () => {
  let app: FastifyInstance
  let shiftId: string
  beforeEach(async () => {
    app = makeApp()
    const created = await app.inject({ url: "/api/shifts", ...json(SHIFT) })
    shiftId = created.json().id
  })

  async function createTask(payload: unknown) {
    return app.inject({ url: `/api/shifts/${shiftId}/tasks`, ...json(payload) })
  }

  it("creates a task under a shift and plans it", async () => {
    const task = await createTask({ title: "Stock aisle 3", category: "safety" })
    expect(task.statusCode).toBe(200)
    expect(task.json().id).toBeDefined()

    const plan = await app.inject({
      url: `/api/shifts/${shiftId}/plan?now=2026-08-12T08:00:00.000Z`,
    })
    expect(plan.statusCode).toBe(200)
    expect(WorkPlan.safeParse(plan.json()).success).toBe(true)
    expect(plan.json().sequence).toHaveLength(1)
  })

  it("returns not_found creating a task for a missing shift", async () => {
    const res = await app.inject({
      url: "/api/shifts/nope/tasks",
      ...json({ title: "x" }),
    })
    expect(res.statusCode).toBe(404)
  })

  it("allows completing an active task", async () => {
    const task = await createTask({ title: "A" })
    const id = task.json().id

    const completed = await app.inject({
      url: `/api/tasks/${id}`,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      payload: { status: "completed" },
    })
    expect(completed.statusCode).toBe(200)
    expect(completed.json().completedAt).toBeDefined()
  })

  it("rejects an illegal state transition (active → draft)", async () => {
    const task = await createTask({ title: "A" })
    const id = task.json().id
    const illegal = await app.inject({
      url: `/api/tasks/${id}`,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      payload: { status: "draft" },
    })
    expect(illegal.statusCode).toBe(422)
    expect(illegal.json().error.code).toBe("validation_error")
  })

  it("blocks a task with a required reason", async () => {
    const task = await createTask({ title: "A" })
    const id = task.json().id
    const blocked = await app.inject({
      url: `/api/tasks/${id}/block`,
      method: "POST",
      headers: { "content-type": "application/json" },
      payload: { reason: "awaiting parts" },
    })
    expect(blocked.statusCode).toBe(200)
    expect(blocked.json().status).toBe("blocked")
    expect(blocked.json().blockReason).toBe("awaiting parts")
  })

  // Regression — audit A-10: completedAt was recomputed on every update, so
  // editing a finished task moved its completion time to "now" and corrupted
  // the handover record of when work actually finished.
  it("stamps completedAt once and preserves it across later edits", async () => {
    const task = await createTask({ title: "A" })
    const id = task.json().id

    const completed = await app.inject({
      url: `/api/tasks/${id}`,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      payload: { status: "completed" },
    })
    const stampedAt = completed.json().completedAt as string
    expect(stampedAt).toBeDefined()

    await new Promise((resolve) => setTimeout(resolve, 5))
    const renamed = await app.inject({
      url: `/api/tasks/${id}`,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      payload: { title: "A renamed" },
    })
    expect(renamed.json().completedAt).toBe(stampedAt)
    expect(renamed.json().updatedAt).not.toBe(stampedAt)
  })

  it("clears completedAt when a completed task is reopened", async () => {
    const task = await createTask({ title: "A" })
    const id = task.json().id
    await app.inject({
      url: `/api/tasks/${id}`,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      payload: { status: "completed" },
    })
    const reopened = await app.inject({
      url: `/api/tasks/${id}`,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      payload: { status: "active" },
    })
    expect(reopened.json().completedAt).toBeNull()
  })

  // Regression — audit A-27: the reason a task was blocked survived unblocking,
  // so stale text reappeared the next time it was blocked.
  it("clears blockReason when a task is unblocked", async () => {
    const task = await createTask({ title: "A" })
    const id = task.json().id
    await app.inject({
      url: `/api/tasks/${id}/block`,
      method: "POST",
      headers: { "content-type": "application/json" },
      payload: { reason: "awaiting parts" },
    })
    const unblocked = await app.inject({
      url: `/api/tasks/${id}`,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      payload: { status: "active" },
    })
    expect(unblocked.json().status).toBe("active")
    expect(unblocked.json().blockReason).toBeNull()
  })

  describe("dependency integrity", () => {
    // Regression — audit A-5: unknown ids were accepted, after which /plan
    // called the task "ready" while /next reported "blocked" by nothing.
    it("rejects a dependency on a task that does not exist", async () => {
      const task = await createTask({ title: "Solo" })
      const res = await app.inject({
        url: `/api/tasks/${task.json().id}`,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        payload: { dependsOn: ["ghost-task-id"] },
      })
      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe("validation_error")
    })

    // Regression — audit A-6: a self-edge violated the SQLite CHECK constraint
    // and surfaced as a raw 500 internal error.
    it("rejects a self-dependency with a typed validation error", async () => {
      const task = await createTask({ title: "Solo" })
      const id = task.json().id
      const res = await app.inject({
        url: `/api/tasks/${id}`,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        payload: { dependsOn: [id] },
      })
      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe("validation_error")
    })

    it("rejects a dependency on a task in another shift", async () => {
      const other = await app.inject({ url: "/api/shifts", ...json(SHIFT) })
      const foreign = await app.inject({
        url: `/api/shifts/${other.json().id}/tasks`,
        ...json({ title: "Foreign" }),
      })
      const task = await createTask({ title: "Local" })
      const res = await app.inject({
        url: `/api/tasks/${task.json().id}`,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        payload: { dependsOn: [foreign.json().id] },
      })
      expect(res.statusCode).toBe(422)
    })

    it("accepts a valid dependency and keeps plan and next consistent", async () => {
      const first = await createTask({ title: "First" })
      const second = await createTask({ title: "Second" })
      const res = await app.inject({
        url: `/api/tasks/${second.json().id}`,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        payload: { dependsOn: [first.json().id] },
      })
      expect(res.statusCode).toBe(200)

      const next = await app.inject({
        url: `/api/shifts/${shiftId}/next?now=2026-08-12T08:00:00.000Z`,
      })
      expect(next.json().kind).toBe("task")
      expect(next.json().taskId).toBe(first.json().id)
    })
  })

  // Regression — audit A-12: every scheduled entry reported position 0.
  it("numbers the plan sequence by position", async () => {
    await createTask({ title: "A" })
    await createTask({ title: "B" })
    await createTask({ title: "C" })
    const plan = await app.inject({
      url: `/api/shifts/${shiftId}/plan?now=2026-08-12T08:00:00.000Z`,
    })
    expect(plan.json().sequence.map((s: { position: number }) => s.position)).toEqual([0, 1, 2])
  })

  // Regression — audit A-14: an unparseable ?now= was silently replaced with
  // the server clock, so a caller could not tell its request was ignored.
  it("rejects an unparseable ?now= instead of silently using the server clock", async () => {
    const res = await app.inject({ url: `/api/shifts/${shiftId}/plan?now=banana` })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("validation_error")
  })

  // Regression — audit A-13: the web client called this route and always got 404.
  it("lists the tasks of a shift", async () => {
    await createTask({ title: "A" })
    await createTask({ title: "B" })
    const res = await app.inject({ url: `/api/shifts/${shiftId}/tasks` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)

    const missing = await app.inject({ url: "/api/shifts/nope/tasks" })
    expect(missing.statusCode).toBe(404)
  })

  it("returns next + handover projections derived from current state", async () => {
    await createTask({ title: "High", explicitUrgency: "high" })
    await createTask({ title: "Low" })

    const next = await app.inject({
      url: `/api/shifts/${shiftId}/next?now=2026-08-12T08:00:00.000Z`,
    })
    expect(next.statusCode).toBe(200)
    expect(NextDecision.safeParse(next.json()).success).toBe(true)
    expect(next.json().kind).toBe("task")
    expect(next.json().taskId).toBeDefined()

    const handover = await app.inject({
      url: `/api/shifts/${shiftId}/handover?now=2026-08-12T08:00:00.000Z`,
    })
    expect(handover.statusCode).toBe(200)
    expect(HandoverFacts.safeParse(handover.json()).success).toBe(true)
    expect(handover.json().counts.total).toBe(2)
  })
})
