import cors from "@fastify/cors"
import Fastify from "fastify"
import type { FastifyInstance } from "fastify"
import { ZodError } from "zod"

import type { AppConfig } from "./config.js"
import type { Database } from "./db/index.js"
import { ConflictError, NotFoundError, StateMachineError } from "./use-cases/errors.js"
import { registerHealth } from "./routes/health.js"
import { registerPlan } from "./routes/plan.js"
import { registerShifts } from "./routes/shifts.js"
import { registerTasks } from "./routes/tasks.js"

export interface AppDeps {
  config: AppConfig
  db: Database
}

export function buildApp({ config, db }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: config.nodeEnv !== "test" })

  void app.register(cors, { origin: config.corsOrigin })

  // Product routes live under /api (the web client defaults to baseUrl "/api",
  // and any reverse proxy can forward /api/* to this server unchanged).
  void app.register(
    async (scoped) => {
      registerHealth(scoped, config)
      registerShifts(scoped, db)
      registerTasks(scoped, db)
      registerPlan(scoped, db)
    },
    { prefix: "/api" },
  )

  // Bare /health for infrastructure probes; not part of the API surface.
  registerHealth(app, config)

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: "not_found", message: "route not found" } })
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(422).send({
        error: {
          code: "validation_error",
          message: "request validation failed",
          details: error.issues,
        },
      })
      return
    }
    if (error instanceof NotFoundError) {
      reply.status(404).send({ error: { code: "not_found", message: error.message } })
      return
    }
    if (error instanceof StateMachineError) {
      reply.status(422).send({ error: { code: "validation_error", message: error.message } })
      return
    }
    if (error instanceof ConflictError) {
      reply.status(409).send({ error: { code: "conflict", message: error.message } })
      return
    }
    request.log.error(error)
    reply.status(500).send({ error: { code: "internal", message: "internal server error" } })
  })

  return app
}
