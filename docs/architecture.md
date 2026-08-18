# SHIFT PILOT — Architecture

Status: M3 complete — live external AI verified on the OpenRouter free tier only
(`docs/eval/results.md`, 16/16 corpus + handover, Aug 2026). Claude adapter remains
implemented but unexercised (no Anthropic credential has ever been used here). ·
Last updated: 2026-08-15
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
│  ├── use-cases/      captureIntake · approveIntake · getIntake ·   │
│  │                    getPlan · generateHandover                   │
│  ├── db/             Drizzle schema · better-sqlite3 (WAL, sync)   │
│  └── repos/          typed query modules (shifts, intake, tasks…)  │
├─────────────────────────── packages/provider ──────────────────────┤
│  AiProvider interface · FakeAiProvider (heuristic, isFake) ·       │
│  fixtures · ShiftContext · timeout/retry policy (API-side)         │
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

| Action                          | Path                                                                                                                                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture text                    | route → `captureIntake` use case → **persist `raw_inputs` (durability first)** → provider.extract (timeout-wrapped) → `runExtraction` pipeline (§6) → persist `extraction_drafts` + report → respond with `RawInput` (status `review_required`/`partially_approved`/`failed`) |
| Approve intake                  | route → `approveIntake` use case → in a transaction, map each accepted draft to an M1 `Task` (+dependencies) → mark `raw_inputs` `approved` → respond with created task ids                                                                                                   |
| Priority/sequence/next/schedule | pure domain engines over persisted task rows — **no provider call**                                                                                                                                                                                                           |
| Handover (M3)                   | use case → domain builds facts from DB → (future) provider.composeHandover(facts) → validate → persist → respond; M2 handover view renders deterministic facts only                                                                                                           |
| Edit task                       | route → use case → state machine check → optimistic lock → update → re-derive plan                                                                                                                                                                                            |

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
Shift      id · date(ISO date) · startAt(ISO) · endAt(ISO) · timezone(IANA) · role
           createdAt(ISO)
Task       id · shiftId · title · category(enum) · estimatedMinutes(1–480|null)
           deadlineAt?(ISO) · deadlineSource(manual|parsed|unresolved)
           explicitUrgency(none|low|medium|high|critical)
           status(draft|active|in_progress|blocked|completed|cancelled)
           dependsOn[](predecessor ids) · blockReason? · notes?
           createdAt · updatedAt · completedAt?
```

M1 persists **shifts + tasks + task_dependencies**. M2 adds **`raw_inputs`** (every captured
natural-language blob, with status `received | processing | review_required |
partially_approved | approved | failed`) and **`extraction_drafts`** (the per-candidate
review state keyed by `raw_input_id + draft_id`). Persisted `Handover` rows are M3 territory.
The schedule, sequence, next-decision, and handover **facts are derived projections** —
computed on demand by domain engines, never persisted. This eliminates stale-plan bugs by
construction: the plan shown is always a pure function of current task state plus "now".

### Time semantics (shift-local, explicit)

A shift is a **local-time** concept. "Before close" and "by 2pm" mean 2pm where the worker
stands — not 2pm UTC, and not 2pm in whatever zone the server happens to run in. Each shift
therefore stores an IANA `timezone` (defaulting to the server's zone at creation time), and
`packages/domain/src/time.ts` is the **only** module that converts a human phrase into an
instant:

| Phrase                                    | Resolves to                                        |
| ----------------------------------------- | -------------------------------------------------- |
| `eod`, `end of shift/day`, `before close` | the shift's `endAt`                                |
| `2pm`, `2:30 pm`, `14:00`                 | that wall clock on the shift date, in its zone     |
| `noon`, `morning`, `afternoon`, `evening` | 12:00 / 09:00 / 15:00 / 18:00 local                |
| `in 30m`, `in 2 hours`                    | measured from `now`                                |
| `tomorrow 9am`                            | 09:00 local on the following date                  |
| anything else                             | **unresolved** — flagged for review, never guessed |

DST is handled by measuring the zone's offset at the candidate instant and correcting once,
so 14:00 London is 13:00Z in August and 14:00Z in January. Providers never do this
arithmetic: they return the phrase, the domain owns the calendar.

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

Bucket: **≥55 critical · ≥35 high · ≥15 medium · else low** (`PRIORITY.bucket*` in
`packages/domain/src/constants.ts` is authoritative). The reason breakdown is returned
with every ranked task and rendered as human text (`"overdue by 1h05m · customer-facing · unblocks 2 tasks"`).

### Sequence engine

- Build the task DAG from `dependencyIds`.
- Kahn topological sort; tie-break: priorityScore ↓, deadline ↑, createdAt ↑, id ↑.
- **Cycles**: detect strongly-connected components >1 (and self-loops); mark all members
  `inCycle`, sequence them by priority instead, and surface a warning. The engine never
  mutates `dependencyIds` on its own — cycles are reported, user decides.

### Schedule projection (used by plan view and "what next")

From the **effective planning start** to shift end: walk the sequence, `start = max(planStart,
prevEnd)`, `end = start + estimateMin`. The planning start is `now` clamped to the shift's own
bounds (`time.ts:effectivePlanningStart`): before the shift it is `shiftStart`, during the
shift it is `now`, after the shift the window is empty. Planning therefore never runs against
pre-shift wall-clock time — a 09:00–17:00 shift viewed at 02:55 has 480 minutes of capacity
and its first task at 09:00, not 845 minutes and a task at 02:54. Capacity (`availableMinutes`)
and "what next" derive from the same clamped start, so they can never disagree. Tasks that do
not fit before shift end are flagged `overflow` (explicit), and the plan recommends revisiting
them — **never silently dropped or re-prioritized**.

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
- `POST /api/shifts/:shiftId/tasks` · `GET /api/shifts/:shiftId/tasks` · `GET /api/tasks/:id`
- `PATCH /api/tasks/:id` (state-machine transition + field edits, validated by `checkTransition`)
- `POST /api/tasks/:id/block` (reason required)
- `GET /api/shifts/:id/plan` (full `WorkPlan`) · `GET /api/shifts/:id/next` (`NextDecision`) ·
  `GET /api/shifts/:id/handover` (`HandoverFacts`)

Intake routes (M2): `POST /api/shifts/:shiftId/intake` (rate-limited + size-capped) ·
`GET /api/intake/:id` · `POST /api/intake/:id/approve`.

Persistence: SQLite + Drizzle (`better-sqlite3`, WAL, `foreign_keys=ON`), tables `shifts` /
`tasks` / `task_dependencies` (PK `task_id+depends_on_id`, self-loop `CHECK`) / `raw_inputs`
(FK → `shifts`) / `extraction_drafts` (PK `raw_input_id+draft_id`, FK → `raw_inputs`),
migrations applied at boot and via `pnpm db:migrate`. Note: `tasks.shift_id` and
`task_dependencies` carry **no** SQL foreign key — same-shift and existence constraints on
dependency edges are enforced in the use-case layer (`checkDependencies`), which is what
returns a typed 422 instead of a raw constraint error. Persisted handovers land in M3.

## 5. AI provider boundaries

### Interface (the only AI surface in the codebase)

The provider is deliberately narrow: it converts messy natural-language text into
untrusted candidate JSON. It never reads persisted tasks, never sets priority, never
mutates state. Every operational decision happens later in the deterministic pipeline.

```ts
// packages/provider/src/types.ts
type ProviderFailure =
  | { kind: "timeout" }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "quota" }
  | { kind: "network"; message: string }
  | { kind: "invalid_response"; detail: string }
  | { kind: "budget_exceeded" }

interface AiProviderMeta {
  id: string
  label: string
  isFake: boolean // declared by the implementation, never inferred from `id`
  promptId: string
  promptVersion: string
}

interface AiProvider {
  readonly meta: AiProviderMeta // a property, not a method
  extractTasks(input: string, ctx: ShiftContext, signal?: AbortSignal): Promise<ExtractionAttempt>
  generateHandover(facts: HandoverFacts, signal?: AbortSignal): Promise<HandoverAttempt>
}
```

`signal` exists so the API's timeout can **abort** an in-flight request instead of merely
giving up on it — an unaborted call keeps spending quota after we stop caring.

Two implementations:

- **`FakeAiProvider`** — deterministic regex/heuristic extractor (line splitting, category
  and urgency keywords, duration parsing, `#n` + free-text dependency references). It
  reports deadline **phrases verbatim** (`deadlineHint: "by 3pm"`) and deliberately performs
  no date arithmetic: resolving a phrase to an instant is domain policy
  (`packages/domain/src/time.ts`), so this provider and the Claude provider cannot
  disagree about what the same words mean. `isFake: true`, `label` is the honest string
  `"Fake (offline heuristic) — simulated, not a real LLM"`, and `promptVersion` is recorded
  (`"fake-1"`) so every extraction is traceable to the exact heuristic. It supports
  `forcedFailure` injection for testing the failure path. It is a full implementation, not a
  stub: dev/demo/tests exercise the real extraction + review pipeline end-to-end offline.

- **`ClaudeProvider`** (`packages/provider/src/claude.ts`) — the real provider, built on the
  official Anthropic TypeScript SDK. It is an adapter and nothing more: it sends the
  versioned prompt plus the worker's text and returns whatever JSON came back as untrusted
  `raw`. It does no date arithmetic, applies no domain policy, and has no authority over
  application state. `isFake: false`, `model` is the configured identifier, and
  `promptVersion` identifies the exact instructions used.

**Structured output, still untrusted.** The request pins `output_config.format` to a JSON
schema mirroring `ExtractionCandidate`, which is the strongest practical constraint the SDK
offers. The response nonetheless passes the entire §6 pipeline unchanged — the schema is a
way to get well-shaped input more often, not a reason to stop validating. `ExtractionCandidate`
stays `.strict()`: an unexpected field is a per-candidate rejection, not a weakened contract.

**Handled response failures:** safety refusal (`stop_reason: "refusal"`), truncation
(`max_tokens`), empty body, non-JSON text, plus the transport failures below. Each becomes a
typed `ProviderFailure`, never an exception and never a partially-parsed object.

**Failure mapping** (SDK error → `ProviderFailure` → API code):

| SDK error                                                         | Failure                          | API                       |
| ----------------------------------------------------------------- | -------------------------------- | ------------------------- |
| `APIConnectionTimeoutError`, `APIUserAbortError`                  | `timeout`                        | 503 `ai_unavailable`      |
| `RateLimitError` (429)                                            | `rate_limited` (+`retryAfterMs`) | 503 `ai_unavailable`      |
| `AuthenticationError` (401), `PermissionDeniedError` (403)        | `unauthorized`                   | 503 `ai_unavailable`      |
| 400/403 with a `billing_error` type                               | `quota`                          | 402 `ai_budget_exceeded`  |
| `BadRequestError` (400), `NotFoundError` (404, e.g. bad model id) | `misconfigured`                  | 503 `ai_unavailable`      |
| `APIConnectionError`, 5xx/529, anything unrecognised              | `network`                        | 503 `ai_unavailable`      |
| refusal / truncation / empty / non-JSON                           | `invalid_response`               | 502 `ai_invalid_response` |

Operator-caused failures (`unauthorized`, `misconfigured`) surface as "the AI provider is not
correctly configured on the server" — the provider's own message is not echoed to the client.

**Configuration** (`apps/api/src/config.ts`, all fail-fast at boot): `ANTHROPIC_API_KEY` and
`ANTHROPIC_MODEL` are **required** when `AI_PROVIDER=claude` and have no defaults;
`ANTHROPIC_MAX_OUTPUT_TOKENS`, `ANTHROPIC_MAX_RETRIES` and an optional `ANTHROPIC_EFFORT`
tune cost. Selecting `claude` without credentials refuses to start rather than degrading to
the offline provider — a silent downgrade would let simulated output pass for a model's.

### Prompt versioning

The prompt lives in `packages/provider/src/prompt.ts`, never inline at a call site, and
exports `EXTRACTION_PROMPT_ID` + `EXTRACTION_PROMPT_VERSION` (v3 for both extraction and
handover, with the JSON schema embedded and a raw-JSON mandate). Both are persisted
on every `raw_inputs` row, so any extraction can be traced to the exact instructions and
output contract that produced it. The version bumps on any change to either.

The prompt states the contract, not the domain rules: it deliberately does not describe
priority weights or deadline vocabulary, which would invite the model to pre-compute things
the domain owns. It requires verbatim deadline phrases, permits duration inference **only**
when flagged as inferred, and treats the worker's text as data — but the application is
correct even when the model ignores all of it.
This keeps the contract surface honest: there is no code path that silently pretends to be
Claude. The `AiProvider` interface and `ShiftContext` are structured so a real provider can
be dropped in later without touching the domain, the API, or the UI.

### Isolation discipline

- The provider returns **raw, untrusted** candidate objects. The shaped/validated/deduplicated
  result is produced entirely by `runExtraction` in `packages/domain/src/extraction.ts`.
- Per-request timeout is enforced at the API layer (`AI_TIMEOUT_MS`, default 30 s) around the
  provider call; a timeout or any `ProviderFailure` becomes a typed `ProviderError` and the
  `raw_inputs` row is persisted with status `failed` before any of this happens (durability
  first).
- Raw user text is never interpolated into a free-text generation target and never rendered
  as HTML in the web app (escape at render).

### Live activation status

Implemented and live-verified (Week 1): the provider boundary, the versioned prompt
(v3), structured output, failure mapping, cost controls, offline contract tests, the
evaluation corpus, and gated tooling. The **OpenRouter route is verified on the free
tier only**: a one-request smoke test returned HTTP 2xx against `openrouter/free`, and a
controlled evaluation ran the full 16-case corpus plus handover 16/16 on
`google/gemma-4-26b-a4b-it:free`, with every request guarded by
`assertFreeOpenRouterModel` (free ids only; paid models rejected; no paid fallback).
Reports and sanitized evidence: `../eval/results.md`, `../eval/verification-summary.md`,
and `packages/provider/fixtures/extraction/recorded-*.json` (labelled
`"source": "recorded"`, each carrying configured and resolved model).

The **Claude adapter is implemented but unexercised**: no live Claude request has been
made from this repository, and no Anthropic credential has ever been used here. Running
it requires credentials:

```sh
ANTHROPIC_LIVE=1 ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=<id> pnpm eval:claude
```

Both this and `pnpm smoke:claude` refuse to run without the explicit opt-in flag, so
neither `pnpm test` nor CI can ever trigger a paid call. `FakeAiProvider` remains the
default for CI, dev and demos: no code path requires a key for the product to work.

## 6. Structured-output validation (the trust boundary)

The pipeline is `runExtraction(req)` in `packages/domain/src/extraction.ts` — a sequence of
pure functions; each stage has tests and adversarial fixtures. No stage is skipped depending
on provider. AI output is treated as **untrusted input** — identical posture to any other
network payload.

```
 raw provider output (untrusted, `unknown`)
   │ 1. envelope read        — { tasks: [...] } | bare array | object with .tasks;
   │                           anything else → report-level warning + zero drafts
   ▼
 zod ExtractionCandidate    — PASS 1 over every item; unknown keys or bad types →
   │  (contracts, .strict)     per-item rejection (malformed_provider_output), never fatal
   ▼
 domain policy (pure)       — PASS 2: title non-empty ≤120; estimate 1–480; duplicate
   │                           detection against batch + existing non-cancelled titles
   ▼
 deadline normalization     — resolve the verbatim `deadlineHint` against the shift's DATE
   │  (time.ts, shift-local)   and IANA TIMEZONE: "before close"→shift end, "2pm"→14:00
   │                           local, "in 30m"→now+30m, "tomorrow 9am". Unrecognised →
   │                           unresolved + review flag; never guessed
   ▼
 dependency resolve         — over the FULL batch, so forward and backward references both
   │                           resolve; ambiguous/unresolved refs flagged for review
   ▼
 contract guard             — each draft is re-parsed through ExtractionDraft before it can
   │                           be persisted; anything unrepresentable is downgraded to a
   │                           rejected draft rather than escaping the pipeline
   ▼
 ExtractionReport           — { rawInputId, provider, promptVersion, generatedAt,
   │                           drafts: ExtractionDraft[], warnings: string[] }
   ▼
 persist drafts + status    — ONE transaction; the raw_inputs row was already persisted
   ▼                           BEFORE the AI call (durability first)
 HUMAN REVIEW               — the API returns drafts with disposition accepted|needsReview|
                              rejected, a typed `rejectionReason`, and human-readable
                              `reasons`. Approval REFUSES rejected drafts. The AI never
                              writes a Task.
```

`ExtractionReport` is UI-visible and its exact shape lives in `packages/contracts`:
`{ rawInputId, provider, promptVersion, generatedAt, drafts, warnings }`. Per-draft state is
carried on each `ExtractionDraft`: `disposition` (accepted | needsReview | rejected), a typed
`rejectionReason` from `ExtractionRejectionReason` (`missing_title`, `duplicate_candidate`,
`invalid_duration`, `invalid_deadline`, `deadline_before_shift`, `ambiguous_dependency`,
`unresolved_reference`, `oversized_input`, `malformed_provider_output`), the verbatim
`deadlineHint`, and human-readable `reasons`.
Partial success is a first-class result — the worker approves what survived; the UI shows
every draft, editable, with accept/reject toggles. "3 of 5 extracted, 2 skipped: unknown
extra field 'owner:'" is honest, not hidden.

Retry policy: full-shape/schema failures → immediate `failed` (the heuristic fake does not
auto-retry; a real provider would retry ≤2 at the API layer). After failure: status `failed`,
raw text retained, UI offers "re-extract" (same pipeline).

Handover narrative output is validated at prose level: must not exceed caps; any task title
or ID in the draft not present in the facts set is stripped (see
`normalizeHandoverNarrative` in `packages/domain/src/handover.ts`); the deterministic fact
panels are rendered by the client from `facts`, never from model prose.

> Note: the `claude` provider is implemented but no **live** call has been made, so the
> live-retry/recorded-fixture drift evidence described earlier is deferred to M3. The
> `FakeAiProvider` path is fully tested, and the recorded-fixture path is exercised by the
> fixture integrity tests.

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

| Layer                                                                    | Approach                                                                                                                                                                                                                   | Requirements          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Domain (priority, sequence, schedule, state machine, normalizer, policy) | pure unit tests, table-driven; adversarial cases (cycles, overdue, empty, overflow)                                                                                                                                        | ≥90% line coverage    |
| Validation pipeline                                                      | `packages/domain/src/extraction.test.ts`: good/empty/garbage output · unknown keys · duplicates · forward+backward dependency resolve/ambiguous · policy rejections · untrusted-string clamping · deadline resolution      | ≥90% line coverage    |
| Provider boundary                                                        | `FakeAiProvider` unit tests (`packages/provider/src/fake.test.ts`) covering heuristic extraction, verbatim deadline hints (no date arithmetic), dependency parsing, ambiguity flags, failure injection, and `meta` honesty | every case green      |
| API routes + use cases                                                   | Fastify `app.inject()` over in-memory SQLite: capture/get/approve happy + failure paths (timeout → 503, invalid response → 502, budget → 402, 404, 409), identity mismatch, rejected-draft approval, rate limit + size cap | ≥80% line coverage    |
| Repos                                                                    | integration against temp-file SQLite (and `:memory:`)                                                                                                                                                                      | covered via API tests |
| Web                                                                      | `client.test.ts` typed-decode tests + component tests (`@testing-library/react`, jsdom) for loading/error/retry surfaces, task actions, draft review and provider-badge honesty                                            | behaviour-level       |
| Live Claude                                                              | not present — the real provider is M3; no test in this repo can make a paid call                                                                                                                                           | n/a until M3          |
| E2E (later week)                                                         | Playwright happy path: capture → review → approve → complete → handover                                                                                                                                                    | optional stretch      |

CI (GitHub Actions): install → lint → typecheck → **format** → test → build, plus a
fresh-database migration smoke test (apply to an empty file, then re-apply to prove
idempotence). Secrets are never needed and no job can make a paid API call. Coverage
thresholds are **not** enforced yet — that gate is still open (see §10 M5/H-01); the suite
is behaviour-driven rather than percentage-driven today.

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
│   ├── contracts/             # zod schemas + types (shared SOT) — incl. M2 intake schemas
│   ├── domain/                # deterministic engines · extraction.ts (pipeline) · time.ts (shift-local clock)
│   └── provider/              # AiProvider · FakeAiProvider (heuristic) · fixtures · ShiftContext
└── apps/
    ├── api/                   # Fastify · use-cases · db (Drizzle/better-sqlite3) · repos · config
    │   ├── use-cases/intake.ts  # captureIntake · getIntake · approveIntake
    │   ├── repos/{intake,task,shift}.ts
    │   ├── routes/intake.ts
    │   └── drizzle/000{1,2}_*.sql  # raw_inputs + extraction_drafts migrations
    └── web/                   # React + Vite SPA · typed API client · components
        ├── api/client.ts        # zod-decode at boundary · IntakeResult/ApprovalResult
        └── components/{IntakeView,PlanView,HandoverView,FakeProviderBadge}.tsx
```

Colocated tests (`*.test.ts` next to source). No barrel `index.ts` files in multi-module
directories (tree-shaking + import hygiene).

## 10. MVP vs stretch

### Milestones (build order)

- **M0** Scaffold — done.
- **M1** Contracts + domain engines (priority, sequence, schedule, state machine, normalizer,
  explain, handover-facts) — done. Plans are derived, never persisted; transparent priority.
- **M2** AI-backed intake: `FakeAiProvider` behind one interface · `runExtraction` validation
  pipeline in domain · `raw_inputs` + `extraction_drafts` persistence · `captureIntake` /
  `getIntake` / `approveIntake` use cases + routes · web intake→review→approve UI · typed
  degraded/offline surfaces (fake-provider badge, error banners). **Done.** The AI is fully
  isolated: it only produces untrusted candidates; humans approve before any `Task` exists.
- **M3** Live `claude` provider behind the existing interface (+ handover prose, recorded
  fixtures/drift test) — **not started**. This is the remaining Week-1 blocker: no real AI
  call happens anywhere in the repo today.
- **M4** Web polish — **partially present**: intake/review/approve, plan with task state
  actions and re-derived planning, handover facts, explicit loading/error/retry states,
  labelled controls and keyboard focus. Interrupted-replan assist and voice capture are not
  built.
- **M5** Hardening, docs, demo — **partially present**: adversarial audit remediated
  (integrity, AI trust boundary, shift-local time, cost controls), CI gates aligned, docs
  reconciled. `scripts/demo.md` + `scripts/seed.ts` (H-02) and coverage thresholds (H-01)
  are not done.

`AI_PROVIDER=fake` makes the whole product runnable and demoable with zero cost and no key.
Selecting `claude` is a clear boot-time error until M3 lands the real provider.

MVP delivers capabilities 1–9 of the brief: capture, extraction, priority, dependencies,
sequence, daily plan (timetable projection), what-next, persistence, safe validation — all
against the offline provider. `claude` activation, AI handover prose and handover storage
are M3.

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

- ~~Timezone handling~~ — **resolved**: shifts carry an IANA `timezone` and all deadline
  resolution is shift-local (§4 "Time semantics"). Still open: per-user zone selection in the
  UI (today the creating browser's zone is used) and shifts that cross midnight.
- Multi-device sync conflicts beyond optimistic locking (defer; MVP conflict = 409 + reload).
- Choice of model/version behind `ANTHROPIC_MODEL` (defer until live integration; the repo
  deliberately ships no default model id).
- Monetary budget enforcement: the app can throttle requests but cannot read an account
  balance, so a currency cap must be set in the Anthropic console (documented in README).
- Whether "breaks" deserve their own planning (defer; represent as tasks).
