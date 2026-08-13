import { runExtraction } from "@shiftpilot/domain"
import { ClaudeProvider } from "@shiftpilot/provider"
import type { ShiftContext } from "@shiftpilot/contracts"

import { EVAL_CORPUS } from "./corpus.js"
import { parseAppConfig } from "../config.js"

/**
 * Real-Claude evaluation runner.
 *
 * SPENDS MONEY. It is a standalone entrypoint, never imported by the test suite,
 * and it refuses to run without an explicit opt-in flag on top of credentials —
 * so no amount of `pnpm test`, CI, or accidental import can trigger a paid call.
 *
 *   ANTHROPIC_LIVE=1 ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=<id> pnpm eval:claude
 *
 * It records what actually happened per case: whether the request succeeded,
 * whether the output parsed, whether the schema accepted it, and how the
 * deterministic pipeline dispositioned each candidate. It deliberately computes
 * NO accuracy score — there is no labelled ground truth here, and a number
 * without one would be fabricated confidence.
 */

const SHIFT: ShiftContext = {
  id: "eval-shift",
  date: "2026-08-13",
  startAt: "2026-08-13T03:30:00.000Z",
  endAt: "2026-08-13T11:30:00.000Z",
  timezone: "Asia/Kolkata",
}

async function main(): Promise<void> {
  if (process.env.ANTHROPIC_LIVE !== "1") {
    process.stderr.write(
      "Refusing to run: this makes PAID Claude calls.\n" +
        "Set ANTHROPIC_LIVE=1 (plus ANTHROPIC_API_KEY and ANTHROPIC_MODEL) to opt in.\n",
    )
    process.exit(2)
  }

  const config = parseAppConfig({ ...process.env, AI_PROVIDER: "claude" })
  if (config.anthropic === null) throw new Error("unreachable: claude config missing")

  const provider = new ClaudeProvider({
    apiKey: config.anthropic.apiKey,
    model: config.anthropic.model,
    maxOutputTokens: config.anthropic.maxOutputTokens,
    maxRetries: config.anthropic.maxRetries,
    timeoutMs: config.aiTimeoutMs,
    ...(config.anthropic.effort ? { effort: config.anthropic.effort } : {}),
  })

  // Never print the key; the model id is safe and is the useful fact.
  process.stdout.write(`# ShiftPilot extraction evaluation\n\n`)
  process.stdout.write(`model: ${provider.meta.model}\n`)
  process.stdout.write(`prompt: ${provider.meta.promptId} ${provider.meta.promptVersion}\n`)
  process.stdout.write(`shift timezone: ${SHIFT.timezone}\n`)
  process.stdout.write(`run at: ${new Date().toISOString()}\n\n`)

  for (const testCase of EVAL_CORPUS) {
    process.stdout.write(`## ${testCase.id} — ${testCase.probe}\n`)
    process.stdout.write(`input: ${JSON.stringify(testCase.input)}\n`)
    process.stdout.write(`expected: ${testCase.expectation}\n`)

    const attempt = await provider.extractTasks(testCase.input, SHIFT)
    if (!attempt.ok) {
      process.stdout.write(`request: FAILED (${attempt.failure.kind})\n`)
      process.stdout.write(`parsed: n/a\nschema: n/a\n\n`)
      continue
    }
    process.stdout.write(`request: ok\n`)

    const report = runExtraction({
      rawInputId: testCase.id,
      provider: provider.meta.id,
      promptVersion: provider.meta.promptVersion,
      raw: attempt.raw,
      shift: SHIFT,
      existingTitles: [],
      inputLength: testCase.input.length,
      now: new Date("2026-08-13T05:00:00.000Z"),
    })

    const accepted = report.drafts.filter((d) => d.disposition === "accepted")
    const review = report.drafts.filter((d) => d.disposition === "needsReview")
    const rejected = report.drafts.filter((d) => d.disposition === "rejected")

    process.stdout.write(`candidates: ${report.drafts.length}\n`)
    process.stdout.write(
      `accepted: ${accepted.length} · needsReview: ${review.length} · rejected: ${rejected.length}\n`,
    )
    process.stdout.write(`warnings: ${report.warnings.length}\n`)
    for (const draft of report.drafts) {
      process.stdout.write(
        `  - [${draft.disposition}] ${JSON.stringify(draft.title)}` +
          ` hint=${JSON.stringify(draft.deadlineHint)} at=${draft.deadlineAt}` +
          ` est=${draft.estimatedMinutes}(${draft.estimateSource})` +
          ` deps=${JSON.stringify(draft.dependsOn)}` +
          `${draft.rejectionReason ? ` reason=${draft.rejectionReason}` : ""}\n`,
      )
      for (const reason of draft.reasons) process.stdout.write(`      note: ${reason}\n`)
    }
    process.stdout.write("\n")
  }
}

main().catch((error: unknown) => {
  // Never echo the error object wholesale: SDK errors can carry request details.
  process.stderr.write(`evaluation failed: ${error instanceof Error ? error.message : "unknown"}\n`)
  process.exit(1)
})
