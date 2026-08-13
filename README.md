# Shift Pilot

AI productivity and workload-planning assistant for frontline and operational workers.
Messy natural-language task dumps become a structured, explainable, editable work plan:
extraction, priority reasoning, dependency detection, execution sequencing, daily plan,
"what should I do next?", and end-of-shift handover.

> **Status: M2 complete, M3 in progress.** The full capture → review → approve → plan →
> handover workflow runs today against the deterministic **offline** provider. The real
> Claude provider is **not wired yet** — `AI_PROVIDER=claude` fails fast at boot by design.
> `docs/implementation-plan.md` is the source of truth for build order.

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
is deterministic domain logic, so the offline provider and a future Claude provider cannot
disagree about what the same words mean.

## Time semantics

A shift is a local-time concept: "before close" and "by 2pm" mean 2pm where the worker
stands. Every shift stores an IANA `timezone` (defaulting to the server's zone at creation),
and all deadline resolution happens against it. Phrases the vocabulary does not cover are
kept visible as unresolved and handed back to the reviewer rather than guessed.

## AI provider

`AI_PROVIDER=fake|claude` (env, default `fake`).

- **`fake`** — a deterministic offline implementation used for development, tests and demos.
  No network, no key, no cost. It is a real implementation, not a stub: the whole extraction,
  review, approval and planning pipeline runs against it. The UI labels it
  **"Simulated AI · no real LLM"**, sourced from the provider's own `isFake` metadata.
- **`claude`** — not implemented yet. Selecting it is a **boot-time error** with a clear
  message, so no code path can silently pretend to be Claude.

Copy `.env.example` to `apps/api/.env` to override defaults.

## Cost and safety controls

Capture (`POST /api/shifts/:id/intake`) is the only endpoint that would spend provider
tokens, so it carries the controls: a per-IP fixed-window rate limit (`AI_RATE_LIMIT`), a
hard input-character cap (`AI_MAX_INPUT_CHARS`, enforced before any provider call), a
256 KB body limit, and a per-request timeout that **aborts** the call rather than merely
abandoning it (`AI_TIMEOUT_MS`).

This is a spend **brake**, not a monetary budget cap: the application cannot observe an
Anthropic account balance, so it cannot enforce a currency limit. Set spend limits in the
Anthropic console as well. Week 1 is single-user and unauthenticated by design — see
Limitations.

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
- **The real Claude provider is not wired yet** (M3). Everything demoable today runs on the
  deterministic offline provider.
- **No monetary budget enforcement** — see Cost and safety controls.
- Deadline vocabulary is finite; unrecognised phrases are flagged for the reviewer instead
  of being guessed.
- Single-process SQLite; the rate limiter is in-process and not distributed.
- Handover is deterministic facts only — AI-drafted handover prose is M3.

## Design

`docs/architecture.md` (analysis, models, AI boundaries, validation, failure cases,
testing) · `docs/implementation-plan.md` (milestones) · `CLAUDE.md` (engineering rules,
security requirements, definition of done).
