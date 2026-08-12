import type { FastifyInstance } from "fastify"

import { createShift, getShift, listShifts } from "../use-cases/shift.js"
import type { Database } from "../db/index.js"
import { CreateShiftRequest, type Shift } from "@shiftpilot/contracts"

export function registerShifts(app: FastifyInstance, db: Database): void {
  app.post("/shifts", async (request): Promise<Shift> => {
    const dto = CreateShiftRequest.parse(request.body)
    return createShift(db, dto)
  })

  app.get("/shifts", async (): Promise<Shift[]> => listShifts(db))

  app.get("/shifts/:id", async (request): Promise<Shift> => {
    const { id } = request.params as { id: string }
    return getShift(db, id)
  })
}
