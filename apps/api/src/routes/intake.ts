import type { FastifyInstance } from "fastify"

import type { AiProvider } from "@shiftpilot/provider"
import { approveIntake, captureIntake, getIntake } from "../use-cases/intake.js"
import type { Database } from "../db/index.js"
import { ApproveIntakeRequest, CreateIntakeRequest } from "@shiftpilot/contracts"

export function registerIntake(
  app: FastifyInstance,
  db: Database,
  provider: AiProvider,
  timeoutMs: number,
): void {
  app.post("/shifts/:shiftId/intake", async (request, reply) => {
    const { shiftId } = request.params as { shiftId: string }
    const dto = CreateIntakeRequest.parse(request.body)
    const result = await captureIntake(db, provider, shiftId, dto, timeoutMs)
    reply.status(201)
    return result
  })

  app.get("/intake/:id", async (request) => {
    const { id } = request.params as { id: string }
    return getIntake(db, id)
  })

  app.post("/intake/:id/approve", async (request) => {
    const { id } = request.params as { id: string }
    const dto = ApproveIntakeRequest.parse(request.body)
    return approveIntake(db, id, dto)
  })
}
