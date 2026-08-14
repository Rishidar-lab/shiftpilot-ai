import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { buildHandoverFacts, normalizeHandoverNarrative, runExtraction } from "@shiftpilot/domain"
import type { ExtractionReport, Shift, ShiftContext, Task } from "@shiftpilot/contracts"
import type { AiProvider } from "@shiftpilot/provider"

import { EVAL_CORPUS } from "./corpus.js"
import { redact, requireLiveContext } from "./live-gate.js"

/**
 * The complete gated real-provider evaluation. One command, start to finish.
 *
 *   ANTHROPIC_LIVE=1 AI_PROVIDER=claude pnpm eval:claude
 *   AI_PROVIDER=openrouter OPENROUTER_MODEL=openrouter/free pnpm eval:openrouter
 *
 * The Claude variant SPENDS MONEY and refuses to run without an explicit
 * opt-in. The OpenRouter variant is FREE-tier only: the free-model guard runs
 * before every request, there is no retry and no paid fallback. Run the
 * matching smoke test first — one call is a cheaper way to find a bad model id
 * than a full corpus.
 *
 * Every response is validated through the REAL production pipeline, not a test
 * double, so what this measures is whether the application can actually use the
 * model's output — the only question worth asking.
 *
 * It records what happened per case: whether the request succeeded, whether the
 * output parsed, whether the schema accepted it, and how the deterministic
 * pipeline dispositioned each candidate. It deliberately computes NO accuracy
 * score. There is no labelled ground truth here, and a percentage without one
 * would be fabricated confidence dressed up as a metric.
 */

const SHIFT: ShiftContext = {
  id: "eval-shift",
  date: "2026-08-13",
  startAt: "2026-08-13T03:30:00.000Z",
  endAt: "2026-08-13T11:30:00.000Z",
  timezone: "Asia/Kolkata",
}

const NOW = new Date("2026-08-13T05:00:00.000Z")

/** Cases worth keeping as regression fixtures if they come back clean. */
const FIXTURE_CANDIDATES = new Set([
  "clear-multi",
  "clear-with-deadline",
  "dependency-chain",
  "vague-request",
  "prompt-injection",
  "non-task-text",
])

interface CaseOutcome {
  id: string
  probe: string
  requestOk: boolean
  failureKind: string | null
  candidates: number
  accepted: number
  needsReview: number
  rejected: number
  warnings: number
}

async function main(): Promise<void> {
  const { provider, banner } = requireLiveContext(process.env)

  const outDir = path.resolve(process.cwd(), "../../docs/eval")
  const fixtureDir = path.resolve(process.cwd(), "../../packages/provider/fixtures/extraction")
  mkdirSync(outDir, { recursive: true })

  const startedAt = new Date().toISOString()
  const lines: string[] = []
  const outcomes: CaseOutcome[] = []

  const say = (text: string): void => {
    process.stdout.write(text)
    lines.push(text)
  }

  say(`# ShiftPilot — real ${provider.meta.label} evaluation\n\n`)
  say(`Run at: ${startedAt}\n\n`)
  say("```\n")
  say(`${banner}\n`)
  say(`shift timezone:  ${SHIFT.timezone}\n`)
  say("```\n\n")
  say(
    "No accuracy percentage appears in this report. The corpus has no labelled ground\n" +
      "truth, so any percentage would be invented. What is recorded below is what the\n" +
      "application actually did with each response.\n\n",
  )

  // --- Extraction -----------------------------------------------------------
  say("## Extraction\n\n")

  for (const testCase of EVAL_CORPUS) {
    say(`### ${testCase.id} — ${testCase.probe}\n\n`)
    say(`- input: \`${JSON.stringify(testCase.input)}\`\n`)
    say(`- expected: ${testCase.expectation}\n`)

    const attempt = await attemptWithRetries(
      (signal) => provider.extractTasks(testCase.input, SHIFT, signal),
      TRANSIENT_FAILURES,
    )
    if (!attempt.ok) {
      say(
        `- request: **FAILED** (${attempt.failure.kind})` +
          ` after ${attempt.attempts} attempt${attempt.attempts === 1 ? "" : "s"}\n\n`,
      )
      outcomes.push({
        id: testCase.id,
        probe: testCase.probe,
        requestOk: false,
        failureKind: attempt.failure.kind,
        candidates: 0,
        accepted: 0,
        needsReview: 0,
        rejected: 0,
        warnings: 0,
      })
      continue
    }

    say(
      `- request: ok` +
        (attempt.attempts > 1 ? ` (attempt ${attempt.attempts}/${MAX_ATTEMPTS})` : "") +
        "\n",
    )

    const report = runExtraction({
      rawInputId: testCase.id,
      provider: provider.meta.id,
      promptVersion: provider.meta.promptVersion,
      raw: attempt.raw,
      shift: SHIFT,
      existingTitles: [],
      inputLength: testCase.input.length,
      now: NOW,
    })

    const counts = tally(report)
    say(`- request: ok\n`)
    say(
      `- candidates: ${report.drafts.length} ` +
        `(accepted ${counts.accepted} · needsReview ${counts.needsReview} · rejected ${counts.rejected})\n`,
    )
    say(`- report warnings: ${report.warnings.length}\n\n`)
    for (const draft of report.drafts) {
      say(
        `  - \`[${draft.disposition}]\` ${JSON.stringify(draft.title)}` +
          ` · hint=${JSON.stringify(draft.deadlineHint)} → ${draft.deadlineAt}` +
          ` · est=${draft.estimatedMinutes}(${draft.estimateSource})` +
          ` · deps=${JSON.stringify(draft.dependsOn)}` +
          `${draft.rejectionReason ? ` · reason=${draft.rejectionReason}` : ""}\n`,
      )
      for (const reason of draft.reasons) say(`    - note: ${reason}\n`)
    }
    say("\n")

    outcomes.push({
      id: testCase.id,
      probe: testCase.probe,
      requestOk: true,
      failureKind: null,
      candidates: report.drafts.length,
      warnings: report.warnings.length,
      ...counts,
    })

    if (FIXTURE_CANDIDATES.has(testCase.id)) {
      writeFixture(fixtureDir, testCase.id, testCase.input, attempt.raw, provider)
    }
  }

  // --- Handover -------------------------------------------------------------
  say("## Handover narrative\n\n")
  const facts = buildHandoverFacts({ shift: demoShift(), tasks: demoTasks(), now: NOW })
  const handover = await attemptWithRetries(
    (signal) => provider.generateHandover(facts, signal),
    TRANSIENT_FAILURES,
  )

  if (!handover.ok) {
    say(`- request: **FAILED** (${handover.failure.kind})\n`)
    say(`- degraded mode: the deterministic facts still render\n\n`)
  } else {
    const outcome = normalizeHandoverNarrative(handover.raw, facts)
    if (!outcome.ok) {
      say(`- request: ok, but the narrative was **REJECTED** (${outcome.reason})\n`)
      say(`- detail: ${outcome.detail}\n`)
      say(`- degraded mode: the deterministic facts still render\n\n`)
    } else {
      say(`- request: ok, narrative accepted\n`)
      say(`- headline: ${JSON.stringify(outcome.narrative.headline)}\n`)
      say(`- summary: ${JSON.stringify(outcome.narrative.summary)}\n`)
      say(`- attention: ${outcome.narrative.attention.length} item(s), all ids verified\n\n`)
    }
  }

  // --- Summary --------------------------------------------------------------
  const failed = outcomes.filter((o) => !o.requestOk)
  say("## Summary\n\n")
  say(`- corpus cases: ${outcomes.length}\n`)
  say(`- requests that succeeded: ${outcomes.length - failed.length}\n`)
  say(`- requests that failed: ${failed.length}\n`)
  if (failed.length > 0) {
    for (const f of failed) say(`  - ${f.id}: ${f.failureKind}\n`)
  }
  say(
    `- total candidates produced: ${outcomes.reduce((sum, o) => sum + o.candidates, 0)}\n` +
      `- accepted: ${outcomes.reduce((s, o) => s + o.accepted, 0)}` +
      ` · needsReview: ${outcomes.reduce((s, o) => s + o.needsReview, 0)}` +
      ` · rejected: ${outcomes.reduce((s, o) => s + o.rejected, 0)}\n\n`,
  )
  say(
    "These are counts of what the pipeline did, not a quality score. Read the per-case\n" +
      "sections above against each `expected` line to judge quality.\n",
  )

  const outFile = path.join(outDir, "results.md")
  writeFileSync(outFile, redact(lines.join("")))
  process.stdout.write(`\nWrote ${outFile}\n`)
  if (failed.length > 0) process.exit(1)
}

/**
 * A corpus case may need several attempts on the free tier: shared quotas
 * throttle mid-run and free models sometimes emit an unusable body. Each
 * attempt is a fresh request on the EXACT same route — never a different
 * model, never a paid one. Transient kinds are retried; operator problems
 * (credentials, config, billing) fail immediately.
 */
const MAX_ATTEMPTS = 3

const TRANSIENT_FAILURES = new Set(["rate_limited", "invalid_response", "network", "timeout"])

async function attemptWithRetries<T extends { ok: boolean }>(
  run: (signal?: AbortSignal) => Promise<T>,
  transientKinds: Set<string>,
): Promise<T & { attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    const result = await run(undefined)
    if (result.ok || attempt >= MAX_ATTEMPTS || !transientKinds.has(getKind(result))) {
      return { ...result, attempts: attempt }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
  }
}

function getKind(result: { ok: boolean; failure?: { kind: string } }): string {
  return result.ok ? "" : result.failure!.kind
}

function tally(report: ExtractionReport) {
  return {
    accepted: report.drafts.filter((d) => d.disposition === "accepted").length,
    needsReview: report.drafts.filter((d) => d.disposition === "needsReview").length,
    rejected: report.drafts.filter((d) => d.disposition === "rejected").length,
  }
}

/**
 * Record a real response as a labelled fixture. `"source": "recorded"` is a
 * factual claim that an API response produced this file — nothing else in the
 * repository may set that label.
 *
 * The model is recorded as CONFIGURED (`provider.meta.model`), and for
 * OpenRouter the actual routed model is recorded separately ONLY when the
 * response reported it. No claim about the underlying model beyond that.
 */
function writeFixture(
  dir: string,
  id: string,
  input: string,
  output: unknown,
  provider: AiProvider,
): void {
  mkdirSync(dir, { recursive: true })
  const fixture = {
    name: `recorded-${id}`,
    source: "recorded",
    note: `Captured from a real ${provider.meta.label} API response during the live evaluation.`,
    input,
    output,
    model: provider.meta.model,
    ...("resolvedModel" in provider && provider.resolvedModel !== null
      ? { resolvedModel: provider.resolvedModel }
      : {}),
    promptVersion: provider.meta.promptVersion,
    recordedAt: new Date().toISOString(),
  }
  const file = path.join(dir, `${fixture.name}.json`)
  writeFileSync(file, redact(`${JSON.stringify(fixture, null, 2)}\n`))
}

/** A small fixed shift so the handover section has something to describe. */
function demoShift(): Shift {
  return {
    id: "eval-shift",
    date: "2026-08-13",
    startAt: SHIFT.startAt,
    endAt: SHIFT.endAt,
    timezone: SHIFT.timezone,
    role: null,
    createdAt: SHIFT.startAt,
  }
}

function demoTasks(): Task[] {
  const base = {
    shiftId: "eval-shift",
    category: "other" as const,
    estimatedMinutes: 20,
    deadlineSource: "manual" as const,
    explicitUrgency: "none" as const,
    dependsOn: [],
    blockReason: null,
    notes: null,
    createdAt: SHIFT.startAt,
    updatedAt: SHIFT.startAt,
  }
  return [
    {
      ...base,
      id: "eval-done",
      title: "Cold chain check",
      status: "completed",
      deadlineAt: null,
      completedAt: "2026-08-13T04:30:00.000Z",
    },
    {
      ...base,
      id: "eval-late",
      title: "Unfreeze the walk-in",
      status: "active",
      deadlineAt: "2026-08-13T04:00:00.000Z",
      completedAt: null,
    },
  ]
}

main().catch((error: unknown) => {
  // Never echo the error object wholesale: SDK errors can carry request details.
  process.stderr.write(
    `evaluation failed: ${redact(error instanceof Error ? error.message : "unknown")}\n`,
  )
  process.exit(1)
})
