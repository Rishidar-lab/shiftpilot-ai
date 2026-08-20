# Live evaluation evidence — safe, sanitized, reproducible

This file is the evidence pack for the Week-1 claim "real external AI is verified on the
OpenRouter free tier". Everything here is sanitized: **no key, no header, no raw
response, no .env value appears anywhere in this repository.** The credential lived in
the environment of the run machine only and has been flagged for rotation (see
`docs/week1-submission-matrix.md`, external checklist item 1).

## Where each piece of evidence lives

| Claim                                                  | Evidence                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free-only guard exists and runs before every inference | `packages/provider/src/openrouter.ts` (`assertFreeOpenRouterModel`), exercised at config parse, provider construction, and per-request                                         |
| Guard rejects every paid config                        | `packages/provider/src/openrouter.test.ts` (anthropic/_, openai/_, google/_, deepseek/_, ordinary models all rejected; `openrouter/free` and `<vendor>/<model>:free` accepted) |
| A real one-request smoke call returned HTTP 2xx        | `docs/eval/verification-summary.md` §Smoke (resolved `poolside/laguna-s-2.1:free`, pipeline ok, 1 accepted candidate)                                                          |
| Controlled 16-case corpus + handover ran 16/16         | `docs/eval/results.md` (per-case `request: ok`, attempts, candidates)                                                                                                          |
| Every response served by the configured free model     | `resolvedModel` in run reports and in each recorded fixture                                                                                                                    |
| Recorded (real) responses are in the repo              | `packages/provider/fixtures/extraction/recorded-*.json` (6 files, `"source": "recorded"`, model + resolvedModel + prompt version per file)                                     |
| No AI step can approve/activate/complete/schedule      | `docs/architecture.md` §5–6; the eval report shows candidates landing in a review queue, never in tasks                                                                        |
| Offline suite proves everything above without network  | `pnpm test` (283 tests, 21 files at this 2026-08-14 run; 341 tests, 27 files on `main` today), CI workflow needs no secrets                                                    |

## The numbers (2026-08-14, Asia/Kolkata shift, prompts v3)

- Smoke: **1 request, HTTP 2xx**, resolved `poolside/laguna-s-2.1:free` — no retries, no
  fallback.
- Eval route: `google/gemma-4-26b-a4b-it:free`, `OPENROUTER_MAX_RETRIES=2` (429-only,
  same route), `AI_TIMEOUT_MS=60000`, max output tokens 1024.
- Eval: **16/16 corpus cases succeeded, 0 failed**; handover narrative accepted with
  attention ids verified. 19 candidates produced: 14 accepted, 3 needsReview, 2 rejected.
  3 cases needed a second same-route attempt (reported `attempt 2/3`).
- Contrast runs, kept for honesty: `results-openrouter-free-alias.md` (8/16 — the live
  alias rotates across pool members that often cannot produce JSON) and
  `results-gemma-4-26b-no-retry.md` / `-attempt-2.md` / `-attempt-3.md` (shared free
  quotas → 429s; same-route backoff recovers).

## Reproduction (by the reviewer, if desired)

```sh
# env only, never printed
export OPENROUTER_API_KEY=...            # your own free-tier key
pnpm smoke:openrouter                     # one request, openrouter/free pinned
AI_PROVIDER=openrouter OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free pnpm eval:openrouter
```

Any non-free model id fails at configuration time with a typed error; there is no code
path that spends money.
