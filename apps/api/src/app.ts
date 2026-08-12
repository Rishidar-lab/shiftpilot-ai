import cors from "@fastify/cors"
import Fastify from "fastify"
import type { FastifyInstance } from "fastify"

import type { AppConfig } from "./config.js"
import { registerHealth } from "./routes/health.js"

export interface AppDeps {
  config: AppConfig
}

export function buildApp({ config }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: config.nodeEnv !== "test" })

  void app.register(cors, { origin: config.corsOrigin })

  // Product routes live under /api (the web client defaults to baseUrl "/api",
  // and any reverse proxy can forward /api/* to this server unchanged).
  void app.register(
    async (scoped) => {
      registerHealth(scoped, config)
    },
    { prefix: "/api" },
  )

  // Bare /health for infrastructure probes; not part of the API surface.
  registerHealth(app, config)

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: "not_found", message: "route not found" } })
  })

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error)
    reply.status(500).send({ error: { code: "internal", message: "internal server error" } })
  })

  return app
}