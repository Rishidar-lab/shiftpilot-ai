# Interview defense — SHIFT PILOT

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
  need the shift's time zone, and the fake and real providers could disagree about the same
  words. The provider reports the phrase; only `packages/domain/src/time.ts` turns it into
  an instant, shift-locally and DST-correct. One source of truth for what words mean.

## Why must a human approve before anything becomes a task?

- Extraction is a proposal. Approval is the moment the worker commits to doing something,
  and it is the only path that creates an operational task. `approveIntake` runs in one
  transaction: task rows, dependency edges and the intake status flip all succeed or fail
  together, and a duplicate approval is refused.

## Why two providers behind one interface, and no silent fallback?

- `FakeAiProvider` (offline, deterministic) makes the whole product testable, demoable and
  CI-green with zero cost; `ClaudeProvider` is the real thing behind the identical
  interface. Selection is explicit configuration: `AI_PROVIDER=claude` without credentials
  is a boot failure, never a downgrade to fake. A silent fallback would let simulated
  output be presented as a real model's.

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

## Why are spend controls "a brake, not a cap"?

- The application cannot read an Anthropic account balance. It enforces what it can —
  timeout, input cap, output cap, bounded retries, per-IP rate limit — and the README
  states plainly that an absolute monetary ceiling belongs in the Anthropic console.

## Difficult questions

**"So you never actually made a real AI call?"**
Correct, and the submission says so. The adapter, versioned prompt, failure mapping, corpus
and gated runners are complete and tested offline; the live call needs credentials and was
not possible in this environment. It is one command away: `ANTHROPIC_LIVE=1
AI_PROVIDER=claude pnpm eval:claude`. Nothing in the demo or tests pretends otherwise — the
badge says "Simulated AI" and every fixture is labelled `synthetic`.

**"How do you know the Claude adapter actually works?"**
The adapter's contract surface is unit-tested against the SDK's error classes and response
shapes (timeouts, 401/403/429, billing errors, refusals, truncation, non-JSON), and the
same `ClaudeProvider` instance the server boots is what the gated eval runs. What is
unproven is the live wire path, which is precisely the thing the eval exists to produce
evidence for.

**"Couldn't the model just invent a deadline?"**
It reports what it sees; the domain decides. A phrase outside the vocabulary is surfaced
as unresolved for the human, not guessed. Nothing the model returns can set a priority,
complete a task or approve a draft — those paths are server-owned and tested.

**"Why not let the LLM write the whole plan?"**
Then the plan is a black box whose output you cannot audit, and an outage takes the plan
with it. The design separates the one place where language skill is required from the many
places where correctness is required. That separation is also what makes the offline demo
and CI possible.

**"What would you do with a second week?"**
First: produce the recorded live evaluation and drift fixtures. Then: authentication and
owner-scoped shifts, distributed rate limiting, persisted handover records, a monetary cap
path, coverage thresholds in CI, and the stretch backlog in `docs/architecture.md` §10.

## What is genuinely unfinished (say this before being asked)

- No live Claude call: needs credentials (the only BLOCKED row in the submission matrix).
- No coverage threshold in CI (coverage is high and visible; enforcement is not wired).
- No authentication or multi-user isolation; single-process SQLite; spend brake not cap.
- All six shipped fixtures are `synthetic`; none claims to be recorded.
