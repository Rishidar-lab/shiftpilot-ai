# SHIFT PILOT — Audit handoff (M0–M2) and Phase-B outcome

This document was originally a **pre-audit** handoff describing what a reviewer should
inspect. The audit has now been performed and its confirmed defects remediated in Phase B,
so this file records both: what was reviewed, and what came out of it.

Last updated: 2026-08-13.

## 1. Repository state

- **Monorepo**: pnpm workspaces, strict TS, project references.
- **Packages**: `packages/contracts` (zod schemas + inferred types), `packages/domain`
  (deterministic planning, extraction and shift-local time engines), `packages/provider`
  (`AiProvider` interface + `FakeAiProvider` + `ClaudeProvider`).
- **Apps**: `apps/api` (Fastify + Drizzle/better-sqlite3), `apps/web` (React + Vite SPA).
- **Git identity**: repo-local `Rishi <ID+rishidar-lab@users.noreply.github.com>`.
- **No remote.** Do not push. No CI secrets. `AI_PROVIDER=claude` boots normally when key +
  model are configured (and fails fast without them); the one missing piece is a **live
  call** through the pipeline.

### Verification commands (all offline, no network/keys)

```
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format
DATABASE_PATH="$PWD/.ci-data/ci.db" pnpm db:migrate   # fresh-DB migration check
```

## 2. M0 / M1 / M2 scope

- **M0** — monorepo scaffold.
- **M1** — contracts + deterministic domain engine (priority, dependency DAG/Kahn sequence,
  schedule projection, "what next", state machine, handover _facts_). Plans are **derived
  projections**, never persisted.
- **M2** — AI-assisted natural-language intake behind a provider boundary: `raw_inputs` +
  `extraction_drafts` tables, `FakeAiProvider`, the `runExtraction` pipeline,
  `captureIntake` / `getIntake` / `approveIntake`, and the web intake→review→approve UI.

## 3. Critical invariants (must hold)

1. **Deterministic planning** — priority, dependency behaviour, scheduling, "what next" and
   handover facts are computed by `packages/domain`, never by AI.
2. **Untrusted AI output** — the provider returns raw candidates; every field is re-validated
   by zod + policy, clamped, and re-parsed through `ExtractionDraft` before persistence.
3. **Deterministic calendar** — providers report verbatim deadline phrases; only
   `packages/domain/src/time.ts` turns a phrase into an instant, shift-locally.
4. **Persist-before-AI** — the `raw_inputs` row exists (`received` → `processing`) before any
   provider call; a crash leaves a durable, retryable record.
5. **Human approval before mutation** — only `approveIntake` creates operational `Task`s, and
   it refuses drafts the pipeline rejected.
6. **Atomic approval** — task rows, dependency edges and the intake status flip are one
   transaction.
7. **Server-owned provenance** — the recorded provider and prompt version come from the
   provider's metadata, never from the request.
8. **Recomputed derived plans** — schedule/sequence/next are projections of task state.

## 4. Audit outcome

The adversarial review produced 28 findings (1 blocker, 8 high, 18 medium, plus a group of
documentation drift). Phase B fixed every confirmed behavioural, integrity, security, UX, CI
and documentation defect, each with a regression test where testable. The per-finding record
lives in `docs/implementation-plan.md` ("Phase B — adversarial audit remediation").

**The one blocker that remains open is A-01: no live Claude call has been made through this
pipeline yet.** `FakeAiProvider` and `ClaudeProvider` are both implemented behind one
interface, and `AI_PROVIDER=claude` fails fast without credentials — but the real-API-call
evidence the Week-1 brief asks for has not been produced. Week 1 is not submission-ready
until a live call succeeds (M3 / Phase C tail).

### Known limitations that are deliberate, not defects

- **No authentication or multi-user isolation.** Shift ids are not owner-scoped.
- **No monetary budget cap.** The app rate-limits and size-caps requests but cannot read an
  Anthropic account balance; a currency limit must be set in the provider console.
- **Single-process assumptions.** The rate limiter is in-process; SQLite is single-writer.
- **Finite deadline vocabulary.** Unrecognised phrases are surfaced as unresolved rather than
  guessed.
- **No coverage thresholds in CI yet** (H-01 remains open).

## 5. Instructions for a future reviewer

- **Do not rewrite working architecture merely for stylistic preference.**
- **Find concrete defects first.** Rank findings by severity.
- **Cite exact files and functions** for every finding.
- **Distinguish bugs from optional improvements.**
- **Do not claim vulnerabilities without a reproducible reasoning path.**
- **Do not implement fixes until explicitly requested.**
