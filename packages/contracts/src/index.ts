import { z } from "zod"

/**
 * Single source of truth for data shapes shared across packages.
 * M0: the shapes the scaffold needs (health, error envelope, provider inputs).
 * M1+: task/shift/plan contracts land here via the same module.
 */

export const HealthResponse = z
  .object({
    status: z.literal("ok"),
    version: z.string(),
    provider: z.string(),
    time: z.string(),
  })
  .strict()
export type HealthResponse = z.infer<typeof HealthResponse>

export const ApiErrorCode = z.enum([
  "validation_error",
  "not_found",
  "conflict",
  "ai_unavailable",
  "ai_invalid_response",
  "ai_budget_exceeded",
  "internal",
])
export type ApiErrorCode = z.infer<typeof ApiErrorCode>

export const ApiErrorEnvelope = z
  .object({
    error: z.object({
      code: ApiErrorCode,
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .strict()
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>

/** Context a shift provides for resolving hints ("before close" -> endMin). */
export const ShiftContext = z
  .object({
    date: z.string(),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(0).max(1439),
  })
  .strict()
export type ShiftContext = z.infer<typeof ShiftContext>

/** Minimal facts handed to the provider for handover prose drafting (D-07 extends). */
export const HandoverFacts = z
  .object({
    completedTitles: z.array(z.string()),
    pendingTitles: z.array(z.string()),
    blockedTitles: z.array(z.string()),
  })
  .strict()
export type HandoverFacts = z.infer<typeof HandoverFacts>
