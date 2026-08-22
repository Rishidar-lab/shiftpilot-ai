# Evaluation

Detailed evaluation records live in `docs/eval/`; this is the entry point,
mirroring SourceLens's `docs/EVALUATION.md` for a common structure across
both projects. No new evaluation was run for this document — it summarizes
and points to the existing, dated records rather than re-deriving them.

## What was evaluated, and why no accuracy percentage exists

ShiftPilot's AI-facing surface is task extraction from messy natural-language
shift text (`packages/provider`), plus a handover narrative. There is no
labelled ground-truth dataset for either — a real one would require someone
to hand-annotate what "correct" extraction looks like for open-ended text,
which wasn't built. **A percentage would therefore be invented confidence,
not a measurement**, and none is reported anywhere in this project's
documentation. This is a deliberate, repeated policy (`CLAUDE.md`
"No fabricated metrics"; `docs/week1-submission-matrix.md` "What the
submission must NOT claim"), not an oversight.

## What was actually measured instead

A 16-case corpus (`apps/api/src/eval/corpus.ts`) covering deadlines,
dependencies, duplicates, vagueness, conflicting instructions, prompt
injection, and malformed input, run against the real configured provider
(`pnpm eval:openrouter`, `google/gemma-4-26b-a4b-it:free`, free tier only)
and recorded verbatim: per case, whether the request succeeded, how many
candidates were extracted, how many were accepted/needed review/were
rejected by the deterministic validation pipeline, and any warnings.

- **16 of 16 cases completed a real request** (HTTP-level success — not an
  accuracy claim, a completion/no-timeout/no-error claim).
- Six responses are saved as `"source": "recorded"` fixtures — real
  captured model output, never hand-written and mislabeled as real (a
  documented rule: `packages/provider/src/fixtures.test.ts` asserts
  serialized fixtures contain no key material, and `CLAUDE.md` requires a
  fixture only be called "recorded" if a real API response produced it).
- Full per-case transcripts: `docs/eval/results.md`,
  `docs/eval/live-eval-evidence.md` (three earlier attempts —
  `results-gemma-4-26b-attempt-2.md`, `-attempt-3.md`,
  `-no-retry.md`, `-openrouter-free-alias.md` — are kept as-is; they
  document iteration on the eval setup itself, e.g. discovering that the
  `openrouter/free` alias rotates models mid-evaluation and switching to a
  pinned model id, which is itself evidence of real debugging rather than
  a first-try success story).
- `docs/eval/verification-summary.md` cross-checks the eval claims against
  the code.

## What is validated deterministically, not "evaluated"

The parts of the system that matter most for correctness — priority
ordering, dependency sequencing, deadline resolution, scheduling — are
pure deterministic functions, not model output, and are covered by
ordinary unit tests (`packages/domain/src/*.test.ts`, part of the 341-test
suite), not an "evaluation" in the LLM-benchmark sense. This split is the
project's central design claim (`README.md`, `docs/architecture.md`
§5–6): the AI is evaluated for whether its _interpretation_ is usable
input to a human review step; the _decisions_ are evaluated the same way
any deterministic code is — with exact-match unit tests, not statistics.

## Known limitation

The `google/gemma-4-26b-a4b-it:free` free-tier route is measurably slow
under load — the full demo workload can take 42–129 seconds against the
live deployment, and Cloudflare's ~100s response cutoff on Render means
the longest individual runs can fail on the hosted URL specifically (not
locally). Documented in `docs/week1-submission-matrix.md` R12, not hidden.
