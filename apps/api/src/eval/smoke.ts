import { runExtraction } from "@shiftpilot/domain"
import type { ShiftContext } from "@shiftpilot/contracts"

import { redact, requireLiveContext } from "./live-gate.js"

/**
 * One request. The cheapest possible proof that credentials, model id, prompt,
 * response format and the validation pipeline all actually work together.
 *
 *   ANTHROPIC_LIVE=1 AI_PROVIDER=claude pnpm smoke:claude
 *
 * Run this BEFORE `pnpm eval:claude`: a wrong model id or a rejected key costs
 * one call here instead of sixteen there, and the failure message tells you
 * which of the two it was.
 */

const SHIFT: ShiftContext = {
  id: "smoke-shift",
  date: "2026-08-13",
  startAt: "2026-08-13T03:30:00.000Z",
  endAt: "2026-08-13T11:30:00.000Z",
  timezone: "Asia/Kolkata",
}

/** Deliberately tiny, and it exercises a deadline hint the domain must resolve. */
const INPUT = "Restock aisle 3 by 2pm, takes 15 minutes"

async function main(): Promise<void> {
  const { provider, config } = requireLiveContext(process.env)

  process.stdout.write("ShiftPilot Claude smoke test — ONE real API call\n\n")
  process.stdout.write(`input: ${JSON.stringify(INPUT)}\n\n`)

  const started = Date.now()
  const attempt = await provider.extractTasks(INPUT, SHIFT)
  const elapsed = Date.now() - started

  if (!attempt.ok) {
    process.stdout.write(`RESULT: FAILED (${attempt.failure.kind}) after ${elapsed}ms\n\n`)
    process.stdout.write(`${diagnose(attempt.failure.kind)}\n`)
    process.exit(1)
  }

  process.stdout.write(`request:   ok (${elapsed}ms)\n`)
  process.stdout.write(`parsed:    ok\n`)

  // Push it through the exact production pipeline, not a test double: a response
  // that the app cannot use is not a passing smoke test.
  const report = runExtraction({
    rawInputId: "smoke",
    provider: provider.meta.id,
    promptVersion: provider.meta.promptVersion,
    raw: attempt.raw,
    shift: SHIFT,
    existingTitles: [],
    inputLength: INPUT.length,
    now: new Date("2026-08-13T05:00:00.000Z"),
  })

  process.stdout.write(`candidates: ${report.drafts.length}\n`)
  for (const draft of report.drafts) {
    process.stdout.write(
      `  - [${draft.disposition}] ${JSON.stringify(draft.title)}` +
        ` hint=${JSON.stringify(draft.deadlineHint)} resolved=${draft.deadlineAt}` +
        ` est=${draft.estimatedMinutes}(${draft.estimateSource})\n`,
    )
  }

  if (report.drafts.length === 0) {
    process.stdout.write("\nRESULT: the call worked but nothing survived validation.\n")
    process.stdout.write("Check the warnings above before running the full evaluation.\n")
    process.exit(1)
  }

  process.stdout.write(`\nRESULT: OK — credentials, model "${provider.meta.model}" and the\n`)
  process.stdout.write("extraction pipeline all work end to end.\n")
  process.stdout.write(`\nNext: ANTHROPIC_LIVE=1 AI_PROVIDER=claude pnpm eval:claude\n`)
  process.stdout.write(
    `(that runs 16 cases against the same model, with a ${config.aiTimeoutMs}ms budget each)\n`,
  )
}

/** Point at the likely cause without guessing beyond what the failure says. */
function diagnose(kind: string): string {
  switch (kind) {
    case "unauthorized":
      return "The key was rejected. Check ANTHROPIC_API_KEY in apps/api/.env."
    case "misconfigured":
      return "The request was rejected — most often an ANTHROPIC_MODEL your account cannot call.\nVerify the id against Anthropic's current models documentation."
    case "quota":
      return "Billing or quota problem. Check the credit balance and limits in the Anthropic console."
    case "rate_limited":
      return "Rate limited on the very first call. Wait and retry."
    case "timeout":
      return "No response inside AI_TIMEOUT_MS. Raise it, or check the network."
    case "invalid_response":
      return "The model replied but not with usable JSON. This is a prompt/model-compatibility\nproblem rather than a credentials one — try a different ANTHROPIC_MODEL."
    default:
      return "Could not reach the provider. Check network access."
  }
}

main().catch((error: unknown) => {
  // Never echo the error object wholesale: SDK errors can carry request details.
  process.stderr.write(
    `smoke test failed: ${redact(error instanceof Error ? error.message : "unknown")}\n`,
  )
  process.exit(1)
})
