# Demo seed data — SHIFT PILOT

One scenario, fully offline, zero cost, no credentials. Used by `docs/demo-script.md`.
The app runs on `FakeAiProvider` (default): extraction is a transparent heuristic, and the
exact dispositions shown for each line are the deterministic ones a reviewer will see —
nothing here depends on a live model.

## Setup

```sh
pnpm dev        # api :8787 + web :5173
```

Open http://localhost:5173. Create the shift with **New shift (today, 09:00–17:00)**.
The badge in the header should read **Simulated AI · no real LLM** — that is the honest
label for what the demo is.

## The scenario

A customer-service/stockroom worker starts a shift with a messy dump of what is in their
head: deadlines, durations, one dependent task, one urgent call, one vague item, one
non-task, and two heavy jobs that will not fit the day.

## First intake — the paste block (copy verbatim into the Intake textarea)

```
Restock aisle 3 by 11am - takes about 45 minutes
Submit the safety report by 3pm, 30 minutes
Check the fire exits before noon, 20 minutes
Do the stocktake in the back room - 90 minutes
Then check the fridge temperature after the stocktake, 15 minutes
Call Mrs Chen about her order - urgent
Chase the delivery that should've arrived yesterday - holding up the counter
sort out the thing from yesterday
remember to smile more
Deep clean the back room - 3 hours
Full inventory recount at end of day - 2 hours
```

## What the app should show (the deterministic outcome)

| Line                                 | Expected draft                                                                        | Why                            |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------ |
| Restock aisle 3 by 11am              | Restock aisle 3 … · deadline hint `11am` · 45 min · **high priority in plan**         | deadline + duration parsed     |
| Submit the safety report by 3pm      | safety report · deadline `3pm` · 30 min · category `admin`                            | deadline + duration            |
| Check the fire exits before noon     | fire exits · deadline `noon` · 20 min · category `safety`                             | named time + keyword category  |
| Stocktake in the back room           | stocktake · 90 min · **no deadline**                                                  | plain line                     |
| fridge check **after the stocktake** | fridge check · 15 min · **depends on the stocktake**                                  | free-text dependency           |
| Call Mrs Chen — urgent               | Mrs Chen call · **critical urgency, flagged "urgent but no deadline"**                | the demo's real ambiguity flag |
| Chase the delivery                   | delivery chase · no deadline, no estimate → **you add a deadline + 20 min in review** | shows review edits             |
| sort out the thing from yesterday    | vague task → **you reject it**                                                        | human says "not actionable"    |
| remember to smile more               | non-task → **you reject it**                                                          | human filters noise            |
| Deep clean back room                 | 3 hours                                                                               | heavy job                      |
| Full inventory recount at end of day | 2 hours · deadline `end of day`                                                       | heavy job                      |

Total estimated minutes ≈ **520** (plus one un-estimated call) against a 480-minute shift →
the Plan view shows the **"Some tasks do not fit before the shift ends"** banner. That is
the point: the plan says the day does not fit, and the worker decides.

## Review actions (steps 1–3 in the demo script)

1. **Edit** the restock title to just `Restock aisle 3` (drop the deadline/duration
   clutter; the deadline stays attached via its own field).
2. **Edit** the delivery chase: add a deadline around 10:00 and 20 minutes.
3. **Reject** "sort out the thing from yesterday" and "remember to smile more".
4. **Approve 9 task(s)**.

## Second intake — the duplicate guard

After approval, paste exactly:

```
Restock aisle 3
```

The pipeline flags it: **Rejected by validation (duplicate_candidate) — a task with this
title already exists**. Duplicate detection runs against existing actionable tasks, so a
recaptured chore cannot double up.

## Save points

The scenario supports three "pause here" states, each independently reproducible:

1. **After extraction** — review cards + ambiguity flag visible (review step).
2. **After approval** — nine active tasks; Intake tab still shows the approved intake.
3. **After second intake** — duplicate visibly rejected (dedupe guard).

## Re-running

Everything is deterministic and offline: re-create the shift and paste the block again.
The same drafts, warnings and plan come back every time.
