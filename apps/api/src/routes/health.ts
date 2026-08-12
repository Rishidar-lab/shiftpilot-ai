import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import type { HealthResponse } from "@shiftpilot/contracts"

const API_VERSION = "0.1.0"

export function registerHealth(app: FastifyInstance, config: AppConfig): void {
  app.get("/health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      version: API_VERSION,
      provider: config.aiProvider,
      time: new Date().toISOString(),
    }
  })
}
