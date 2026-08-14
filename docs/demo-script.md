# Demo script — SHIFT PILOT (2–4 minutes, offline)

Goal: show the full value arc in the first 30 seconds, then prove the trust model.
Runs on `FakeAiProvider` — no network, no key, no cost. Prerequisites:
`pnpm dev` running (api :8787, web :5173) and the seed block from
`docs/demo-seed-data.md` ready to paste.

## 0:15 — Cold open

Point at the badge: **"Simulated AI · no real LLM."** One sentence:
"This app runs with a simulated model for the demo — the same code path a real
Claude provider drives, and the UI never hides which one it is."

## 0:15–0:40 — Messy input becomes structure

Click **New shift (today, 09:00–17:00)**, open the **Intake** tab, paste the seed block,
click **Extract tasks**.

While it runs: "Eleven lines of real shift chatter — deadlines, durations, a dependent
task, one urgent call, two items that are not tasks."

Show the result: structured cards, the restock deadline hint verbatim ("11am"), and the
fridge check marked **after the stocktake**.

## 0:40–1:15 — The human is in control

Three deliberate moves on the review cards:

1. **Edit** the restock title to `Restock aisle 3` (deadline stays attached).
2. **Edit** the delivery chase — add a deadline around 10:00 and 20 minutes (AI missed it).
3. **Reject** "sort out the thing from yesterday" and "remember to smile more" —
   "vague / not a task."

Then click **Approve 9 task(s)**.

One sentence: "Nothing becomes a real task until a person approves it. The AI proposes;
the worker disposes."

## 1:15–1:45 — The duplicate guard

Paste `Restock aisle 3` again and extract: **"Rejected by validation
(duplicate_candidate)"** — a re-captured chore cannot double up against tasks that already
exist.

## 1:45–2:20 — Deterministic planning

Open the **Plan** tab. Point at the **"Next up:"** card and read the reasons aloud once:
"Restock first — deadline at 11am, high priority, and nothing blocks it."

Then:

- The fridge check is **blocked by** the stocktake (dependency edge, not AI opinion).
- The **"Some tasks do not fit before the shift ends"** banner: ~520 minutes of work in a
  480-minute shift. The planner flags the day does not fit instead of silently overloading
  the worker.

## 2:20–3:00 — Execute, then replan

Complete **Restock aisle 3**. The "Next up:" card re-derives immediately — the same click
on the call to Mrs Chen (critical urgency). Then **block** the delivery chase with reason
"courier ETA unknown" and watch the plan react: blocked work is not recommended.

## 3:00–3:30 — Handover

Open the **Handover** tab. Two panels:

- **Facts** — counts, overdue, blocked: computed by the deterministic domain, never by AI.
- **Narrative** — prose drafted from those facts only.

Close with: "Even if the model is offline, the facts render and the handover says so —
degraded mode, not a blank screen."

## Failsafes

- Provider failure demo (optional, +30 s): with the API stopped, the UI shows the
  **API unavailable** banner with a retry button — no silent fallback, no blank screen.
- If a step's exact disposition differs from the seed doc, follow the seed doc's "why"
  column — the demo's narrative does not depend on a specific draft's fate, only on the
  review actions being visible.
