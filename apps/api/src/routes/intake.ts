import type { FastifyInstance } from "fastify"

import type { AiProvider } from "@shiftpilot/provider"
import { approveIntake, captureIntake, getIntake } from "../use-cases/intake.js"
import type { AppConfig } from "../config.js"
import type { Database } from "../db/index.js"
import type { RateLimiter } from "../rate-limit.js"
import { ValidationError } from "../use-cases/errors.js"
import { ApproveIntakeRequest, CreateIntakeRequest } from "@shiftpilot/contracts"

/**
 * Capture is the only endpoint that spends provider tokens, so it carries the
 * cost controls: a fixed-window throttle and a hard input-size cap, both
 * configurable (audit A-25). Everything else here is pure persistence.
 */
export function registerIntake(
  app: FastifyInstance,
  db: Database,
  provider: AiProvider,
  config: AppConfig,
  rateLimiter: RateLimiter,
): void {
  app.post("/shifts/:shiftId/intake", async (request, reply) => {
    rateLimiter.check(request.ip)
    const { shiftId } = request.params as { shiftId: string }
    const dto = CreateIntakeRequest.parse(request.body)
    if (dto.rawText.length > config.aiMaxInputChars) {
      throw new ValidationError(
        `rawText is ${dto.rawText.length} characters; the limit is ${config.aiMaxInputChars}`,
      )
    }
    const result = await captureIntake(db, provider, shiftId, dto, config.aiTimeoutMs)
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
