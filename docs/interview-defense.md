# Interview defense — ShiftPilot

This document is the plain-language rationale behind every significant decision in the
repository. Use it to answer "why did you do it this way?" questions in one or two
sentences each, always ending back on the product invariant:

> **AI interprets. Human verifies. Deterministic software decides.**

## The product in one sentence

Frontline and operational workers dump a messy shift into a box; the app structures it
into reviewable tasks, a deterministic engine turns approved tasks into an explainable
plan ("what next, and why"), and an end-of-shift handover captures what actually happened.

## Why deterministic planning instead of "AI everywhere"?

- The brief's failure mode is a worker whose plan silently disagrees with reality. Planning
  has no ambiguity once tasks are fixed: priority, sequence, schedule and "what next" are
  **computed**, so two people running the same state get the same answer, every time, with
  reasons they can read.
- LLMs are good at language and bad at being sources of truth. We let the model do the only
  thing it is uniquely good at — reading messy language — and keep every operational
  decision in `packages/domain`, which has zero runtime dependencies and is fully tested.
- The result is that **an AI outage cannot corrupt a plan**; at worst prose disappears.

## Why is provider output treated as untrusted?

- A model that "guarantees" a JSON shape is not a promise a plan should be built on. Every
  response crosses the same boundary a hostile network payload would: envelope read, strict
  zod schema, domain policy, clamping, normalization, dependency resolution, and a
  re-parse of the final persisted draft.
- Structured outputs are used as a way to get well-shaped input more often, and are
  documented as not being a reason to skip validation. There is no code path where the
  model's word is taken on faith.

## Why do deadlines come back verbatim ("by 2pm") instead of as times?

- "By 2pm" means 2pm where the worker stands. If the model resolved the phrase, it would
  need the shift's time zone, and different providers could disagree about the same words.
  The provider reports the phrase; only `packages/domain/src/time.ts` turns it into an
  instant, shift-locally and DST-correct. One source of truth for what words mean.

## Why must a human approve before anything becomes a task?

- Extraction is a proposal. Approval is the moment the worker commits to doing something,
  and it is the only path that creates an operational task. `approveIntake` runs in one
  transaction: task rows, dependency edges and the intake status flip all succeed or fail
  together, and a duplicate approval is refused.

## Why three modes behind one interface, and no silent fallback?

- `FakeAiProvider` (offline, deterministic) makes the whole product testable, demoable and
  CI-green with zero cost; `OpenRouterProvider` is the verified real route (free tier);
  `ClaudeProvider` is a complete but **unexercised** adapter. Selection is explicit
  configuration: `AI_PROVIDER=openrouter|claude` without valid credentials is a boot
  failure, never a downgrade to fake. A silent fallback would let simulated output be
  presented as a real model's.

## Why is the OpenRouter route restricted to the free tier?

- The Week-1 brief allows a free tier; the app therefore has no paid code path at all.
  `assertFreeOpenRouterModel` rejects any model other than `openrouter/free` or a
  `<vendor>/<model>:free` id at config parse, at construction, and before **every**
  request. There is no fallback model array, no automatic model change on 429, no
  stripping of the `:free` suffix. If the free route is unavailable the call fails — the
  money path simply does not exist in the code.

## What was actually verified live, and how?

- One-request smoke against `openrouter/free`: HTTP 2xx, pipeline accepted a candidate,
  resolved model reported from response metadata (`poolside/laguna-s-2.1:free`).
- Controlled evaluation: the full 16-case corpus plus handover ran **16/16** on an
  explicitly configured `google/gemma-4-26b-a4b-it:free` (max output 1024, timeout 60 s,
  `OPENROUTER_MAX_RETRIES=2` same-route 429 backoff). Per-case outcomes, attempts, and
  resolved models are recorded in `docs/eval/results.md`; six responses became sanitized
  `"source": "recorded"` fixtures. The eval computes no accuracy percentage — the corpus
  has no labelled ground truth, so a number would be invented confidence.
- Honest caveats are recorded too: `openrouter/free` rotates across a pool that includes
  models that cannot produce JSON (8/16 on that alias), and free models share global
  quotas (429s observed; recovered with same-route retries).

## Why does the eval compute no accuracy score?

- The corpus has no labelled ground truth. A percentage without one would be invented
  confidence dressed up as a metric. The eval records what the pipeline actually did with
  each response — accepted, needs review, rejected, warnings — and the reviewer reads the
  cases against each case's stated expectation.

## Why persist the raw input before the AI call?

- If the provider fails or the process dies, the worker's words are already durable with
  status `failed` and the UI can offer a retry. The user's input is the most valuable
  artifact in the pipeline; it is never held hostage to a third party's availability.

## Why is handover prose degraded rather than erroring?

- The facts are computed first; the model only retells them. If the provider is down or the
  output is invalid, the response is still 200 with `degraded: { reason }` and the full
  facts. A handover that silently lost its numbers would be worse than one that says the
  prose is unavailable.

## Why SQLite, one process, an in-process rate limiter?

- Week-1 honesty: single-user, local-first semantics. SQLite with WAL and a fixed-window
  per-IP limiter is right-sized for the problem and trivially replaceable. The docs call
  out the distributed-limiter requirement as the scaling step.

## Why does the deployed demo lose its data, and why is that not a bug?

- Render Free has no disk. The database is deliberately placed at `/tmp` rather than a
  `/data` path that would imply a volume nobody mounted, so the reset is visible in the
  configuration instead of being a surprise at runtime. Migrations run on every boot, so
  an empty database is a working database.
- The fix is one line and no code: mount a disk and point `DATABASE_PATH` at it. The image
  and the application do not change. Persistence was scoped out for Week 1, not missed.

## Why does a big workload sometimes time out on the hosted URL?

- Measured, not hand-waved: the full 11-line demo workload costs ~730 completion tokens,
  which the free route delivered in 42s, 54s and 129s across samples. Cloudflare fronts
  Render and terminates an origin response at ~100s, so the slow tail cannot complete on
  the hosted URL at any timeout setting. Locally there is no such ceiling.
- What matters is the failure shape. The raw input is persisted **before** the provider is
  called, so a timeout costs the worker their inference and never their typing; the UI says
  capacity is busy and offers a retry; no task is created from a failed extraction.
- Retries are set to 0 on the deployment on purpose. The provider divides the total budget
  across attempts, so three attempts of 31s each fail on a route that needs 42s+, while one
  full-budget attempt succeeds. Retrying less made it more reliable, which is the opposite
  of the obvious configuration and worth being able to explain.

## Why are spend controls "a brake, not a cap"?

- The application cannot read a provider account balance. It enforces what it can —
  timeout, input cap, output cap, bounded same-route retries, per-IP rate limit — and the
  README states plainly that an absolute monetary ceiling belongs in the provider console.
  On the free tier the ceiling is effectively zero cost, but the same discipline applies
  to any route, and no claim of a monetary guarantee is made.

## Difficult questions

**"Did you make a real AI call, or is it all mocked?"**
Real calls were made and verified — but on the OpenRouter **free tier only**: a smoke test
returned HTTP 2xx and a controlled 16-case corpus plus handover ran 16/16 on
`google/gemma-4-26b-a4b-it:free`, with every request guarded by the free-only check. The
reports (`docs/eval/results.md`) and six recorded fixtures in the repo are from those real
responses. The Claude adapter, by contrast, has never made a live call — no Anthropic
credential has ever been used here, and nothing claims otherwise.

**"So why keep a Claude adapter if it is unproven?"**
The provider boundary exists precisely so a real provider can be swapped in without
touching the product logic. The Claude adapter is contract-tested offline against the SDK's
error classes and response shapes, and the gated `pnpm eval:claude` runner is the one
command that would produce its live evidence. It is explicitly labelled unexercised, not
claimed as verified.

**"Couldn't the model just invent a deadline?"**
It reports what it sees; the domain decides. A phrase outside the vocabulary is surfaced
as unresolved for the human, not guessed. Nothing the model returns can set a priority,
complete a task or approve a draft — those paths are server-owned and tested.

**"Your free model is slow and sometimes gets it wrong — why use it?"**
Free tiers are the Week-1 budget: real external integration with zero monetary risk to the
evaluator. The architecture absorbs the variance: bad output is a handled typed failure or
a review flag, not a corrupted plan, and the human approval step is the final filter. A
paid route would change a config value and nothing else — the code path is identical.

**"Why not let the LLM write the whole plan?"**
Then the plan is a black box whose output you cannot audit, and an outage takes the plan
with it. The design separates the one place where language skill is required from the many
places where correctness is required. That separation is also what makes the offline demo
and CI possible.

**"What would you do with a second week?"**
Produce the Claude live evidence via the existing gated runner, add authentication and
owner-scoped shifts, distributed rate limiting, persisted handover records, coverage
thresholds in CI, and the stretch backlog in `docs/architecture.md` §10.

## What is genuinely unfinished (say this before being asked)

- The **Claude adapter is unexercised** — no Anthropic credential has ever been used. The
  verified live route is OpenRouter free tier, and the submission says exactly that.
- No coverage threshold in CI (coverage is high and visible; enforcement is not wired).
- No authentication or multi-user isolation; single-process SQLite; spend brake not cap.
- The eval is a controlled verification, not a benchmark: no accuracy percentage, no
  labelled ground truth, and `openrouter/free`'s underlying model varies per request, which is why the deployment pins an explicit `:free` model instead.
- The hosted demo cannot extract the largest workloads inside the platform's ~100s
  response ceiling on a free model; the failure is handled honestly rather than hidden.
- Demo recording, the LinkedIn post with the Innovation Hacks tag, the follow/screenshot/DM
  step and the final submission are the remaining external actions
  (`docs/final-submission-checklist.md`).
