import { beforeEach, describe, expect, it } from "vitest"

import { WorkPlan, HandoverFacts, NextDecision } from "@shiftpilot/contracts"
import { buildApp } from "./app.js"
import { parseAppConfig } from "./config.js"
import { openDatabase } from "./db/index.js"
import type { FastifyInstance, InjectOptions } from "fastify"

function makeApp(): FastifyInstance {
  const config = parseAppConfig({ NODE_ENV: "test" })
  const db = openDatabase(":memory:")
  return buildApp({ config, db })
}

const SHIFT = {
  date: "2026-08-12",
  startAt: "2026-08-12T06:00:00.000Z",
  endAt: "2026-08-12T14:00:00.000Z",
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
