# SHIFT PILOT — Claude Code Audit Handoff (M0–M2)

This is **not** an audit result. It is a factual handoff describing what a future Claude
session should inspect. It was written after M2 was committed on branch `main`
(last commit `docs: document M2 AI boundary and degraded behavior`).

## 1. Repository state

- **Monorepo**: pnpm workspaces, strict TS, project references.
- **Packages**: `packages/contracts` (zod schemas + inferred types), `packages/domain`
  (pure planning + extraction engines, **zero runtime deps**), `packages/provider`
  (`AiProvider` interface + `FakeAiProvider`).
- **Apps**: `apps/api` (Fastify + Drizzle/better-sqlite3), `apps/web` (React + Vite SPA).
- **Git identity**: repo-local `Rishi <ID+rishidar-lab@users.noreply.github.com>`.
- **No remote.** Do not push. No CI secrets. `AI_PROVIDER=claude` is a boot-time error
  until the real provider lands in M3.

### Verification commands (all offline, no network/keys)

```
pnpm install
pnpm lint          # eslint .
pnpm -r typecheck  # all 5 packages
pnpm test          # vitest, 110 tests
pnpm build         # web + api
pnpm format        # prettier --check .
```

### Current test count: **110** (13 files)

- `packages/domain/src/extraction.test.ts` — 13 (extraction pipeline)
- `packages/provider/src/fake.test.ts` — 12 (heuristic provider + meta honesty)
- `apps/api/src/intake.test.ts` — 10 (capture/get/approve + failure paths)
- `apps/api/src/{app,integration}.test.ts` — M1 planning + wiring
- `apps/web/src/api/client.test.ts` — typed decode at boundary
- plus pre-existing domain/contracts/api suites

## 2. M0 / M1 / M2 scope

- **M0** — monorepo scaffold.
- **M1** — contracts + deterministic domain engine (priority, dependency DAG/Kahn sequence,
  schedule projection, "what next", state machine, handover _facts_). Plans are **derived
  projections**, never persisted. `apps/api` exposed planning endpoints over SQLite.
- **M2** — AI-assisted natural-language intake behind a provider boundary:
  - `raw_inputs` + `extraction_drafts` tables (`apps/api/src/db/schema.ts`,
    `apps/api/drizzle/0001_*.sql`, `0002_*.sql`).
  - `FakeAiProvider` (`packages/provider/src/fake.ts`) — deterministic heuristic, `meta()`
    returns `isFake:true` with label `"Fake (offline heuristic) — simulated, not a real LLM"`.
  - `runExtraction(req)` in `packages/domain/src/extraction.ts` — pure validate → policy →
    normalize → dedupe → dependency-resolve → `ExtractionReport`.
  - `apps/api/src/use-cases/intake.ts` — `captureIntake` (persist `raw_inputs` **before**
    provider call, timeout-wrapped → `ProviderError`), `getIntake`, `approveIntake`
    (transaction: drafts → M1 `Task` + dependency remap).
  - `apps/api/src/routes/intake.ts`, `apps/api/src/ai.ts`, `apps/api/src/use-cases/errors.ts`.
  - Web: `apps/web/src/{App.tsx, api/client.ts, use-async.ts, components/*}`.

## 3. Critical invariants (must hold)

1. **Deterministic planning** — priority, dependency behavior, scheduling, "what next", and
   structured handover facts are computed by `packages/domain` pure engines, never by AI.
2. **Untrusted AI output** — provider returns raw candidates; every field re-validated by zod
   - policy in `runExtraction`.
3. **Persist-before-AI** — `raw_inputs` row exists (status `processing`/`failed`) before any
   provider call; a crash leaves a durable, retryable record.
4. **Human approval before mutation** — only `approveIntake` creates operational `Task`s; the
   provider never does.
5. **Provider abstraction** — one `AiProvider` interface; `claude` is not implemented and is
   rejected at boot; the fake is a full implementation, not a stub.
6. **Recomputed derived plans** — schedule/sequence/next are projections of task state; no
   stale persisted plan.

## 4. Areas requiring adversarial review

Please inspect specifically for:

1. **Domain invariant violations** — priority weights, deadline proximity, bucket thresholds
   (`packages/domain/src/{priority,constants}.ts`); sequence DAG correctness (`sequence.ts`);
   "what next" continuity logic.
2. **Incorrect state transitions** — `transitionAllowed` matrix (`state-machine.ts`); reopen
   clears `completedAt`; cancel rules.
3. **Transaction / rollback defects** — `approveIntake` (`apps/api/src/use-cases/intake.ts`)
   must atomically insert tasks + dependencies and flip `raw_inputs` status; partial failure
   must not leave orphan tasks or dangling `depends_on`.
4. **Race conditions / duplicate approvals** — re-`approveIntake` on the same `raw_input_id`;
   concurrent requests; idempotency of task creation / dependency insertion.
5. **Dependency-resolution bugs** — draft-id remap vs title match in `runExtraction`;
   ambiguous (`#ambiguous`) and unresolved (`#nonexistent`) refs; behavior when an accepted
   task's dependency was itself rejected at approval.
6. **Zod / schema gaps** — contracts strictness (`packages/contracts/src/index.ts`), especially
   `ExtractionReport`, `ExtractionDraft`, `RawInputStatus` transitions, and web decode
   (`apps/web/src/api/client.ts`).
7. **Provider output trust leaks** — any path where raw provider text reaches a `Task` field
   without passing through `runExtraction`; injection of fake task ids/fields.
8. **Prompt injection / data-to-instruction confusion** — user free text is data, never
   interpolated into generation targets; verify web render escapes HTML.
9. **API error consistency** — `ProviderError` mapping to 503/502/402 (`errors.ts`),
   envelope shape, `not_found` for unknown intake ids, conflict handling.
10. **SQLite / Drizzle integrity** — migration SQL vs schema drift (`apps/api/drizzle` vs
    `db/schema.ts`); foreign keys (`extraction_drafts.raw_input_id`, `task_dependencies`);
    WAL/sync usage.
11. **Frontend state staleness after mutations** — after `approveIntake`, does `IntakeView`
    refresh? Does `PlanView`/`HandoverView` reflect new tasks? `use-async` deps correctness.
12. **Fake-provider assumptions leaking into production architecture** — ensure no fake-only
    shortcut is hard-coded in domain/api that a real provider would break.
13. **Error / retry loops** — `captureIntake` timeout/retry; no infinite re-extract; client
    "re-extract" button behavior.
14. **Authorization assumptions** — auth is **intentionally deferred**; shift ids are not
    owner-scoped. Document this as a known limitation, do not "fix" silently.
15. **Test assertions validating implementation details** — prefer behavior over internals
    (e.g., asserting exact report shape vs. that approved tasks exist with expected count).
16. **Dead code / unnecessary abstractions** — e.g., unused `ShiftContext` fields, orphaned
    provider methods, over-split modules.
17. **Accessibility / usability defects** in the critical Week-1 flow: capture → review →
    approve, including focus order, labels, keyboard operation, error salience.
18. **Doc/code discrepancy** — `docs/architecture.md` & `docs/implementation-plan.md` vs
    actual code (provider name, endpoints, statuses, deferred M3 items).

## 5. Instructions for the reviewer

- **Do not rewrite working architecture merely for stylistic preference.**
- **Find concrete defects first.** Rank findings by severity (critical / high / medium / low).
- **Cite exact files and functions** for every finding.
- **Distinguish bugs from optional improvements.**
- **Do not claim vulnerabilities without a reproducible reasoning path.**
- **Do not implement fixes until explicitly requested.**
