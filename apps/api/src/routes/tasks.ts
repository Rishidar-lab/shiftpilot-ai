import type { FastifyInstance } from "fastify"

import {
  blockTaskById,
  createTask,
  getTaskById,
  listTasks,
  updateTaskById,
} from "../use-cases/task.js"
import type { Database } from "../db/index.js"
import {
  BlockTaskRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  type Task,
} from "@shiftpilot/contracts"

export function registerTasks(app: FastifyInstance, db: Database): void {
  app.post("/shifts/:shiftId/tasks", async (request): Promise<Task> => {
    const { shiftId } = request.params as { shiftId: string }
    const dto = CreateTaskRequest.parse(request.body)
    return createTask(db, shiftId, dto)
  })

  app.get("/shifts/:shiftId/tasks", async (request): Promise<Task[]> => {
    const { shiftId } = request.params as { shiftId: string }
    return listTasks(db, shiftId)
  })

  app.get("/tasks/:id", async (request): Promise<Task> => {
    const { id } = request.params as { id: string }
    return getTaskById(db, id)
  })

  app.patch("/tasks/:id", async (request): Promise<Task> => {
    const { id } = request.params as { id: string }
    const dto = UpdateTaskRequest.parse(request.body)
    return updateTaskById(db, id, dto)
  })

  app.post("/tasks/:id/block", async (request): Promise<Task> => {
    const { id } = request.params as { id: string }
    const dto = BlockTaskRequest.parse(request.body)
    return blockTaskById(db, id, dto)
  })
}
