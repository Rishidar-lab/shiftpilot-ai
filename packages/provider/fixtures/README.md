# Extraction fixtures

Provider-shaped extraction payloads used by the offline test suite so the
validation pipeline, the trust boundary and the review workflow can be exercised
without a paid API call.

## Labelling is load-bearing

Every fixture declares its own provenance in a `source` field, and that field is
the truth:

- `"synthetic"` — **hand-written** to match the documented output contract. It is
  what a compliant model _should_ return, not what one _did_. Nothing about a
  synthetic fixture is evidence that a real call was ever made.
- `"recorded"` — captured verbatim from a real API response during a live
  `pnpm eval:claude` or `pnpm eval:openrouter` run, then sanitized. A recorded fixture
  also carries the `model` and `promptVersion` that produced it, and, for OpenRouter
  responses that report it, the `resolvedModel` actually served.

Do not relabel a fixture by hand, and do not describe a synthetic fixture as
"recorded from Claude" anywhere — in docs, in commits, or in a submission. A
fixture becomes `recorded` only by being captured from an actual response.

## Capturing real fixtures

Recording happens inside `pnpm eval:claude` / `pnpm eval:openrouter`
(`apps/api/src/eval/run-eval.ts`): the corpus cases named in `FIXTURE_CANDIDATES` whose
requests succeed are written here as `"source": "recorded"` files. It requires
credentials, so it never runs in CI or in `pnpm test`:

```sh
ANTHROPIC_LIVE=1 AI_PROVIDER=claude \
ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=<model-id> pnpm eval:claude

AI_PROVIDER=openrouter OPENROUTER_API_KEY=... \
OPENROUTER_MODEL=<free-model>:free pnpm eval:openrouter
```

The OpenRouter route is free-tier only by a hard guard, and the recorded fixtures in this
directory are from `google/gemma-4-26b-a4b-it:free` (a free model; never claim more than
the `model`/`resolvedModel` fields state). The recorder writes only the model's extraction
payload plus the metadata above, through the same redaction as the eval report — no API
key, request headers, or account identifiers. Review a recorded fixture before committing
it: its `input` is the corpus text that was sent and its `output` is untrusted model
output, so confirm neither contains personal data.
