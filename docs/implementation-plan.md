# SHIFT PILOT — Implementation Plan

Status: M2 complete + Phase-B audit remediation · Target: complete, tested, demoable MVP
Last updated: 2026-08-13
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

### D-03 · Deadline vocabulary + normalizer — **done (corrected in Phase B)**

- **Scope**: resolve verbatim hints (`before close`, `EOD`, `2pm`, `14:00`, `in 30m`,
  `tomorrow 9am`, named times) against the shift's date **and IANA time zone**;
  `unresolved` marker; duplicate detection by normalized title.
- **As built**: `packages/domain/src/time.ts` (+ `time.test.ts`). Originally this logic lived
  inside `FakeAiProvider` and stamped local wall-clock times as UTC; Phase B moved it into
  the domain so every provider shares one deterministic calendar, and fixed the zone bug.
- **Not built**: weekday names and `now/ASAP` as deadlines, per-category estimate defaults,
  fuzzy duplicate similarity (exact normalized-title match is used instead).

### D-04 · Priority engine with explain

- **Scope**: component scorer (overdue +50, deadline proximity 0–40, explicitUrgency
  none/low/medium/high/critical → 0/0/12/25/40, unblocks 0–20, category 0–12, waiting 0–5,
  quick +3, continuity +15), buckets (≥55 critical · ≥35 high · ≥20 medium · else low),
  `priorityReason` breakdown rendered as human text.
- **Acceptance**: table tests incl. explicit urgency, overdue, tie-breaking; weights are
  module-level constants in `packages/domain/src/constants.ts`.
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

## M2 — Provider + validation pipeline + intake API + review UI (as-built)

> **Status (2026-08-13):** A-01, A-02, A-03, and the M3 intake/persistence/API/UI work were
> built together as one milestone (capture → extract → review → approve). The `claude`
> provider (A-04) was then implemented in Phase C with zero changes to domain/API/UI, exactly
> as the `AiProvider` interface + `ShiftContext` shape promised. What remains open is the
> **live call evidence** (A-05/A-06), which needs credentials.

### A-01 · AiProvider interface + failure types — **done**

- `packages/provider/src/types.ts`: interface + `ProviderFailure` union (§5) + `AiProviderMeta`
  (`id`, `label`, `isFake`, `promptVersion`). No SDK imports.

### A-02 · Validation pipeline (parse → zod → policy → normalize → dedupe → resolve) — **done**

- Implemented as `runExtraction(req)` in **`packages/domain/src/extraction.ts`** (pure, zero
  runtime deps). `extraction.test.ts` (13 cases) covers valid/empty/garbage JSON, unknown
  keys, >25 tasks, duplicates, dependency resolve/ambiguous, policy rejections, warnings.

### A-03 · FakeAiProvider (deterministic offline implementation) — **done**

- `packages/provider/src/fake.ts`: heuristic extractor (line splitting, keyword categories,
  duration parsing, **verbatim** deadline hints, `#n` + free-text dependency parsing,
  ambiguity flags), `meta` is an honest property (`isFake: true`, label `"Fake (offline
heuristic) — simulated, not a real LLM"`, `promptVersion: "fake-1"`), `forcedFailure`
  injection. `fake.test.ts`. `generateHandover` returns a deterministic summary; it is wired
  into `getHandoverNarrative` (`apps/api/src/use-cases/plan.ts`) with the same degraded-mode
  discipline as extraction.

### A-04 · ClaudeProvider (behind the interface) — **implemented; live call outstanding**

- `packages/provider/src/claude.ts` on the official Anthropic TypeScript SDK, behind the
  unchanged `AiProvider` interface. Server-side only; `apps/web` does not depend on the
  provider package. Structured output via `output_config.format`, full failure mapping,
  AbortSignal-backed timeout, bounded retries (SDK backoff, no second layer), required
  `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` with no in-code model default, fail-fast boot and
  no silent fallback to the fake provider.
- `packages/provider/src/prompt.ts` — versioned prompt (`shiftpilot.task-extract` /
  `claude-1`) with the JSON output contract; both ids persisted per intake.
- **Outstanding: no live API call has been made.** Fixtures are all synthetic and no observed
  extraction outcomes are recorded. `pnpm eval:claude` (gated by `ANTHROPIC_LIVE=1`) produces
  that evidence once credentials exist.

### A-05 / A-06 · Recorded fixtures + gated live test — **tooling done, recordings outstanding**

- `packages/provider/fixtures/` with a loader and an integrity test asserting provenance
  labelling, contract conformance, absence of credential-shaped material, and that no fixture
  contains a resolved instant where a verbatim hint belongs. All six shipped fixtures are
  labelled `"synthetic"` — hand-written to the contract, **not** captured from a model.
- `pnpm eval:claude` runs the 17-case corpus in `apps/api/src/eval/corpus.ts` and writes the
  clean cases from `FIXTURE_CANDIDATES` as `"recorded"` fixtures (with model, prompt version
  and timestamp) as a side effect of a live run. It refuses to run without
  `ANTHROPIC_LIVE=1`.

### Intake API + persistence + UI — **done (was M3 P-0x)**

- `raw_inputs` + `extraction_drafts` Drizzle tables + migrations `0001`/`0002`.
- `use-cases/intake.ts`: `captureIntake` (persists `raw_inputs` **before** provider call,
  timeout-wrapped → `ProviderError`), `getIntake`, `approveIntake` (transaction: drafts → M1
  `Task` + dependency resolution). `routes/intake.ts`, `errors.ts` (`ProviderError` →
  503/502/402), `ai.ts` factory. `intake.test.ts` (18 cases).
- Web: `api/client.ts` (zod decode at boundary, `IntakeResult`/`ApprovalResult`),
  `use-async.ts`, `IntakeView` (extract → editable review cards → approve), `PlanView`,
  `HandoverView`, `FakeProviderBadge`; `App.tsx` tabs + shift list.

---

## Phase B — adversarial audit remediation (2026-08-13)

An adversarial audit of M0–M2 found 28 findings. Fixed in Phase B:

- **Integrity**: approval now inserts tasks, dependency edges and the intake status flip in
  ONE transaction; a pipeline-rejected draft can no longer be approved; duplicate decisions
  are refused; `completedAt` is stamped once and preserved; `blockReason` is cleared on
  unblock; `ScheduledTask.position` is populated.
- **Dependencies**: edges are validated against same-shift task ids on create and update
  (unknown, cross-shift and self references → typed 422 instead of a 500 or a permanently
  "blocked by nothing" plan); references resolve across the whole extraction batch, so
  forward references work.
- **AI trust boundary**: untrusted provider strings are clamped and every draft is re-parsed
  through `ExtractionDraft` before persistence (previously a long title bricked the intake on
  read-back); the client can no longer declare which provider ran; deadline resolution moved
  out of the fake provider into `packages/domain/src/time.ts`.
- **Time**: shifts carry an IANA zone; "by 2pm" resolves shift-locally, DST-correct.
- **API**: body/URL shift identity mismatch rejected; unparseable `?now=` rejected;
  `GET /api/shifts/:id/tasks` added; cancelled tasks excluded from duplicate detection.
- **Cost/safety**: per-IP rate limit, input character cap, body limit, aborting timeout.
- **UI**: explicit loading/error/retry states everywhere; task state actions with
  re-derived planning; labelled controls, focus styles, live regions, responsive layout.
- **Repo hygiene**: duplicate provider factory and dead M0 persistence types removed; `.env`
  loaded in dev; migration `0002` given a default so it can apply to a populated table.
- **CI/docs**: format check + fresh-DB migration smoke added; component tests added; all
  documentation reconciled with the code that exists.

Still open after Phase B: A-01 (no real AI integration — M3), coverage thresholds (H-01),
demo script + seed (H-02), and everything listed under M3/M4/M5 below.

## Phase C — real Claude provider (2026-08-13)

Implemented the ClaudeProvider, the versioned prompt, structured output, failure mapping,
estimate provenance, fixtures, the evaluation corpus and gated live tooling — see A-04/A-05
above. **A-01 remains open**: no live Claude request has been made from this repository, so
the Week-1 "real AI integration" requirement is not yet demonstrated. Everything needed to
demonstrate it is in place and gated behind credentials.

## M3 — Live provider evidence + deferred items (remaining)

> Intake persistence + API + UI were completed as part of M2 (see M2 tail), and Phase C
> implemented the real `claude` provider, versioned prompts, structured output, failure
> mapping and the gated evaluation tooling. What remains in M3 is **producing the live
> evidence** — an actual API call, recorded as fixtures, plus the drift/contract check — and
> the deferred items below (handover storage stays a derived projection + on-demand narrative
> for now; the P-0x checklist below shipped with M2/Phase C in the shapes noted there).

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
