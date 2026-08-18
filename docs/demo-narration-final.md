# ShiftPilot — final demo narration (word-for-word)

Target length **3:00–3:20**. Conversational, technical, no hype. Read it as written; the
bracketed lines are screen actions, not spoken.

- **Primary workload (locked — paste exactly):**

  ```
  Do the stocktake in the back room by 2pm, 30 minutes.
  Then check the fridge temperature after the stocktake, 10 minutes.
  Call the supervisor urgently about the delivery, 15 minutes.
  ```

- **Rehearsal result (18 Aug 2026):** live route returned HTTP 201 in ~52s with three
  candidates — stocktake (deadline 2pm, 30 min), fridge check (10 min, **depends on** the
  stocktake), supervisor call (15 min, **high urgency**). All the beats below are real.
- **Do not** paste the eleven-line stress workload in the recording.

---

## 0:00–0:15 — Opening

[SCREEN: ShiftPilot landing page, already awake.]

> "ShiftPilot is an AI-assisted workload planner built around one rule: AI interprets,
> humans verify, and deterministic software decides."

> "Instead of asking a language model to directly run a shift, ShiftPilot only uses AI where
> language understanding is actually useful."

## 0:15–0:30 — Create the shift

[SCREEN: click "Open today's shift →", then "Create today's shift" — the Shift Setup dialog
opens. Show date, start, end, timezone.]

> "I'll create a shift with real working hours and the local timezone. ShiftPilot resolves
> deadlines against this shift context rather than asking the model to invent timestamps."

[SCREEN: click "Start shift".]

## 0:30–0:50 — Input

[SCREEN: paste the three-line primary workload into the composer.]

> "This is deliberately messy natural language — a deadline, durations, an urgent item, and
> one task that depends on another."

[SCREEN: click "Build my shift".]

> "The raw workload is saved before the AI call, so a provider failure doesn't lose the
> worker's input."

[If the run takes a moment — it can be up to a minute on the free route:]

> "The free AI route can take several seconds, and ShiftPilot shows that state rather than
> pretending the model is instant."

[Do not sit silently while it runs — the pipeline stages are on screen; you can name them:
"saving the input… interpreting… checking the structure… preparing review."]

## 0:50–1:20 — Human review

[SCREEN: the review candidates.]

> "The model's output isn't trusted as operational truth. These are candidate tasks."

[SCREEN: point at the stocktake's 2pm deadline, the durations, the high-urgency call, and
the fridge check marked as waiting on the stocktake.]

> "It read the 2pm deadline, the durations, the urgency, and that the fridge check comes
> after the stocktake — a dependency, not just an order."

[SCREEN: edit one field — e.g. nudge the supervisor call's duration, or confirm the
stocktake deadline.]

> "I can correct the interpretation right here."

[These three are all genuine tasks, so there's nothing to reject. If a run ever returns a
non-task line, reject it here — don't force one just for the camera.]

> "And nothing becomes an active task until I explicitly approve it."

[SCREEN: check the tasks, click "Approve … tasks".]

## 1:20–1:55 — Plan + What Next

[SCREEN: click the Plan tab. Pause on the "Next up:" hero.]

> "From here, the language model is no longer deciding the workflow."

> "The planner resolves deadlines, dependencies, priority, capacity, and the next action
> using deterministic code."

[SCREEN: click a scheduled task to expand "Why this position" / the technical reasoning.]

> "This reason is computed from the planner's actual factors — it isn't an explanation the
> AI wrote after the fact."

## 1:55–2:20 — Complete + replan

[SCREEN: on the What Next task, click Start, then Mark done (or the appropriate action).]

> "When state changes, ShiftPilot recomputes the plan from the new facts. Replanning doesn't
> need another model opinion."

[SCREEN: pause so the new "Next up:" task is clearly visible before moving on.]

## 2:20–2:45 — Handover

[SCREEN: click the Handover tab.]

> "At handover, the verified operational facts still come from the database and deterministic
> state."

[If the AI summary is available:]

> "The AI can turn those facts into readable prose, but that prose is optional and separately
> labelled."

[If it's unavailable — don't wait for it:]

> "And even when the AI summary isn't available, the verified handover facts stay usable."

## 2:45–3:05 — Engineering proof

[SCREEN: a clean closing frame — the GitHub README, or ShiftPilot's own trust section. Keep
any code on screen under ~10 seconds.]

> "Under the surface: a typed API boundary, human approval as a hard gate, deterministic
> scheduling, failure-safe provider handling, 320 automated tests, CI, and a live Render
> deployment."

## 3:05–3:15 — Close

[SCREEN: back to ShiftPilot.]

> "AI interprets. Human verifies. Deterministic software decides."

> "That's ShiftPilot."

[Stop recording.]

---

## Five moments the final video must contain

1. The live / simulated-AI identity is visible (the header badge).
2. AI output shown as reviewable candidates.
3. A human edit and the explicit approval.
4. What Next with a deterministic, openable reason.
5. Replan after completion, and the handover facts.

## Mode A (live) vs Mode B (deterministic fallback)

- **Mode A — live**, on https://shiftpilot-rkmx.onrender.com. Use it when the pre-record
  health check and one rehearsal behave normally (they did on 18 Aug). Expect the AI step to
  take up to ~a minute; narrate the wait, don't cut it awkwardly.
- **Mode B — deterministic fallback**, local/production build on `AI_PROVIDER=fake`. The
  header badge reads **"Simulated AI · no real LLM"** — leave it visible. If you use Mode B,
  say once: _"The live OpenRouter route is separately verified in the public repository and
  deployment evidence. For this deterministic walkthrough I'm using ShiftPilot's offline
  provider so the recording is reproducible."_ Never present fake output as live AI.
- **Provider-failure rule:** if the live route returns `503 ai_unavailable` or repeated
  free-tier failures, stop retrying and switch to Mode B. Do not change providers or code.
  The video is mandatory; waiting hours on a free route is not.

## Pre-record checklist (30 seconds)

- Wake the site; wait for the landing page to load fully; then wait ~30s more.
- Confirm `/api/health` shows `providerIsFake: false` for Mode A.
- Close unrelated tabs. No Render dashboard, no OpenRouter dashboard, no terminal with
  credentials, no `.env`, no GitHub settings, notifications off/Do-Not-Disturb.
- Desktop ~1440 wide if possible; 1080p; narration audible; no long dead silence.
- Duration ~2:45–3:30. No secret ever on screen. No fake presented as real.
