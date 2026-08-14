# Shift Pilot

AI productivity and workload-planning assistant for frontline and operational workers.
Messy natural-language task dumps become a structured, explainable, editable work plan:
extraction, priority reasoning, dependency detection, execution sequencing, daily plan,
"what should I do next?", and end-of-shift handover.

> **Status: M3 in progress.** The full capture → review → approve → plan → handover
> workflow runs today. Two providers sit behind one interface: a deterministic offline
> provider, and a real Anthropic Claude provider selected by configuration.
> **No live Claude call has been made from this repository yet** — the Claude adapter,
> prompt, tests and evaluation corpus are in place, but no Anthropic credential has ever
> been used. The OpenRouter route IS live-verified on the free tier (see below); the
> Claude route remains unexercised.
> `docs/implementation-plan.md` is the source of truth for build order.
> Week-1 deliverable for the Innovation Hacks AI Internship 2026. Submission evidence:
> `docs/week1-submission-matrix.md`, `docs/rubric-self-review.md`, `docs/demo-script.md`.

## The pipeline at a glance

```mermaid
flowchart LR
  A["Messy shift text"] --> B["raw_inputs persisted first"]
  B --> C["AI provider (fake or Claude)"]
  C -->|"untrusted JSON"| D["zod + domain policy"]
  D --> E["Reviewable drafts"]
  E -->|"human approves"| F["Operational tasks"]
  F --> G["Deterministic planner"]
  G --> H["Plan · What next · Handover"]
```

"AI interprets. Human verifies. Deterministic software decides."

## Stack

pnpm monorepo · React + Vite (`apps/web`) · Fastify (`apps/api`) ·
shared Zod contracts (`packages/contracts`) · pure domain logic (`packages/domain`) ·
AI provider boundary (`packages/provider`) · TypeScript strict · ESLint · Prettier · Vitest

## Commands (repo root)

```sh
pnpm install          # install all workspaces
pnpm dev              # api (:8787) + web (:5173) concurrently
pnpm test             # vitest, fully offline — no network, no keys
pnpm lint             # eslint
pnpm typecheck        # strict tsc across all workspaces
pnpm format           # prettier --check .
pnpm build            # api bundle (tsup) + web bundle (vite)
pnpm db:generate      # generate a drizzle migration after a schema change
pnpm db:migrate       # apply migrations to DATABASE_PATH
```

## How responsibility is split

The model reads language. The code decides everything operational.

| Decision                                            | Owner                                       |
| --------------------------------------------------- | ------------------------------------------- |
| What the worker's text means (candidate tasks)      | AI provider (untrusted output)              |
| Whether a candidate is valid                        | `packages/domain` policy pipeline           |
| What a deadline phrase resolves to                  | `packages/domain/src/time.ts` (shift-local) |
| Priority, sequence, schedule, "what next", handover | `packages/domain` deterministic engines     |
| Whether anything becomes a real task                | the human, via explicit approval            |

A provider therefore reports the **verbatim** phrase it saw (`deadlineHint: "by 2pm"`); it
never returns an instant. Resolving that phrase against the shift's date and IANA time zone
is deterministic domain logic, so the fake and Claude providers cannot disagree about what
the same words mean.

## Time semantics

A shift is a local-time concept: "before close" and "by 2pm" mean 2pm where the worker
stands. Every shift stores an IANA `timezone` (defaulting to the server's zone at creation),
and all deadline resolution happens against it. Phrases the vocabulary does not cover are
kept visible as unresolved and handed back to the reviewer rather than guessed.

## AI provider modes

`AI_PROVIDER=fake|claude` (env, default `fake`). Selection is explicit configuration —
there is no autodetection and no fallback in either direction.

### Fake mode (default)

A deterministic offline implementation used for development, tests, CI and demos. No
network, no key, no cost. It is a real implementation, not a stub: the whole extraction,
review, approval and planning pipeline runs against it, so the product stays demoable when
the API is unavailable. The UI labels it **"Simulated AI · no real LLM"**, taken from the
provider's own `isFake` metadata rather than guessed from its name.

### Claude mode

Real extraction through the official Anthropic TypeScript SDK
(`packages/provider/src/claude.ts`), server-side only.

```sh
# apps/api/.env — never committed
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=<a currently supported model id>
```

- The key is read from the environment by the API process. `apps/web` does not depend on
  the provider package, so no key can reach a browser bundle.
- The model id is **required configuration with no default in code** — model identifiers
  change, and a hard-coded one would rot or silently pin an outdated model.
- Missing key or model is a **boot-time failure**, never a silent downgrade to fake: an
  operator who asked for real AI gets real AI or a refusal to start.
- The configured model and prompt version are reported on `/api/health` for diagnostics.
  The key never is.

### Trust model — the same for both providers

Claude interprets language. Deterministic application code governs operational truth.

```
raw text → persist → provider (untrusted output) → JSON parse → zod schema →
domain policy → shift-local deadline resolution → reviewable drafts →
human approval → active tasks → deterministic planner
```

The model reports the worker's **verbatim** deadline phrase; resolving "by 2pm" against the
shift's date and IANA time zone is domain logic, so both providers produce identical
deadlines for identical words. Structured outputs constrain the response, but the response
is still parsed, schema-checked and policy-checked exactly as an unconstrained one would be
— removing that validation because the provider "guarantees" a shape would put the model
back inside the trust boundary. Nothing the model returns can complete a task, approve a
draft, or set a priority.

### Verifying a real Claude call

The repository ships a gated evaluation runner that exercises the full extraction path
against a ~15-case corpus (clear tasks, deadlines, relative time, dependency chains,
duplicates, vague and ambiguous text, conflicting statements, prompt injection, very short
input, non-task text, malformed input):

```sh
ANTHROPIC_LIVE=1 ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=<id> pnpm eval:claude
```

It refuses to run without the explicit `ANTHROPIC_LIVE=1` opt-in, records what actually
happened per case, and computes **no accuracy score** — there is no labelled ground truth
here, and a percentage without one would be invented confidence. A live run also writes a
small set of clean case responses into `packages/provider/fixtures/` as
`"source": "recorded"` fixtures — there is no separate capture command; recording happens
on a live eval run.

### Verifying a real OpenRouter call (free route only)

The same evaluation runner works against OpenRouter, with a hard free-tier-only guard.
Every request must use `openrouter/free` or a `<vendor>/<model>:free` id — any other model
is rejected at configuration time and before every inference, and there is never a paid
fallback. The smoke test pins `openrouter/free` and makes exactly one request:

```sh
AI_PROVIDER=openrouter OPENROUTER_API_KEY=... pnpm smoke:openrouter
```

The full controlled evaluation (16 corpus cases + handover) runs with the guard enforced:

```sh
AI_PROVIDER=openrouter OPENROUTER_API_KEY=... \
OPENROUTER_MODEL=<free-model>:free pnpm eval:openrouter
```

Free-tier quirks, recorded honestly in `docs/eval/`:

- The `openrouter/free` alias load-balances across the current free pool, which includes
  models that do not produce usable JSON (safety classifiers, sub-3B chatbots). It is the
  mandated smoke route and passes, but it cannot reliably serve a 16-case corpus.
- Specific free models have shared global quotas; HTTP 429 is retried with backoff on the
  exact same route when `OPENROUTER_MAX_RETRIES > 0`, and the eval retries transient
  failures per case (attempts are reported). A rate-limited route fails rather than ever
  touching a paid model.
- `docs/eval/results.md` is the live report; the Aug 2026 verification ran the corpus
  16/16 on `google/gemma-4-26b-a4b-it:free` with every request confirmed on the free
  tier, and recorded fixtures carry both the configured and the resolved model.

## Cost and safety controls

Capture (`POST /api/shifts/:id/intake`) is the only endpoint that spends provider tokens,
so it carries the controls — all of which apply to Claude mode exactly as they do to fake
mode, because they sit in front of the provider boundary:

| Control         | Setting                                     | Effect                                                                                |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Request rate    | `AI_RATE_LIMIT` / `AI_RATE_LIMIT_WINDOW_MS` | Per-IP fixed window; checked before validation so malformed requests cannot bypass it |
| Input size      | `AI_MAX_INPUT_CHARS`                        | Rejected with 422 **before** persistence or any provider call                         |
| Body size       | fixed 256 KB                                | Fastify-level                                                                         |
| Request timeout | `AI_TIMEOUT_MS`                             | Aborts the in-flight HTTP request via `AbortSignal`, so a slow call stops spending    |
| Output tokens   | `ANTHROPIC_MAX_OUTPUT_TOKENS`               | Hard ceiling per response, including model thinking                                   |
| Retries         | `ANTHROPIC_MAX_RETRIES`                     | Bounded; the SDK owns exponential backoff and the app adds no second retry layer      |

**This is a spend brake, not a monetary cap.** The application cannot read an Anthropic
account balance, so it cannot enforce a currency limit and does not claim to. Configure
spending limits in the Anthropic console as well — that is the only place an absolute
monetary ceiling can be enforced. Note also that a bounded timeout multiplied by bounded
retries bounds wall-clock time per request, not total account spend.

## Testing

```sh
pnpm test             # all suites, offline
```

Domain engines and the extraction pipeline are table-driven unit tests; the API is tested
through `app.inject()` against in-memory SQLite; the web app has component tests
(`@testing-library/react` + jsdom) covering the loading/error/retry surfaces. CI runs
install → lint → typecheck → format → test → build, plus a fresh-database migration smoke
test. **CI needs no secrets and makes no paid API calls.**

## Limitations (current, honest)

- **No authentication or multi-user isolation.** Shift ids are not owner-scoped. Deliberate
  Week-1 scope, not an oversight.
- **No live Claude call has been made from this repository yet.** The Claude adapter,
  prompt, contract tests, fixtures and evaluation corpus exist and are exercised offline;
  the OpenRouter free route is verified live (see above), but no Anthropic credential has
  ever been used here. Fixtures labelled `"source": "recorded"` come from the OpenRouter
  free route; everything else is `"source": "synthetic"`.
- **AI handover prose is implemented, with a degraded mode.** The narrative is drafted from
  the deterministic facts only — the model never sees counts or history the database did not
  already prove — and a provider outage or invalid output yields an explicitly labelled
  degraded response. The facts always render; the prose is allowed to disappear.
- **No monetary budget enforcement** — see Cost and safety controls.
- Deadline vocabulary is finite; unrecognised phrases are flagged for the reviewer instead
  of being guessed.
- Single-process SQLite; the rate limiter is in-process and not distributed.
- Structured outputs constrain the model's response shape but are not treated as a
  guarantee; malformed or unexpected output is a handled failure, not a crash.

## Design

`docs/architecture.md` (analysis, models, AI boundaries, validation, failure cases,
testing) · `docs/implementation-plan.md` (milestones) · `docs/demo-script.md` +
`docs/demo-seed-data.md` (reproducible offline demo) · `docs/interview-defense.md`
(rationale + hard questions) · `CLAUDE.md` (engineering rules, security requirements,
definition of done).
