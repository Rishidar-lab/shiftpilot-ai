# CLAUDE.md

Guidance for AI agents (and humans) working in this repo. Read before editing.

## Project

SHIFT PILOT — an AI productivity and workload-planning assistant for frontline and operational
workers. Messy natural-language input becomes a structured, explainable, editable work plan:
task extraction, priority reasoning, dependency detection, execution sequencing, daily plan,
"what should I do next?", and end-of-shift handover.

Full design rationale: `docs/architecture.md`. Task breakdown: `docs/implementation-plan.md`.

## Architecture (invariants — do not break)

Layered monorepo, dependencies point inward only:

- `packages/contracts` — zod schemas + inferred types shared by all packages (the single source
  of truth for data shapes). Depends on zod only.
- `packages/domain` — pure business logic: validation policy, priority scoring, sequencing,
  scheduling, handover facts, deadline-hint resolution, task state machine. ZERO runtime
  dependencies (type-only imports from contracts). No I/O, no AI, no framework.
- `packages/provider` — AI boundary. `AiProvider` interface + `ClaudeProvider` (real) +
  `FakeProvider` (deterministic, offline) + recorded fixtures. Nothing outside this package
  may import `@anthropic-ai/sdk`.
- `apps/api` — Fastify. Thin routes → use cases (orchestration) → domain + provider + repos.
  Drizzle + better-sqlite3 for persistence, drizzle-kit migrations.
- `apps/web` — React + Vite browser app. Talks to the API over HTTP only. Never touches the
  database and never holds provider credentials.

Hard rules:

1. **AI output is untrusted input.** Every AI response passes the full validation pipeline
   (JSON → zod schema → domain policy → normalization) before persistence. Validation lives in
   atomic pure functions in `packages/domain` and `packages/provider`; never reimplement it at
   call sites.
2. **The LLM supplies facts, never decisions.** Priority, sequence, schedule and "what next"
   are computed by deterministic, unit-tested engines in `packages/domain`. The model only
   contributes extraction hints (category, estimate, deadline hint, dependencies).
3. **No AI in hot paths.** `who-next` and plan projection are pure domain computation.
   Provider calls happen only on: input capture (extraction) and handover generation.
4. **Typed errors everywhere.** No `throw new Error("...")` across layer boundaries — use
   tagged error unions (`ProviderFailure`, `ExtractionOutcome`, `UseCaseError`). API errors use
   `{ error: { code, message, details? } }` with codes from `contracts`.
5. **Every provider call has a deterministic offline twin.** Tests and development never
   require a network or an API key. The fake is a real implementation, not a stub.
6. **Secrets stay server-side** — see Security.
7. **No fabricated metrics.** Handover numbers/stats are computed from the database by domain
   code; the model may only draft prose around domain-provided facts.

## Commands

Run from repo root (pnpm required).

```sh
pnpm install          # install all workspaces
pnpm dev              # api (:8787) + web (:5173) concurrently, hot reload
pnpm typecheck        # strict tsc across all workspaces
pnpm lint             # eslint
pnpm test             # unit + integration tests, fully offline
pnpm build            # production build (api dist + web dist)
pnpm format           # prettier check
pnpm db:generate      # generate a drizzle migration after schema changes (from apps/api)
pnpm db:migrate       # apply migrations to DATABASE_PATH
```

Provider selection is via env only (`AI_PROVIDER=fake|claude`); see `apps/api/src/config.ts`
and `.env.example`. Switching providers requires configuration, never code changes outside
`packages/provider`.

## Engineering rules

- TypeScript strict mode. No `any`. Prefer `unknown` + narrowing. Rely on inference; write
  explicit types for exports.
- `const` over `let`; early returns over `else`; no unnecessary destructuring; no import
  aliasing/renaming.
- No placeholder functionality presented as complete: if a feature is stubbed, it must be
  behind an explicit `TODO` + rendered in UI as unavailable, or not exist at all.
- No unnecessary abstraction: composable pure functions in domain; thin adapters everywhere
  else. Do not add a class/interface until a second concrete use case exists.
- Small PRs (≤ ~400 lines), one concern each, conventional commits
  (`feat(domain): ...`, `fix(api): ...`, `test(provider): ...`).
- Prefer adding tests over adding comments; comment only non-obvious constraints.

## Security requirements

- Never commit secrets, tokens, or API keys. `.env` is gitignored; `.env.example` contains
  placeholders only. Real keys exist only in a local `.env` / deploy secrets.
- API credentials are server-side only: the browser never receives them; CORS restricted to
  `CORS_ORIGIN`; provider config read once at boot via zod-validated env.
- Treat AI output as untrusted input (see invariants). Provider responses are length-capped
  (`AI_TIMEOUT_MS`, `max_tokens`), schema-checked, and domain-policy-checked before write.
- Prompt-injection hardening: user text is demarked as data in the provider prompt and the
  output is constrained by a strict tool schema + whitelist; raw user text is escaped at
  render time in the web app (never injected as HTML).
- Never log prompt contents, raw input text, or credentials. Log error codes, not payloads.

## Definition of done (every feature/PR)

1. `pnpm typecheck` and `pnpm lint` pass.
2. `pnpm test` passes fully offline (no network, no keys, no fixtures requiring paid APIs).
3. New logic covered: domain/pipeline ≥ 90% line coverage; API routes ≥ 80%.
4. AI-facing changes include/adjust a fixture + contract test; prompt changes reviewed for
   injection surface and output-size caps.
5. All failure paths surface as typed errors with UI-visible messages (no silent fallbacks;
   deterministic degraded modes are explicit and labelled).
6. `docs/architecture.md` and `docs/implementation-plan.md` updated when shape or flow
   changes.
7. No secrets, no placeholder-as-complete, no fabricated metrics.
