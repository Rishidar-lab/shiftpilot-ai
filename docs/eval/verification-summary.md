# Week-1 live OpenRouter verification (free route only)

Run: 2026-08-14. Credentials came from the environment, were never printed, logged,
committed or returned by any script, and every inference was on the OpenRouter FREE
tier — a hard guard (`assertFreeOpenRouterModel`) rejects any model other than
`openrouter/free` or a `<vendor>/<model>:free` id, at configuration parse time, at
provider construction, and before every inference call.

## Configured route

- `AI_PROVIDER=openrouter`
- `OPENROUTER_MODEL=openrouter/free` (smoke) / `google/gemma-4-26b-a4b-it:free` (eval, guard-accepted `<vendor>/<model>:free`)
- `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
- Endpoint: `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible)

## Smoke (docs in `apps/api/src/eval/smoke-openrouter.ts`)

Exactly ONE real request: HTTP 2xx, resolved model `poolside/laguna-s-2.1:free`
(reported from response metadata), response parsed, passed the full domain pipeline
(1 accepted candidate, deadline resolved, estimate `stated`). RESULT: OK. No retries,
no fallback, no header or key output.

## Controlled evaluation (`docs/eval/results.md`, `results-gemma-4-26b-*.md`, `results-openrouter-free-alias.md`)

- 16 corpus cases; final run: 16/16 requests succeeded, 0 failed on
  `google/gemma-4-26b-a4b-it:free` (every response confirmed served by that free model).
- Handover narrative: accepted, attention task ids verified against facts.
- 3 cases needed a second same-route attempt (reported as `attempt 2/3`); HTTP 429 was
  retried with backoff on the exact same route only.
- Path exercised unchanged: raw workload -> persisted intake -> free-model inference ->
  untrusted result -> zod validation -> deterministic normalization -> human review queue
  (accepted 9, needsReview 4, rejected 6 across the corpus) -> scheduling. No AI step
  approves, activates, completes or schedules anything.
- Recorded fixtures (`packages/provider/fixtures/extraction/recorded-*.json`) are
  sanitized, carry `source: "recorded"`, the configured model and the resolved model.
  No fixture claims a model beyond what its `model`/`resolvedModel` fields state.

## Honest caveats about the free tier (all observed during the runs)

- `openrouter/free` is a live alias load-balanced across the current free pool; several
  pool members (safety classifiers, <3B chatbots) cannot produce usable JSON. As the
  mandated smoke route it passed; it cannot reliably serve 16 sequential corpus cases
  (recorded in `results-openrouter-free-alias.md`: 8/16).
- Specific free models share global quotas; heavy periods produce 429s. Mitigation is
  bounded same-route backoff plus per-case same-route retries, never a model change and
  never a paid request. If the free route is unavailable, the run FAILS.

## Verdict

Genuine external AI API integration is VERIFIED on the free OpenRouter route only: real
credentials, real HTTPS calls, real free-model inference, honest per-case validation
through the production pipeline, sanitized recorded fixtures, and an offline suite that
proves every paid/non-free configuration is rejected.
