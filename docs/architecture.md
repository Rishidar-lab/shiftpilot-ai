# SHIFT PILOT — Architecture

Status: Week 1 baseline · Last updated: 2026-08-12
Companion docs: `../CLAUDE.md` (rules), `./implementation-plan.md` (tasks).

---

## 1. Problem analysis

Frontline and operational workers — shift leads, ward nurses, retail floor staff, warehouse
leads, facilities teams — plan work in **shifts**, not projects. They capture tasks in the
messiest possible way (voice notes, group chats, back-of-hand scribbles), get pulled off tasks
constantly by interruptions, work against real deadlines ("restock before close", "cold chain
check by 14:00"), and carry work across shift boundaries.

Existing tools fail them for structural reasons:

- **Project tools** (Todoist, Asana, Notion) assume stable projects, tags, and desktop use.
  Their capture flow is form-first, not mess-first. A worker who pastes
  `aisle 3 empty, ck cold chain @2, call mrs chen re discharge, new guy training 30min, counts
before close` gets five requirements: parse the fields, cut the abbreviations, resolve
  domain vocabulary ("before close"), and infer effort.
- **Priorities drift.** Interruptions invalidate plans. The valuable output is not a static
  list, it is a re-sequenced plan plus one answer: _"what should I do next, and why."_
- **Handover is unpaid overtime.** End-of-shift summaries are written by hand at the worst
  moment of the day. Most shifts leak information instead.

The core insight that shapes the architecture: **a shift plan is a deterministic artifact
built from structured facts; the LLM is valuable for extracting those facts from noise, not
for deciding what the facts mean.** Every "smart" decision (priority, order, next action,
overflow) is therefore computed by deterministic, testable engines. The model never sets
priority directly.

## 2. Target users and workflows

### Personas

| Persona                   | Context                                                                      | Primary need                                                                |
| ------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Shift lead (primary)      | Retail/warehouse/ward shift owner; 10–30 tasks/shift; interrupted constantly | Capture fast, be told the next best action with a reason, hand over cleanly |
| Shift worker              | Executes assigned work, reports status                                       | See what's due and what the lead left unfinished                            |
| Shift manager (secondary) | Review handovers across a week                                               | Trustworthy facts, not LLM-flavored fiction                                 |

### Core workflow (MVP scope)

1. **Open shift** — date, start/end time, role. Provides the context window every downstream
   step resolves against ("before close" = shift end, "2pm" = this shift's date).
2. **Capture** — paste/type the messy dump (text or voice-transcript style). One call.
3. **Extract & review** — system returns validated task drafts + an extraction report showing
   what was skipped and why. User edits titles, estimates, deadlines, categories inline.
4. **Approve plan** — drafts atomically become the active plan (single transaction).
5. **Execute** — mark done, block, cancel, add tasks, bump urgency. Each change re-derives
   the sequence. "What next?" is available on demand (or auto-suggested after each change).
6. **Handover** — one tap produces the end-of-shift summary: facts from the database, prose
   drafted by the model, validated before display.

Out of scope for MVP (see §10): auth/multi-user, calendar sync, voice capture hardware,
export. These are engineering-visible extensions, not architecture changes.

## 3. Architecture

```
┌───────────────────────────── apps/web ─────────────────────────────┐
│  React + Vite · typed API client (zod-decode) · error surfaces     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP/JSON (CORS-locked to CORS_ORIGIN)
┌───────────────────────────── apps/api ─────────────────────────────┐
│  Fastify · routes (thin) → use cases (orchestration)               │
│  ├── config.ts       zod-validated env, fail-fast at boot          │
│  ├── use-cases/      captureInput · approvePlan · updateTask ·     │
│  │                    getPlan · generateHandover                   │
│  ├── db/             Drizzle schema · better-sqlite3 (WAL, sync)   │
│  └── repos/          typed query modules (shifts, inputs, tasks…)  │
├─────────────────────────── packages/provider ──────────────────────┤
│  AiProvider interface · ClaudeProvider · FakeProvider · fixtures   │
│  · tool JSON schema · prompt builders · retry/timeout policy       │
├─────────────────────────── packages/domain ────────────────────────┤
│  PURE · zero runtime deps                                           │
│  validation-policy · normalize (deadline vocab, defaults) ·        │
│  priority · sequence (DAG/Kahn) · schedule projection ·            │
│  handover-facts · state machine · explain                      │
├─────────────────────────── packages/contracts ─────────────────────┤
│  zod schemas + inferred types (shared source of truth)             │
└─────────────────────────────────────────────────────────────────────┘
```

### Dependency rule

Dependencies point inward: `web → api` (HTTP), `api → contracts, domain, provider, db`.
`domain` and `contracts` have no knowledge of HTTP, AI, or storage. `provider` imports
`contracts`, `domain` (types only). Nothing imports `@anthropic-ai/sdk` outside `provider`.

### Decision flow (what talks to what)

| Action                          | Path                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture text                    | route → `captureInput` use case → persist input (durability first) → provider.extract → validation pipeline (§6) → persist drafts+report → respond |
| Priority/sequence/next/schedule | pure domain engines over persisted task rows — **no provider call**                                                                                |
| Handover                        | use case → domain builds facts from DB → provider.composeHandover(facts) → validate → persist → respond                                            |
| Edit task                       | route → use case → state machine check → optimistic lock → update → re-derive plan                                                                 |

### Why this shape

- **Testability**: domain engines are dependency-free and 100% deterministic; the AI boundary
  has a fake twin; API tests run against in-memory SQLite. The test pyramid is real, not
  aspirational.
- **Change resistance**: swapping models, prompts, or providers is configuration plus edits
  inside one package. Domain decisions never change when the model does.
- **Cost control**: exactly two provider calls per shift in the happy path (capture, handover).
  Nothing else touches the paid API. Deterministic fallbacks keep the product working without
  a key.
- **Honest failure**: every provider failure is a typed error with UI presence. Fake-provider
  mode is a _real_ degraded implementation, so the product is demoable offline — not a stub.

## 4. Domain and data models

All shapes defined once in `packages/contracts` (zod), inferred types reused everywhere.
SQLite columns use snake_case (`packages/api/src/db/schema.ts` mirrors contracts).

### Entities

All shapes live in `packages/contracts` as zod schemas (the single source of truth); the API
mirrors them into snake_case SQLite columns (`apps/api/src/db/schema.ts`).

```
Shift      id · date(ISO date) · startAt(ISO) · endAt(ISO) · role · createdAt(ISO)
Task       id · shiftId · title · category(enum) · estimatedMinutes(1–480|null)
           deadlineAt?(ISO) · deadlineSource(manual|parsed|unresolved)
           explicitUrgency(none|low|medium|high|critical)
           status(draft|active|in_progress|blocked|completed|cancelled)
           dependsOn[](predecessor ids) · blockReason? · notes?
           createdAt · updatedAt · completedAt?
```

`RawInput` and persisted `Handover` rows are M2/M3 territory (capture pipeline + handover
storage). M1 persists **shifts + tasks + task_dependencies** only; the schedule, sequence,
next-decision, and handover **facts are derived projections** — computed on demand by domain
engines, never persisted. This eliminates stale-plan bugs by construction: the plan shown is
always a pure function of current task state plus "now".

### Task lifecycle (explicit state machine, enforced in domain)

```
draft ──approvePlan──▶ active ──▶ in_progress ──▶ completed
 │                      │  ▲          │
 │                      ▼  └──────────┘ (reopen)
 └──(discard)          blocked ◀──(reason required)──┘
   (re-extract)      blocked ──▶ active (unblock)
   active ──▶ cancelled · in_progress ──▶ cancelled
```

`transitionAllowed(from, to)` is a pure function with a unit-tested matrix. Cycle/broken
dependencies automatically surface `blocked` on downstream tasks (status write is a side
effect the plan projection reports; the engine recommends, the UI confirms).

### Priority engine (deterministic)

Score = sum of weighted components (no clamp cap in M1); **every component is attributable** so
the UI can explain "why this task is next". Weights are module-level constants in
`packages/domain/src/constants.ts`, tuned by table-driven tests (see §8). The explicit
`explicitUrgency` enum **replaces** the original `overrideBias` number: a transparent,
categorised user signal rather than an opaque ±50 knob.

| Component          | Range     | Rule                                                                                          |
| ------------------ | --------- | --------------------------------------------------------------------------------------------- |
| Overdue            | +50 fixed | task past `deadlineAt` (alone can reach the critical bucket)                                  |
| Deadline proximity | 0–40      | `40·(1 − min(minutesLeft,480)/480)` clamped ≥ 0. No deadline → 0                              |
| Explicit urgency   | 0–40      | critical 40 · high 25 · medium 12 · low 0 · none 0                                            |
| Unblocks others    | 0–20      | `min(20, 5 × outDegree)` — tasks unblocking others rise                                       |
| Category weight    | 0–12      | compliance/safety 12 · customer 10 · walkthrough 8 · training 6 · other 5 · admin 4 · break 1 |
| Waiting credit     | 0–5       | `min(5, hoursSinceCapture)` — stale tasks creep up, saturate fast                             |
| Quick task         | +3        | estimate ≤15m                                                                                 |
| Continuity (next)  | +15       | already `in_progress` — keep the worker productive                                            |

Bucket: **≥55 critical · ≥35 high · ≥20 medium · else low**. The reason breakdown is returned
with every ranked task and rendered as human text (`"overdue by 1h05m · customer-facing · unblocks 2 tasks"`).

### Sequence engine

- Build the task DAG from `dependencyIds`.
- Kahn topological sort; tie-break: priorityScore ↓, deadline ↑, createdAt ↑, id ↑.
- **Cycles**: detect strongly-connected components >1 (and self-loops); mark all members
  `inCycle`, sequence them by priority instead, and surface a warning. The engine never
  mutates `dependencyIds` on its own — cycles are reported, user decides.

### Schedule projection (used by plan view and "what next")

From `now` to shift end: walk the sequence, `start = max(now, prevEnd)`, `end = start +
estimateMin`. Tasks that do not fit before shift end are flagged `overflow` (explicit), and
the plan recommends revisiting them — **never silently dropped or re-prioritized**.

### "What should I do next?"

Runnable candidates: `active|in_progress`, dependencies completed, not cancelled. If a task is
already `in_progress` and still runnable, continuity bonus (+15) keeps the worker productive.
Otherwise pick the highest-scoring runnable task. Answer shape:
`{ taskId, title, startBy, reasons: [3 explainable factors], unblocks: N, dueInMin? }`.
This path is pure domain computation — instant, free, deterministic.

### Handover facts (domain-owned)

Computed from DB rows: completed count and est. minutes, pending by priority bucket, blocked
list with blocker titles, flags (overdue, unresolved deadlines, cycles, overflow), next-shift
recommendations (high-priority incomplete + blocked items). The model drafts prose around
these facts (§5); the facts themselves are never LLM-generated — **no fabricated metrics by
construction**.

### M1 API surface (implemented)

All routes are prefixed with `/api` (bare `/health` is a probe). Planning endpoints are pure
domain projections recomputed per request; `?now=<ISO>` overrides the clock for deterministic
replay/tests. Errors use the unified envelope `{ error: { code, message, details? } }`.

- `POST /api/shifts` · `GET /api/shifts` · `GET /api/shifts/:id`
- `POST /api/shifts/:shiftId/tasks` · `GET /api/tasks/:id`
- `PATCH /api/tasks/:id` (state-machine transition + field edits, validated by `checkTransition`)
- `POST /api/tasks/:id/block` (reason required)
- `GET /api/shifts/:id/plan` (full `WorkPlan`) · `GET /api/shifts/:id/next` (`NextDecision`) ·
  `GET /api/shifts/:id/handover` (`HandoverFacts`)

Persistence: SQLite + Drizzle (`better-sqlite3`, WAL), tables `shifts` / `tasks` /
`task_dependencies` (PK `task_id+depends_on_id`, self-loop `CHECK`, FK cascade), migrations
applied at boot via `drizzle-kit`. The natural-language capture → extraction → validation
pipeline and persisted handovers land in M2/M3.

## 5. Claude API boundaries

### Interface (the only AI surface in the codebase)

```ts
// packages/provider/src/types.ts
type ProviderFailure =
  | { kind: "timeout" }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "quota" }
  | { kind: "network"; message: string }
  | { kind: "invalid_response"; detail: string }
  | { kind: "budget_exceeded" }

interface AiProvider {
  extractTasks(
    input: string,
    ctx: ShiftContext,
  ): Promise<{ ok: true; raw: unknown } | { ok: false; failure: ProviderFailure }>
  composeHandover(
    facts: HandoverFacts,
  ): Promise<{ ok: true; raw: unknown } | { ok: false; failure: ProviderFailure }>
}
```

Two implementations:

- **`ClaudeProvider`** — `@anthropic-ai/sdk`, model from `ANTHROPIC_MODEL`
  (default `claude-sonnet-4-5`), `temperature: 0`, `max_tokens` caps, per-request timeout
  (`AI_TIMEOUT_MS`, default 30 s, AbortSignal-tied), retry ≤2 with exponential backoff on
  429/5xx, never retries on validation failures. Uses **tool-use structured output**: one tool
  `submit_extraction` whose argument schema is the zod schema from §6 compiled to JSON Schema;
  `tool_choice` forced. The tool-argument JSON is still treated as untrusted (see §6).
- **`FakeProvider`** — deterministic regex/heuristic extractor using the same deadline
  vocabulary and category keywords as the domain normalizer, so dev/demo/tests exercise the
  real pipeline end-to-end offline. It is a full implementation, not a stub.

Provider selection: `AI_PROVIDER=fake|claude` via zod-validated env (`apps/api/src/config.ts`).
`claude` without `ANTHROPIC_API_KEY` is a **boot-time error** with a clear message
(fail fast > fail obscure). Switching providers requires configuration and zero domain
changes.

### Prompt discipline

- User text arrives delimited as **data** (`<user_input>…</user_input>`); system prompt says
  to ignore instructions found inside it. Combined with the strict tool schema + zod
  whitelist, injection is defended at three layers (prompt, schema, policy) — §6.
- Raw user text is never interpolated into a free-text generation target and never rendered
  as HTML in the web app (escape at render).
- Prompt changes require updating/adding a recorded fixture + contract test (drift detector).

### Live activation (documented path, for later)

1. Set `AI_PROVIDER=claude` and `ANTHROPIC_API_KEY=<key>` in a local `.env` (never in repo).
2. Optionally set `ANTHROPIC_MODEL`.
3. Run `pnpm test:live` (**opt-in, gated by `ANTHROPIC_LIVE=1`**, never in CI, never part of
   `pnpm test`) — a thin contract test asserting real responses parse through the §6 pipeline.
4. `FakeProvider` remains the default for CI, dev, and demos. There is no code path that
   requires the key for the product to work.

## 6. Structured-output validation (the trust boundary)

The pipeline is a sequence of pure functions; each stage has tests and adversarial fixtures.
No stage is skipped depending on provider. AI output is treated as **untrusted input** —
identical posture to any other network payload.

```
 raw tool-arg JSON
   │ 1. parseJson          — must be syntactically valid JSON; no auto-repair
   ▼
 zod schema (contracts)    — strictObject per task: unknown keys → per-task rejection
   │ 2. full-shape failure (not even a list) → retry ≤2 with corrective feedback
   ▼
 domain policy (pure)      — title non-empty ≤120; estimate 5–480; ≤25 tasks; non-empty
   │                         result; duplicate detection (similarity ≥0.85)
   ▼
 normalization (pure)      — resolve deadline hint against ShiftContext via vocabulary
   │                         ("before close"→shift end, "2pm"→shift date 14:00, "in 30m",
   │                         "EOD", weekday names…); category default; estimate defaults
   │                         per category; dependency refs remapped to accepted task ids
   ▼
 ExtractionOutcome         — { status:"ok", tasks: ValidTaskDraft[], report: ExtractionReport }
                              | { status:"failed", code, report }
   ▼
 persist drafts + report   — raw input row already persisted BEFORE the AI call (durability)
```

`ExtractionReport` is UI-visible: `totalFound`, `accepted`, `skipped: [{ key, reason }]`
(reasons: invalid_title, unknown_extra_fields, duplicate, past_deadline_hint, bad_reference,
size_exceeded). Partial success is a first-class result — the worker approves what survived;
"3 of 5 extracted, 2 skipped: unknown extra field 'owner:'" is honest, not hidden.

Retry policy: full-shape/schema failures → ≤2 retries with corrective feedback appended to
the tool result; policy-level per-task skips do **not** retry (wasteful, usually futile).
After retries: status `failed`, raw text retained, UI offers "re-extract" (same pipeline).

Handover output is validated at prose level: must not exceed character/token caps; any task
title or ID in the draft that does not exist in the facts set is stripped/replaced; the
deterministic fact panels are rendered by the client from the stored `facts` json, never from
model prose.

## 7. Failure cases

| #   | Case                                          | Detection                          | UX / recovery                                                                                       |
| --- | --------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Provider timeout                              | timeout error from provider        | Extraction fails cleanly; input retained with status `failed`; "re-extract" button; banner explains |
| 2   | Rate limit / quota                            | typed failure                      | Same as above; handover falls back to deterministic template with `degraded: true` label            |
| 3   | Invalid JSON / wrong shape ×2                 | pipeline stage 1–2                 | `failed` + report; re-extract; raw text never lost                                                  |
| 4   | Per-task policy rejections                    | stage 3                            | Partial success; report shows skipped + reasons; UI shows all                                       |
| 5   | Prompt injection in user text                 | schema whitelist + policy          | Input treated as data; at worst a weird title; no elevation ever                                    |
| 6   | Unresolvable deadline hint ("next leap day")  | normalizer                         | Task created, `deadlineSource=unresolved`, surfaced flag; user sets it later                        |
| 7   | Dependency cycle                              | SCC detection                      | Tasks flagged `inCycle`; priority fallback order; warning, editable by user                         |
| 8   | Past deadline at capture ("at 2pm" after 2pm) | state+now                          | Kept, flagged overdue, prioritized correctly (40/40) — worker may mean "do now"                     |
| 9   | More work than shift                          | schedule projection                | Overflow flags, honest recommendation; nothing silently dropped                                     |
| 10  | Crash between input save and AI call          | input status `processing`          | Recovered on retry; input is durable before any AI work                                             |
| 11  | Concurrent edits (two tabs)                   | optimistic lock (`updatedAt` ETag) | `409 conflict`; client refreshes and re-applies                                                     |
| 12  | Nothing runnable                              | engine                             | "next" returns explicit empty state (`reason: blocked_by                                            | empty`), not an error |
| 13  | Provider misconfigured                        | boot-time env validation           | Server refuses to start with clear message                                                          |
| 14  | AI-generated metrics                          | impossible by construction         | Facts come from DB; model only drafts prose                                                         |

No case is a silent no-op. Every failure is typed at the layer it occurs and mapped to a
stable API error code: `validation_error · not_found · conflict · ai_unavailable ·
ai_invalid_response · ai_budget_exceeded · internal`.

## 8. Testing strategy

Vitest across workspaces. **All tests run offline** — no network, no keys, no paid APIs.

| Layer                                                                    | Approach                                                                                                                                                                                                          | Requirements          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Domain (priority, sequence, schedule, state machine, normalizer, policy) | pure unit tests, table-driven; adversarial cases (cycles, overdue, empty, overflow)                                                                                                                               | ≥90% line coverage    |
| Validation pipeline                                                      | fixture corpus `apps/api/fixtures/extraction/`: valid-rich · empty · garbage JSON · unknown keys · >25 tasks · injection-attempt text · truncated output                                                          | ≥90% line coverage    |
| Provider boundary                                                        | `FakeProvider` in unit tests; **recorded fixtures** (`fixtures/anthropic/*.json`) shaped like real Claude tool responses — contract tests assert every fixture passes the pipeline (prompt/schema drift detector) | every fixture green   |
| API routes + use cases                                                   | Fastify `app.inject()` over in-memory SQLite, fake provider: happy path per endpoint + every failure path in §7 + state-machine matrix                                                                            | ≥80% line coverage    |
| Repos                                                                    | integration against temp-file SQLite (and `:memory:`)                                                                                                                                                             | covered via API tests |
| Web                                                                      | component tests for review table, error banner, degraded states (Testing Library); typed client decode tests                                                                                                      | smoke-level           |
| Live Claude                                                              | `pnpm test:live`, **gated by `ANTHROPIC_LIVE=1` + key**, never in CI                                                                                                                                              | opt-in                |
| E2E (later week)                                                         | Playwright happy path: capture → review → approve → complete → handover                                                                                                                                           | optional stretch      |

CI (GitHub Actions): install → lint → typecheck → test → build. Secrets are never needed
for CI. Coverage thresholds are enforced in the same CI run.

## 9. Repository structure

```
shift-pilot/
├── CLAUDE.md                  # architecture + rules + commands + DoD
├── docs/
│   ├── architecture.md        # this file
│   └── implementation-plan.md # GitHub-sized tasks, milestones
├── .env.example               # placeholders only — never credentials
├── .gitignore                 # .env, data/, dist/, node_modules/
├── pnpm-workspace.yaml
├── tsconfig.base.json         # strict, project references
├── package.json               # root scripts: dev/test/typecheck/lint/build
├── packages/
│   ├── contracts/             # zod schemas + types (shared SOT)
│   ├── domain/                # pure engines, zero runtime deps
│   └── provider/              # AiProvider · ClaudeProvider · FakeProvider · fixtures
└── apps/
    ├── api/                   # Fastify · use-cases · db (Drizzle/better-sqlite3) · repos · config
    │   ├── fixtures/extraction/…
    │   └── test/live/…        # ANTHROPIC_LIVE-gated
    └── web/                   # React + Vite SPA · typed API client · components
```

Colocated tests (`*.test.ts` next to source). No barrel `index.ts` files in multi-module
directories (tree-shaking + import hygiene).

## 10. MVP vs stretch

### Week-1 MVP (the full requirement set, ranked by build order)

M0 Scaffold · M1 contracts+domain engines · M2 provider + validation pipeline · M3
persistence + API · M4 web UI (capture → review → approve → plan/next → handover, typed error
surfaces, degraded banners) · M5 hardening, docs, demo script. Each milestone is a set of
GitHub-sized issues — see `docs/implementation-plan.md`.

MVP delivers capabilities 1–10 of the brief: capture, extraction, priority, dependencies,
sequence, daily plan (timetable projection), what-next, handover, persistence, safe
validation. `AI_PROVIDER=fake` makes the whole product runnable and demoable with zero cost.

### Stretch (later weeks, architecture-ready)

- Timeline/Gantt visualization of the schedule projection
- Voice input via Web Speech API → same capture pipeline
- Interruption re-planning assist ("I got pulled for 40 minutes") → replay projection
- Task history + undo (append-only events) — enables "why did priority change" audits
- PDF/WhatsApp handover export; calendar export
- Multi-worker shifts with assignment
- Auth + multi-user isolation (schema is shift-keyed already)
- Error observability (request ids, provider latency metrics) — real, measured metrics only

## 11. Key decisions at a glance (rationale for the interview)

1. **LLM supplies facts, code decides.** Priority/sequence/next are deterministic engines —
   decision paths are testable, explainable, and cheap. The model's remaining job is
   extraction and prose, where it is strong and hallucination is contained by schema+policy.
2. **Provider behind one interface with a real fake.** Product works offline, tests are
   deterministic, and Claude activation is config, not code.
3. **Validation as a pipeline of pure functions**, audit-trailed via ExtractionReport —
   "AI output is untrusted input" is enforced structurally, not by convention.
4. **Derived plans, not stored plans.** Schedule/sequence are projections of task state —
   stale-plan bugs impossible by construction; "what next" is always fresh.
5. **SQLite + better-sqlite3, typed schema (Drizzle), WAL.** Single-user MVP; synchronous
   driver keeps transactions trivially correct; migration path exists (real SQL) if the data
   outgrows it.
6. **Unified error envelope and typed error unions.** Every failure has a code, a UI
   surface, and (where sensible) a recovery button.
7. **Explicit degraded modes.** No silent fallbacks: handover without AI is a labelled
   template; overflow is flagged, never dropped; pending deadlines are flagged, never
   fabricated.
8. **No fabricated metrics.** All numbers in the UI come from the database via domain code.

## 12. Open questions / consciously deferred

- Timezone handling (MVP: single-server local time, documented; shifts carry their date
  explicitly).
- Multi-device sync conflicts beyond optimistic locking (defer; MVP conflict = 409 + reload).
- Choice of model/version behind `ANTHROPIC_MODEL` (defer until live integration).
- Whether "breaks" deserve their own planning (defer; represent as tasks).
