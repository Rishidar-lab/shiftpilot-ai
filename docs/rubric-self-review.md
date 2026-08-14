# Week 1 Rubric Self-Review — SHIFT PILOT

Scoring is deliberately conservative: a dimension is only rated fully when its evidence is
reproducible from this repository by a reviewer who trusts nothing the author says. Where a
rubric dimension overlaps the submission matrix, the matrix is the source of truth.

Scale used here: **Meets fully** / **Meets with gaps** / **Not yet**.

---

## 1. Product & workflow completeness

**Rating: Meets fully.**

The product answers the brief's core scenario: a frontline worker dumps a messy shift into a
box, the app structures it, and the human remains in control of what becomes real.

- Full loop works offline end-to-end: capture → extraction → review/edit → approve → plan →
  what-next → task actions → handover (`apps/web` + `apps/api`, `FakeAiProvider`).
- Deterministic planning (priority, dependencies, sequence, schedule, next) lives in
  `packages/domain`, is derived on every request, and is covered by table-driven tests
  (extraction 19, handover 18, schedule 16, priority 13, policy 12, time 11, next 8).
- Edge states are first-class: blocked/reopened tasks, cycles, overflow, unresolved
  deadlines, duplicate intents, failed extractions, degraded handover.
- Human-in-the-loop is enforced, not decorative: no AI output becomes a Task without
  explicit approval (`approveIntake`, transactional, atomic).

## 2. AI integration & evaluation

**Rating: Meets with gaps — the gap is the live call.**

- The integration itself is complete behind a 3-method interface
  (`packages/provider/src/types.ts`): real Claude adapter, versioned prompt
  (`shiftpilot.task-extract`/`claude-1`), structured output, full typed failure mapping,
  timeout abort, bounded retries, no silent fallback.
- The evaluation apparatus is complete and honest: 17-case corpus, gated live runner and
  smoke test, fixture provenance that is load-bearing, and a documented refusal to compute an
  accuracy percentage without ground truth.
- **Gap:** no live API call has been made (needs credentials). This dimension cannot be rated
  fully until `ANTHROPIC_LIVE=1 AI_PROVIDER=claude pnpm eval:claude` has run once. All
  offline substitutes are in place and tested.

## 3. Trust boundary & validation

**Rating: Meets fully.**

This is the dimension the product is built around, and it is the most heavily tested:

- Provider output is `unknown` at the boundary and never trusted: envelope read → zod
  (`.strict()`) → domain policy → clamping → normalization → dependency resolution →
  `ExtractionDraft` re-parse before persistence (`runExtraction`).
- Deadline phrases are verbatim; only `packages/domain/src/time.ts` resolves them, shift-
  local and DST-correct.
- The client cannot declare which provider ran; provenance is server-owned from provider
  metadata.
- Handover prose is drafted only from deterministic facts, and a narrative that invents a
  task id is rejected (`apps/api/src/handover.test.ts`).
- No raw user text is rendered as HTML; no key can reach a browser bundle.

## 4. Engineering quality

**Rating: Meets fully.**

- 258 tests / 20 files, all green in ~2 s, fully offline, no mocks of the domain, no
  `globalThis` hacks, in-memory SQLite for API tests, component tests for the web.
- Strict TypeScript, ESLint with `react-hooks/exhaustive-deps` as error, Prettier clean,
  tsup + vite builds green.
- CI: install → lint → typecheck → format → test → build → fresh-DB migration smoke →
  idempotent re-migrate. No secrets, no paid calls reachable.
- Migrations 0000–0004 apply on a fresh DB and re-apply idempotently (proved by CI).
- Layered architecture with a hard dependency rule; `packages/domain` has zero runtime deps.
- An adversarial audit pass (28 findings) was performed and its confirmed defects fixed with
  regression tests (`docs/implementation-plan.md` "Phase B").

**One acknowledged gap (non-blocking):** no coverage threshold in CI. Coverage is high and
visible, but a red-threshold is not enforced.

## 5. Documentation

**Rating: Meets fully.**

- `README.md`: quickstart, provider modes, trust model, cost controls, honest limitations.
- `docs/architecture.md`: problem analysis, data model, state machine, AI boundaries,
  validation pipeline, failure-case table, testing strategy.
- `docs/implementation-plan.md`: milestone-by-milestone build record including the audit.
- `docs/demo-script.md` / `docs/demo-seed-data.md`: reproducible offline demo.
- `docs/week1-submission-matrix.md`: this submission's own evidence ledger.
- Consistency was re-verified against the code on 2026-08-14 (the "handover prose" and
  "capture:fixtures" drift found in the final review was fixed in the same pass).

## 6. Demo

**Rating: Meets fully (offline).**

- Scripted 2–4 minute walkthrough, every step reproducible offline against the fake
  provider, zero cost, no credentials (see `docs/demo-script.md`).
- Covers the full value arc including rejection, editing, approval, dependency-aware
  planning, completion, replanning and handover.

## Overall

**Ready for external submission, pending one external action:** produce the live Claude
call (`R2`). Everything that is ours to control is done, verified and reproducible; the
single non-PASS row in the matrix requires only credentials, not code.
