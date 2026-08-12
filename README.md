# Shift Pilot

AI productivity and workload-planning assistant for frontline and operational workers.
Messy natural-language task dumps become a structured, explainable, editable work plan:
extraction, priority reasoning, dependency detection, execution sequencing, daily plan,
"what should I do next?", and end-of-shift handover.

> **Status: M0 scaffold.** Infrastructure is in place and verified; product features build
> on it in M1–M5. `docs/implementation-plan.md` is the source of truth for the build order.

## Stack

pnpm monorepo · React + Vite (`apps/web`) · Fastify (`apps/api`) ·
shared Zod contracts (`packages/contracts`) · pure domain logic (`packages/domain`) ·
AI provider boundary (`packages/provider`) · TypeScript strict · ESLint · Prettier · Vitest

## Commands (repo root)

```sh
pnpm install          # install all workspaces
pnpm dev              # api (:8787) + web (:5173) concurrently
pnpm test             # vitest, fully offline
pnpm lint             # eslint
pnpm typecheck        # strict tsc across all workspaces
pnpm build            # api bundle (tsup) + web bundle (vite)
```

## AI provider

`AI_PROVIDER=fake|claude` (env, default `fake`). The fake provider is a deterministic
offline implementation used for development, tests, and demos — no network, no keys.
The production Claude provider ships in M2 behind the same interface
(`packages/provider`); switching is configuration, never domain code.
Copy `.env.example` to `apps/api/.env` to override defaults.

## Design

`docs/architecture.md` (analysis, models, AI boundaries, validation, failure cases,
testing) · `CLAUDE.md` (engineering rules, security requirements, definition of done).
