import type { ApiErrorCode } from "@shiftpilot/contracts"

/** Canonical demo workload (docs/demo-seed-data.md) — copied verbatim. */
export const DEMO_WORKLOAD = `Restock aisle 3 by 11am - takes about 45 minutes
Submit the safety report by 3pm, 30 minutes
Check the fire exits before noon, 20 minutes
Do the stocktake in the back room - 90 minutes
Then check the fridge temperature after the stocktake, 15 minutes
Call Mrs Chen about her order - urgent
Chase the delivery that should've arrived yesterday - holding up the counter
sort out the thing from yesterday
remember to smile more
Deep clean the back room - 3 hours
Full inventory recount at end of day - 2 hours`

/** Example fillers — they only populate the composer, never the backend. */
export const COMPOSER_EXAMPLES: Record<string, string> = {
  "Plan my shift": DEMO_WORKLOAD,
  "Prioritize workload": "Do the counts first, 20 minutes\nTidy the stockroom",
  "Resolve dependencies":
    "Brief the new starter after the stocktake\nDo the stocktake in the back room",
  "Prepare handover": "Prepare the end-of-shift handover, 15 minutes",
}

/** Human-readable phrasing for provider failure codes (Phase 18). */
export function describeProviderError(code: ApiErrorCode, fallback: string): string {
  switch (code) {
    case "ai_unavailable":
      return "Free AI capacity is temporarily unavailable. Your input has been saved."
    case "rate_limited":
      return "AI capacity is busy right now. Nothing was lost."
    case "ai_invalid_response":
      return "The AI returned something unexpected. Your input is safe."
    case "ai_budget_exceeded":
      return "The AI route reached its free-tier limit. Your input has been saved."
    default:
      return fallback
  }
}
