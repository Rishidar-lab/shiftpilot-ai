import { runExtraction } from "@shiftpilot/domain"
import type { ShiftContext } from "@shiftpilot/contracts"

import { redact, requireOpenRouterSmokeContext } from "./live-gate.js"

/**
 * One request on the FREE OpenRouter route. The cheapest possible proof that
 * credentials, model id, prompt, response format and the validation pipeline
 * all actually work together — without spending anything and without any
 * possibility of a paid fallback.
 *
 *   AI_PROVIDER=openrouter OPENROUTER_API_KEY=… pnpm smoke:openrouter
 *
 * The model is pinned to `openrouter/free` and the free-model guard runs before
 * the request. No retries: if the free route is unavailable or rate-limited,
 * the run fails. Never retries into a paid model, because no paid model can
 * ever be configured here.
 *
 * Run this BEFORE `pnpm eval:openrouter`: a wrong model id or a rejected key
 * costs one free call here instead of sixteen there.
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
  const { provider, config, banner } = requireOpenRouterSmokeContext(process.env)

  process.stdout.write("ShiftPilot OpenRouter FREE-route smoke test — ONE real API call\n\n")
  process.stdout.write(`input: ${JSON.stringify(INPUT)}\n\n`)
  process.stdout.write("```\n")
  process.stdout.write(`${banner}\n`)
  process.stdout.write("```\n\n")

  const started = Date.now()
  const attempt = await provider.extractTasks(INPUT, SHIFT)
  const elapsed = Date.now() - started

  process.stdout.write(`http:         ${attempt.ok ? "success (2xx)" : "FAILED"}\n`)
  process.stdout.write(`configured model: openrouter/free (free tier, guard enforced)\n`)
  process.stdout.write(
    `resolved model:  ${provider.resolvedModel ?? "(not reported by OpenRouter)"}\n`,
  )

  if (!attempt.ok) {
    process.stdout.write(`\nRESULT: FAILED (${attempt.failure.kind}) after ${elapsed}ms\n\n`)
    process.stdout.write(`${diagnose(attempt.failure)}\n`)
    process.exit(1)
  }

  process.stdout.write(`elapsed:      ${elapsed}ms\n`)
  process.stdout.write(`parsed:       ok\n`)

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

  process.stdout.write(`validation:   ok — ${report.drafts.length} candidate(s) survived\n`)
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

  process.stdout.write(`\nRESULT: OK — free route "${provider.meta.model}" and the extraction\n`)
  process.stdout.write("pipeline work end to end. No paid request was or can be made.\n")
  process.stdout.write(
    `\nNext: AI_PROVIDER=openrouter OPENROUTER_MODEL=openrouter/free pnpm eval:openrouter\n`,
  )
  process.stdout.write(
    `(that runs the corpus against the free route, with a ${config.aiTimeoutMs}ms budget each)\n`,
  )
}

/** Point at the likely cause without guessing beyond what the failure says. */
function diagnose(failure: { kind: string; detail?: string; message?: string }): string {
  switch (failure.kind) {
    case "unauthorized":
      return "The key was rejected. Check OPENROUTER_API_KEY in apps/api/.env."
    case "misconfigured":
      return "The request was rejected — most often an OPENROUTER_MODEL the free route cannot serve.\nVerify the id and that the base URL is https://openrouter.ai/api/v1."
    case "quota":
      return "Billing or quota problem on the OpenRouter account."
    case "rate_limited":
      return "Free route rate-limited. Wait and retry — the run does NOT fall back to a paid model."
    case "timeout":
      return "No response inside AI_TIMEOUT_MS. Raise it, or check the network."
    case "invalid_response":
      return "The model replied but not with usable JSON. This is a prompt/model-compatibility\nproblem rather than a credentials one."
    case "network":
      return `Could not reach the provider: ${failure.message ?? "check network access"}.`
    default:
      return "Could not reach the provider. Check network access."
  }
}

main().catch((error: unknown) => {
  // Never echo the error object wholesale: provider errors can carry request details.
  process.stderr.write(
    `smoke test failed: ${redact(error instanceof Error ? error.message : "unknown")}\n`,
  )
  process.exit(1)
})
