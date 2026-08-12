# SHIFT PILOT — Implementation Plan

Status: Week 1 baseline · Target: complete, tested, demoable MVP within the week
Milestones: M0–M5. Every issue below is GitHub-sized (≤ ~1 day, ≤ ~400 changed lines,
one concern, mergeable independently).

## Cross-cutting rules (apply to every issue)

- Conventional commits: `feat(scope): …`, `fix(scope): …`, `test(scope): …`, `chore(scope): …`.
- Branch names: ≤3 words, hyphenated, no `feat/` prefix (e.g. `capture-pipeline`).
- PRs must pass CI: lint + typecheck + full offline test suite + build.
- No secrets ever; env-only config; `pnpm test` must never hit the network.
- Definition of done in `CLAUDE.md` applies to every issue.

---

## M0 — Scaffold (Day 1 morning)

### S-01 · Initialize monorepo workspace

- **Scope**: root `package.json` (workspaces + scripts `dev/test/typecheck/lint/build/db:*`),
  `pnpm-workspace.yaml`, `tsconfig.base.json` (strict), empty `packages/contracts|domain|provider`
  and `apps/api|web` with minimal package manifests, `.gitignore`, `.env.example`.
- **Acceptance**: `pnpm install && pnpm typecheck && pnpm build` pass; `pnpm dev` boots two
  placeholder processes; repo ready for push to GitHub.
- **Done when**: CI runs and is green; README stub listing commands.

### S-02 · CI pipeline + GitHub repo hygiene

- **Scope**: GitHub repo creation (owner side), `ci.yml` (install → lint → typecheck →
  test → build; no secrets), branch protection suggestions, labels `milestone/M0…M5`,
  milestones M0–M5.
- **Acceptance**: CI green on a trivial PR; `pnpm test` proven offline (strace/no network
  assert optional).
- **Done when**: first real PR (S-01) merged with CI green.

---

## M1 — Contracts + domain engines (Day 1 pm – Day 2)

### D-01 · Contracts: zod schemas for all entities

- **Scope**: `packages/contracts`: zod schemas (`Shift`, `RawInput`, `Task`, `Handover`,
  `ExtractionReport`, error codes/envelope, category + status enums), inferred types exported.
- **Acceptance**: no `any`; schemas `.strict()` where policy demands; types compile into
  `packages/domain` as type-only imports (no runtime dep on zod there).
- **Done when**: unit tests parse every schema (valid + invalid fixture per field).

### D-02 · Task state machine + transition matrix

- **Scope**: `transitionAllowed(from, to)` + guard reasons (blocked requires reason; cancel
  rules; reopen clears `completedAt`).
- **Acceptance**: full matrix unit test; illegal transitions typed errors, not silent.
- **Done when**: ≥90% coverage.

### D-03 · Deadline vocabulary + normalizer

- **Scope**: resolve hints (`before close`, `EOD`, `2pm`, `14:00`, `in 30m`, `now/ASAP`,
  weekday names, `today/tomorrow`) against `ShiftContext`; `unresolved` marker; estimate
  defaults per category; duplicate detection (similarity ≥0.85).
- **Acceptance**: table-driven tests for every vocabulary entry + unknown + past-deadline
  cases; `deadlineSource` recorded.
- **Done when**: normalizer green; unresolved deadlines flagged not failed.

### D-04 · Priority engine with explain

- **Scope**: component scorer (deadline 0–40, blocks 0–20, category 0–12, waiting 0–5,
  override −50..+50), buckets, `priorityReason` breakdown, `explain(reason)` → human text.
- **Acceptance**: table tests incl. overrides, overdue, tie-breaking; weights are module
  constants.
- **Done when**: ≥90% coverage; sample reasons read correctly.

### D-05 · Sequence engine (DAG, Kahn) + cycle detection

- **Scope**: topological order with documented tie-breaks; SCC cycle flagging; fallback order
  for cyclic tasks; no mutation of `dependencyIds`.
- **Acceptance**: chain/star/cycle/self-loop fixtures green; cycle tasks flagged + warned.
- **Done when**: ≥90% coverage.

### D-06 · Schedule projection + who-next

- **Scope**: `start=max(now,prevEnd)` timetable from now→shift end; honest `overflow` flags;
  who-next (runnable filter, continuity bonus, top-3 reasons, unblocks count); explicit empty
  states (`blocked_by`, `empty`).
- **Acceptance**: overflow/empty/blocked/continuity fixtures green; projection never mutates
  state.
- **Done when**: engines green; `packages/domain` has zero non-test runtime deps.

### D-07 · Handover facts builder

- **Scope**: deterministic stats/lists from task rows (counts, minutes, pending by bucket,
  blocked w/ blockers, flags, next-shift recommendations).
- **Acceptance**: fixture-driven; no LLM input anywhere in this module.
- **Done when**: green; facts shape frozen in contracts (DriftGuard test).

---

## M2 — Provider + validation pipeline (Day 3)

### A-01 · AiProvider interface + failure types

- **Scope**: `packages/provider`: interface + `ProviderFailure` union (§5); `ProviderError`
  mapping helpers; no SDK imports yet.
- **Acceptance**: compiles; failure types exhaustive in match tests.
- **Done when**: typed, covered.

### A-02 · Validation pipeline (parse → zod → policy → normalize)

- **Scope**: the §6 pipeline as pure functions with `ExtractionOutcome`/
  `ExtractionReport`; retry-with-feedback orchestration (≤2) lives here too.
- **Acceptance**: fixture corpus `apps/api/fixtures/extraction/` all green; per-task skips
  produce reasons; full-shape failures retry then fail cleanly.
- **Done when**: ≥90% coverage on pipeline.

### A-03 · FakeProvider (deterministic offline implementation)

- **Scope**: heuristic extractor (line splitting, keyword categories, vocabulary deadlines)
  implementing `AiProvider`; composeHandover template mode.
- **Acceptance**: end-to-end app works with `AI_PROVIDER=fake`; tests use it as the real
  implementation.
- **Done when**: demo-able offline; no stubs.

### A-04 · ClaudeProvider (behind the interface, offline-untestable by design)

- **Scope**: `@anthropic-ai/sdk` wiring, tool-use `submit_extraction` w/ JSON-Schema-derived
  arg schema, forced tool choice, temperature 0, `max_tokens` caps, timeout+Abort, retry/
  backoff 429/5xx, env read via injected config (no direct `process.env`).
- **Acceptance**: unit tests cover retry policy/timeout with mocked client; live call NOT
  executed.
- **Done when**: code-review-ready, documented activation (`ANTHROPIC_LIVE` gate in A-06).

### A-05 · Recorded fixtures + contract tests (drift detector)

- **Scope**: `fixtures/anthropic/*.json` shaped like real Claude tool responses (valid-rich,
  unknown keys, truncated, shape-broken); tests: every fixture through pipeline +
  `RecordingProvider`.
- **Acceptance**: contract tests green offline; fixture failing = prompt/schema drift alarm.
- **Done when**: fixture corpus covers all §6 stages.

### A-06 · Gated live integration test

- **Scope**: `pnpm test:live` (test files under `apps/api/test/live/`, skipped unless
  `ANTHROPIC_LIVE=1`), never wired into `pnpm test`/CI.
- **Acceptance**: `pnpm test` ignores it; documented in README how to activate.
- **Done when**: skipped-by-default verified.

---

## M3 — Persistence + API (Day 4)

### P-01 · DB schema + migrations (Drizzle/better-sqlite3)

- **Scope**: `shifts`/`raw_inputs`/`tasks`/`handovers` tables, WAL, migrations via
  drizzle-kit; boot-time migration apply.
- **Acceptance**: fresh DB on first boot; `:memory:` for tests; snake_case columns.
- **Done when**: migration generates + applies cleanly.

### P-02 · Repos (typed query modules)

- **Scope**: shifts/inputs/tasks/handovers repos: insert/get/list/update w/ optimistic
  `updatedAt` ETag; transactions for approvePlan + capture.
- **Acceptance**: repo integration tests on temp DB; all rows typed via contracts.
- **Done when**: green; no raw `any` rows anywhere.

### P-03 · config.ts (fail-fast env validation)

- **Scope**: zod env parsing, provider selection, boot errors (claude w/o key, bad port…).
- **Acceptance**: unit tests: every invalid env set → typed boot error.
- **Done when**: green; `.env.example` matches schema exactly.

### P-04 · Error envelope + Fastify route layer + health

- **Scope**: `{ error: { code, message, details? } }` mapper from all layer error types;
  routes: shifts CRUD-lite, `POST /inputs` (capture pipeline), `POST /plan/approve`,
  `GET /plan` (projection + who-next), `PATCH /tasks/:id` (state machine + ETag 409),
  `POST /handover`.
- **Acceptance**: `app.inject()` happy-path + §7 failure-tables tests; 409 on stale ETag;
  forbidden transitions → 422 `validation_error`; provider failures → `ai_*` codes.
- **Done when**: ≥80% route coverage; full §7 matrix exercised in tests.

### P-05 · Capture + handover use cases

- **Scope**: orchestration: persist input → provider → pipeline → persist drafts+report;
  approvePlan transaction; generateHandover (facts → provider → prose validation →
  degraded fallback).
- **Acceptance**: offline end-to-end via injected fake; degraded handover labelled
  `degraded: true`; input never lost on AI failure.
- **Done when**: green; durability ordering asserted in test (input row exists even when
  provider fails).

---

## M4 — Web UI (Day 5)

### W-01 · App shell + typed API client

- **Scope**: Vite+React app, route-less layout with tabs (Capture, Plan, Tasks, Handover),
  typed fetch client (contracts decode, `ApiError` mapping), global error banner.
- **Acceptance**: component tests: client maps `ai_unavailable` → user text + retry action.
- **Done when**: client typed; banner tested.

### W-02 · Capture + review screens

- **Scope**: textarea capture (source select), pending-indicator, extraction report panel
  (accepted/skipped w/ reasons), editable drafts table (title/estimate/deadline/category),
  approve button (disabled when nothing accepted), re-extract on failed status.
- **Acceptance**: component tests: report rendering, approve disabled state, re-extract
  path; no HTML injection of raw text.
- **Done when**: happy path capture→review→approve works offline against fake provider.

### W-03 · Plan + who-next view

- **Scope**: next-action hero card (task, startBy, 3 reasons, unblocks, empty states),
  sequence list w/ reason breakdown, timetable projection + overflow/cycle/overdue flags.
- **Acceptance**: component tests for each flag state; all strings come from API data.
- **Done when**: state-matrix UI verified (block/unblock/cancel/complete/reopen).

### W-04 · Tasks + handover screens

- **Scope**: editable task table (status transitions per state machine, dependency editing
  optional flag), optimistic-lock 409 reload, handover generation with provider prose +
  deterministic fact panels + degraded banner.
- **Acceptance**: component tests: 409 recovery, degraded handover banner, fact panels from
  `facts` json not prose.
- **Done when**: entire §2 workflow usable from the browser offline.

---

## M5 — Hardening, docs, demo (Day 5 pm – Day 6)

### H-01 · Coverage enforcement + CI audience check

- **Scope**: coverage thresholds (domain/pipeline ≥90, api ≥80) wired into CI; confirm CI
  needs zero secrets; README filled (quickstart, provider switching, live-test activation).
- **Acceptance**: CI red when coverage drops; README accurate against `.env.example`.
- **Done when**: green.

### H-02 · Demo script + seed fixture

- **Scope**: `scripts/demo.md` walkthrough (open shift → paste messy input → review →
  approve → complete multi-step flow w/ interruption → handover) + `scripts/seed.ts`
  populating a realistic shift with the fake provider.
- **Acceptance**: walkthrough executes verbatim; every screenshot-able state reachable
  offline.
- **Done when**: demo reproducible in < 5 minutes, zero cost.

### H-03 · Failure-mode sweep + edge polish

- **Scope**: manual + scripted pass over §7 table in UI; empty-shift, no-runnable, overflow,
  unresolved-deadline, cycle and 409 states look intentional; a11y basics (labels, focus).
- **Acceptance**: every §7 row has a demonstrated UI path; no console errors in those paths.
- **Done when**: sweep checklist merged into `docs/architecture.md` §7 references.

### H-04 · Week-1 wrap-up

- **Scope**: final review pass (secrets scan `grep -r` patterns + git log check), tag
  `v0.1.0`, retrospective notes, record stretch backlog (architecture.md §10) as GitHub
  issues labeled `stretch`.
- **Acceptance**: repo private/public per owner preference with clean history; stretch
  issues filed.
- **Done when**: everything merges; CI green on `dev` branch tip.

---

## Week-1 schedule summary

| Day | Milestone       | Exit criteria                                                     |
| --- | --------------- | ----------------------------------------------------------------- |
| 1   | M0 + D-01..D-03 | CI green; contracts + state machine + normalizer tested           |
| 2   | D-04..D-07      | All domain engines tested, zero runtime deps                      |
| 3   | M2 (A-01..A-06) | Pipeline + fake + Claude behind interface; fixtures green offline |
| 4   | M3 (P-01..P-05) | Full API green against §7 matrix on in-memory DB                  |
| 5   | M4 (W-01..W-04) | Browser happy path end-to-end offline                             |
| 6   | M5 (H-01..H-04) | Demo scripted, README, v0.1.0, stretch backlog filed              |

## Estimated issue count

24 core issues (S/D/A/P/W/H) → 24+ small PRs. Blocking chain: D-* only after M0; A-02 after
D-03; P-03 after A-01; W-* after M3. Many D-* and W-* tasks parallelize within their day.
