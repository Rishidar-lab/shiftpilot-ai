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
- `"recorded"` — captured verbatim from a real Anthropic API response by
  `scripts/capture-fixtures.ts`, then sanitized. A recorded fixture also carries
  the `model` and `promptVersion` that produced it.

Do not relabel a fixture by hand, and do not describe a synthetic fixture as
"recorded from Claude" anywhere — in docs, in commits, or in a submission. A
fixture becomes `recorded` only by being captured from an actual response.

## Capturing real fixtures

Requires credentials and spends tokens, so it never runs in CI or in `pnpm test`:

```sh
ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=<model-id> pnpm capture:fixtures
```

The capture script writes only the model's extraction payload plus the metadata
above. It does not record the API key, request headers, account identifiers, or
any other credential material. Review a captured fixture before committing it —
its `input` is whatever text was sent, so never capture with real personal data.
