import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { ClaudeProvider } from "@shiftpilot/provider"
import type { ShiftContext } from "@shiftpilot/contracts"

import { EVAL_CORPUS } from "./corpus.js"
import { parseAppConfig } from "../config.js"

/**
 * Capture real Claude responses as recorded fixtures.
 *
 * SPENDS MONEY, and is gated exactly like the evaluation runner. What it writes
 * is only the model's extraction payload plus provenance (model, prompt version,
 * timestamp) — never the API key, request headers, or account identifiers.
 *
 *   ANTHROPIC_LIVE=1 ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=<id> pnpm capture:fixtures
 *
 * A fixture written here is labelled `"source": "recorded"`, which is a factual
 * claim that an API response produced it. Nothing else may set that label.
 */

const SHIFT: ShiftContext = {
  id: "fixture-shift",
  date: "2026-08-13",
  startAt: "2026-08-13T03:30:00.000Z",
  endAt: "2026-08-13T11:30:00.000Z",
  timezone: "Asia/Kolkata",
}

/** Corpus cases worth keeping as regression fixtures. */
const CAPTURE = new Set([
  "clear-multi",
  "clear-with-deadline",
  "dependency-chain",
  "vague-request",
  "prompt-injection",
  "non-task-text",
])

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
  })

  const outDir = path.resolve(process.cwd(), "../../packages/provider/fixtures/extraction")
  mkdirSync(outDir, { recursive: true })

  for (const testCase of EVAL_CORPUS.filter((c) => CAPTURE.has(c.id))) {
    const attempt = await provider.extractTasks(testCase.input, SHIFT)
    if (!attempt.ok) {
      process.stderr.write(`skipped ${testCase.id}: ${attempt.failure.kind}\n`)
      continue
    }
    const fixture = {
      name: `recorded-${testCase.id}`,
      source: "recorded",
      note: `Captured from a real API response. Probe: ${testCase.probe}.`,
      input: testCase.input,
      output: attempt.raw,
      model: provider.meta.model,
      promptVersion: provider.meta.promptVersion,
      recordedAt: new Date().toISOString(),
    }
    const file = path.join(outDir, `${fixture.name}.json`)
    writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`)
    process.stdout.write(`recorded ${file}\n`)
  }

  process.stdout.write(
    "\nReview each captured fixture before committing: `input` is whatever text was sent.\n",
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`capture failed: ${error instanceof Error ? error.message : "unknown"}\n`)
  process.exit(1)
})
