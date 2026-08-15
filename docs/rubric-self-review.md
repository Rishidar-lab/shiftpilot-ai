# Week 1 Rubric Self-Review — ShiftPilot

Scoring is deliberately conservative: a dimension is only rated fully when its evidence is
reproducible from this repository by a reviewer who trusts nothing the author says. Where a
rubric dimension overlaps the submission matrix, the matrix is the source of truth.

The rubric's seven dimensions are scored against the verified state of 2026-08-15
(commit `804a027` + final docs pass; 283 tests / 21 files green; live OpenRouter
free-tier verification recorded in `docs/eval/`).

---

## 1. Technical implementation (max /25)

**Claim: 22/25.**

| Requirement                      | Evidence                                                                                                                                      | Score |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Full workflow runs end-to-end    | Capture → persist → extract → review → approve → plan → what-next → task actions → handover, offline and live (`apps/web` + `apps/api`)       | 6/6   |
| Deterministic domain engines     | Priority, scheduling, dependencies, time, what-next, handover in `packages/domain` (zero runtime deps, table-driven tests)                    | 6/6   |
| Real AI integration with a guard | OpenRouter free-tier only; `assertFreeOpenRouterModel` enforced at config, construction and per-request; no paid fallback (regression-tested) | 5/5   |
| Human-in-the-loop enforced       | No task exists without explicit approval; transactional, atomic, duplicate-refused                                                            | 5/5   |
| **Losses**                       | No auth/multi-user isolation; single-process SQLite; in-process rate limiter (documented Week-1 scoping)                                      | −3    |

## 2. AI/ML understanding (max /20)

**Claim: 17/20.**

- Trust boundary is the product's spine: untrusted output → zod → policy → normalization →
  shift-local resolution → human approval (`docs/architecture.md` §5–6). 6/6
- Prompt engineering is deliberate: versioned v3 prompts with embedded JSON contract, raw
  JSON mandate, worker text fenced as data; injection case in corpus + recorded fixture. 4/4
- Honest evaluation discipline: 16-case corpus, per-case outcomes recorded, no invented
  accuracy percentage, resolved-model reporting, contrast runs kept (alias 8/16, 429
  recovery) — `docs/eval/`. 4/4
- Live evidence: smoke HTTP 2xx + 16/16 controlled run on `google/gemma-4-26b-a4b-it:free`,
  six recorded fixtures. 3/3
- **Losses**: the verified route is free-tier OpenRouter (a capable `:free` model); the
  Claude adapter is unexercised; no benchmark-grade methodology (no ground truth, no
  statistical sample) — kept honest by design, still a limitation. −3

## 3. Problem solving & design (max /15)

**Claim: 14/15.**

- Core insight is sound and defended: "AI interprets. Human verifies. Deterministic software
  decides." — every "smart" decision computed by tested engines, model never sets priority. 5/5
- Hard problems solved: deadline resolution shift-locally with IANA timezones; dependency
  chains incl. forward refs and cycles; overflow flagging; degraded handover; prompt
  injection as data; duplicate intents; failure durability (raw input persisted first). 5/5
- Adversarial audit executed (28 findings, fixes with regression tests). 4/4
- **Loss**: stretch items (distributed limiter, owner-scoped shifts) are design notes, not
  code. −1

## 4. Code quality & GitHub (max /15)

**Claim: 12/15.**

- Strict TypeScript, ESLint (hooks rules as errors), Prettier clean, tsup + vite builds
  green; layered architecture, `packages/domain` zero runtime deps. 5/5
- 283 tests / 21 files, fully offline, in-memory SQLite, no `globalThis` mocks; CI runs all
  gates + fresh-DB migration + idempotent re-migrate with no secrets. 5/5
- Repo hygiene: `.gitignore` correct, `.env.example` only, secret scan (working tree, index,
  history) clean, no `dist`/`node_modules`/DBs tracked. 2/3
- **Losses**: repo is not yet public (external action); no coverage threshold in CI; no
  LICENSE file (owner's choice, deferred to publication); private commit history not yet
  reviewed by a third party. −3

## 5. UI/UX (max /10)

**Claim: 9/10.**

- Honest provider badge ("Simulated AI · no real LLM", from provider metadata); explicit
  loading/error/retry states; editable review cards with source spans and ambiguity flags;
  machine-readable "why" on What Next; degraded handover labelled; responsive layout,
  labelled controls, live regions. 9/9
- **Loss**: no recorded demo video yet; no polished screenshot set in the repo
  (placeholders in README). −1

## 6. Documentation (max /10)

**Claim: 10/10.**

- README (quickstart, modes, trust model, OpenRouter verification, cost controls,
  limitations), `docs/architecture.md`, `docs/implementation-plan.md` (milestones + audit),
  `docs/demo-script.md` + `docs/demo-seed-data.md`, `docs/interview-defense.md`,
  `docs/rubric-self-review.md`, `docs/week1-submission-matrix.md`, `docs/eval/*` (reports +
  evidence), `CLAUDE.md`. Re-verified consistent with code on 2026-08-15.

## 7. Communication (max /5)

**Claim: 4/5.**

- One-line invariant repeated everywhere; demo script has a timed narrative; interview
  defense answers every likely question; LinkedIn draft ready with placeholders.
- **Loss**: no recorded demo or published post yet (external actions) — the deliverable
  that proves spoken communication is pending.

---

## Overall

**Claimed total: 88/100.** Every claimed point is backed by code, tests, or recorded
evidence in this repository. The four remaining losses are all external actions — public
repo, demo video, LinkedIn post, final submission — plus the honest limitations of
free-tier-only verification. The self-score is intentionally not higher: the free route's
model variability, the unexercised Claude adapter, and the missing auth/multi-user
isolation are real gaps, and the submission should not pretend otherwise.
