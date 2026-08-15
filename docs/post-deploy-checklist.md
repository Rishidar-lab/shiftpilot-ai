# Post-deploy checklist — ShiftPilot

Run this once, in a browser, immediately after the first production deploy. It is the same
path `docs/demo-script.md` walks, plus the persistence checks a local run cannot prove.

Takes about five minutes. Seed text is in `docs/demo-seed-data.md`.

**Before you start:** close any terminal, `.env` file, secret manager tab, or provider
console. No credential should be on screen at any point — this is also a rehearsal for
recording the demo.

| #   | Step                              | What must happen                                                                                                                                               |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open the production URL           | The app renders. No blank page, no spinner that never resolves                                                                                                 |
| 2   | Check the UI shell                | Header, "Shift" card, and the provider badge. The badge tells the truth: "Simulated AI · no real LLM" only if `AI_PROVIDER=fake`                               |
| 3   | `GET /api/health`                 | `{"status":"ok",…}`. `providerIsFake` matches the `AI_PROVIDER` you configured                                                                                 |
| 4   | Create a shift                    | "New shift (today, 09:00–17:00)" → the shift appears and is selected                                                                                           |
| 5   | Paste the demo intake             | The messy block from `docs/demo-seed-data.md` goes into the textarea                                                                                           |
| 6   | Extract                           | A loading state, then reviewable candidates. On OpenRouter this is the real call — it may take a few seconds                                                   |
| 7   | Review an edit                    | Change a title (e.g. to "Restock aisle 3"); the field accepts it                                                                                               |
| 8   | Reject candidates                 | Untick "sort out the thing from yesterday" and "remember to smile more"                                                                                        |
| 9   | Approve the rest                  | "Approve N task(s)" succeeds; the count matches what you left ticked                                                                                           |
| 10  | Plan tab                          | A sequenced plan with priority bands, dependency waits, and the capacity warning                                                                               |
| 11  | What Next                         | A "Next up" recommendation **with its reasons** — not a bare title                                                                                             |
| 12  | Complete a task                   | "Mark done" succeeds                                                                                                                                           |
| 13  | Replan                            | The recommendation moves to a different task                                                                                                                   |
| 14  | Handover tab                      | Deterministic facts render. "Write AI summary" produces prose, **or** a labelled degraded banner — both are correct outcomes                                   |
| 15  | Refresh the page                  | Everything is still there. This proves the data was written, not just held in browser state                                                                    |
| 16  | Verify within-session persistence | Re-open the shift; tasks, statuses and completions are unchanged                                                                                               |
| 17  | Restart the service               | Render dashboard → **Manual Deploy → Restart**                                                                                                                 |
| 18  | Verify the reset is clean         | On Render Free the shift is **gone** — expected. The app must still load and create a new shift normally. (On a volume-backed deploy, it must instead survive) |

## What counts as a failure

- A blank page, an endless spinner, or a raw stack trace on screen.
- Step 3 reporting a provider you did not configure — the deploy did not pick up its
  environment.
- Step 14 showing prose that mentions a task, number or time that is not in the facts below
  it. The narrative is validated against the facts server-side, so this should be impossible;
  if it happens, it is a real bug and worth reporting.
- Step 18 showing an error page, a failed migration, or an app that cannot create a shift
  after the restart. Losing the _data_ is expected on Render Free and is not a failure —
  losing the _ability to work from empty_ is.

## If step 6 fails on OpenRouter

Free routes share global quotas, so a 429 is normal, not a bug. The UI shows a typed error
and the raw text is already saved — retry, or switch that deploy to `AI_PROVIDER=fake` for
the demo. There is deliberately no automatic paid fallback: a rate-limited free route fails
rather than spending money.
