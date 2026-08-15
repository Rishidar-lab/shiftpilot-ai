import cors from "@fastify/cors"
import fastifyStatic from "@fastify/static"
import Fastify from "fastify"
import type { FastifyInstance } from "fastify"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { ZodError } from "zod"

import type { AppConfig } from "./config.js"
import type { Database } from "./db/index.js"
import type { AiProvider } from "@shiftpilot/provider"
import {
  ConflictError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  StateMachineError,
  ValidationError,
} from "./use-cases/errors.js"
import { createRateLimiter } from "./rate-limit.js"
import { registerHealth } from "./routes/health.js"
import { registerPlan } from "./routes/plan.js"
import { registerShifts } from "./routes/shifts.js"
import { registerTasks } from "./routes/tasks.js"
import { registerIntake } from "./routes/intake.js"

export interface AppDeps {
  config: AppConfig
  db: Database
  provider: AiProvider
}

export function buildApp({ config, db, provider }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: config.nodeEnv !== "test",
    // A whole intake is capped at aiMaxInputChars; 256 KB leaves ample room for
    // JSON overhead while refusing anything pathological outright.
    bodyLimit: 256 * 1024,
  })

  void app.register(cors, { origin: config.corsOrigin })

  const aiRateLimiter = createRateLimiter({
    limit: config.aiRateLimit,
    windowMs: config.aiRateLimitWindowMs,
  })

  // Product routes live under /api (the web client defaults to baseUrl "/api",
  // and any reverse proxy can forward /api/* to this server unchanged).
  void app.register(
    async (scoped) => {
      registerHealth(scoped, provider)
      registerShifts(scoped, db)
      registerTasks(scoped, db)
      registerPlan(scoped, db, provider, config, aiRateLimiter)
      registerIntake(scoped, db, provider, config, aiRateLimiter)
    },
    { prefix: "/api" },
  )

  // Bare /health for infrastructure probes; not part of the API surface.
  registerHealth(app, provider)

  // Single-service production mode: this process also serves the built browser
  // app, so the client's relative "/api" base resolves on its own origin and no
  // second long-lived process or reverse proxy is needed. Unset in development,
  // where Vite serves the app and proxies /api here.
  const webRoot = config.webRoot === null ? null : resolve(config.webRoot)
  if (webRoot !== null) {
    // Fail at boot rather than serving 404s for every page: a WEB_ROOT pointing
    // at nothing is a deployment mistake, and it should look like one.
    if (!existsSync(join(webRoot, "index.html"))) {
      throw new Error(
        `WEB_ROOT is set to "${webRoot}" but that directory has no index.html. ` +
          "Point it at the built web app (apps/web/dist, produced by `pnpm build`), " +
          "or unset WEB_ROOT to run the API without serving the browser app.",
      )
    }
    void app.register(fastifyStatic, { root: webRoot, wildcard: false })
  }

  app.setNotFoundHandler((request, reply) => {
    // SPA fallback: client-side routes must resolve to the app shell. Only ever
    // for GET/HEAD, and never for /api — an unknown API route is a JSON 404, not
    // a page, or a mistyped endpoint would return HTML with a 200.
    const isApi = request.url === "/api" || request.url.startsWith("/api/")
    const isPageRequest = request.method === "GET" || request.method === "HEAD"
    if (webRoot !== null && isPageRequest && !isApi) {
      void reply.type("text/html").sendFile("index.html")
      return
    }
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
    if (error instanceof ValidationError) {
      reply.status(422).send({
        error: { code: "validation_error", message: error.message, details: error.details },
      })
      return
    }
    if (error instanceof RateLimitError) {
      reply
        .status(429)
        .header("retry-after", String(error.retryAfterSeconds))
        .send({ error: { code: "rate_limited", message: error.message } })
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
    if (error instanceof ProviderError) {
      const status =
        error.code === "ai_unavailable" ? 503 : error.code === "ai_invalid_response" ? 502 : 402
      reply.status(status).send({ error: { code: error.code, message: error.message } })
      return
    }
    request.log.error(error)
    reply.status(500).send({ error: { code: "internal", message: "internal server error" } })
  })

  return app
}
