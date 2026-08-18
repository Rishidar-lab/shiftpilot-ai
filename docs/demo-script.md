# Demo script — ShiftPilot (2–4 minutes)

Goal: show the value arc immediately, then prove the trust model. The default run is fully
offline on `FakeAiProvider` (no network, no key, no cost). A recording may optionally
exercise the **verified free OpenRouter route** for one extraction shot — never showing a
key, `.env`, or any credential on screen.

**Where to record.** Either works:

- **Local** — `pnpm dev` (api :8787, web :5173), or the production container on
  `http://localhost:8080`.
- **The deployed demo** — the live `*.onrender.com` URL once the service is running.

If you record against the deployed demo, three rules. **Wake it first:** free instances
spin down after inactivity and cold-start in roughly 30–60 seconds — open the URL, wait for
the app, and only then hit record, or the video opens on a spinner. **Never show the Render
dashboard**, its Environment tab, or any settings page: that is where the secret lives.
**Do not paste the full 11-line workload live on camera:** measured free-route latency for
that input is 42–129s and Cloudflare cuts a Render response off at ~100s, so the longest
runs cannot finish on the hosted URL. Record the real extraction locally (no proxy ceiling),
or use a shorter workload live and say plainly that the full dump is a free-tier stress case.

Prerequisites: seed block from `docs/demo-seed-data.md` ready to paste. No code and no
terminal with environment variables is scrolled on screen at any point.

## 0:00–0:20 — Problem

One breath: "Work arrives as a messy dump — deadlines, durations, interruptions, one
urgent call, two non-tasks buried in the middle. Whoever types that into a task list has
already done all the parsing and all the prioritising themselves." Paste the seed block
into the Intake tab and click **Extract tasks** while speaking.

## 0:20–0:35 — Principle

One sentence, shown on screen: **"AI interprets. Human verifies. Deterministic software
decides."** Point at the honest badge in the header — "Simulated AI · no real LLM" in the
offline run — "the same pipeline a real provider drives; the UI never pretends which one
it is."

## 0:35–1:05 — Extraction becomes structure

Show the review cards: the restock deadline hint verbatim ("11am"), the fridge check
marked **after the stocktake**, the urgent call flagged "urgent but no deadline", the
vague line and the non-task visibly flagged. "The model read the language; the structured
cards are re-validated by schema and policy, and the deadline words are resolved against
the shift's timezone by deterministic code — the AI never returns an instant."

## 1:05–1:30 — The human is in control

Three deliberate moves:

1. **Edit** the restock title to `Restock aisle 3` (deadline stays attached).
2. **Edit** the delivery chase — add a deadline around 10:00 and 20 minutes (the AI
   missed it; the human fixes it).
3. **Reject** "sort out the thing from yesterday" and "remember to smile more".

Then **Approve 9 task(s)**. "Nothing becomes a real task until a person approves it. The
AI proposes; the worker disposes."

## 1:30–2:00 — Deterministic planning

Open the **Plan** tab. Point at the **"Next up:"** card and read the reasons once:
"Restock first — deadline at 11am, high priority, nothing blocks it." Then: the fridge
check is **blocked by** the stocktake (a dependency edge, not an AI opinion), and the
**"Some tasks do not fit before the shift ends"** banner — ~520 minutes of work in a
480-minute shift. "The planner says the day does not fit instead of silently overloading
the worker."

## 2:00–2:20 — What Next

Complete **Restock aisle 3**. The "Next up:" card re-derives immediately, with the
machine-readable reason visible: the call to Mrs Chen is next (critical urgency).

## 2:20–2:40 — Replanning under interruption

**Block** the delivery chase with reason "courier ETA unknown". The plan reacts: blocked
work is not recommended anywhere. "Real shifts get interrupted; the plan recomputes from
facts, not vibes."

## 2:40–3:00 — Handover + degraded mode

Open the **Handover** tab. Two panels: **Facts** (counts, overdue, blocked — computed by
the deterministic domain) and **Narrative** (prose drafted only from those facts). "Even
if the model is offline, the facts render and the handover says so — degraded mode, not
a blank screen." (Optional +30 s: stop the API and show the **API unavailable** banner
with a retry button — no silent fallback.)

## 3:00–3:20 — Architecture, tests, links

Fast close with on-screen labels, no code: "Clean separation — the AI reads language, the
domain decides everything operational. Human approval is a hard gate. 311 tests, fully
offline CI, no secrets in CI. Monorepo: React + Fastify + SQLite, TypeScript strict."
Mention the live free-tier OpenRouter verification only if it fits the moment (see
"Recording with real AI" below). End on the one-liner: **"AI interprets. Human verifies.
Deterministic software decides."**

## Recording with real AI (optional)

- Default and safest: record fully offline in fake mode. The badge says "Simulated AI ·
  no real LLM" — say one line about the verified real route living in the repo
  (`docs/eval/results.md`, 16/16 corpus) instead of switching providers.
- If one real extraction is shown, run it via `pnpm dev` with
  `AI_PROVIDER=openrouter OPENROUTER_MODEL=<free-model>:free` and **prefer an explicitly
  configured, verified `:free` model** (e.g. `google/gemma-4-26b-a4b-it:free`) for
  reproducible results. `openrouter/free` is the mandated smoke alias and passes, but its
  underlying model varies per request, so outcomes are less predictable on camera.
- **Never display** the API key, `.env`, terminal history, or any HTTP headers/authorization
  material on screen. The key lives only in the environment.
- If the real route rate-limits mid-recording, cut to fake mode with the honest badge —
  that is itself the failure-path story.

## Failsafes

- If a step's exact disposition differs from the seed doc, follow the seed doc's "why"
  column — the demo's narrative depends on review actions being visible, not on any single
  draft's fate.
- Everything is deterministic and offline: re-create the shift, paste the block, get the
  same drafts, warnings and plan every time (`docs/demo-seed-data.md`).
