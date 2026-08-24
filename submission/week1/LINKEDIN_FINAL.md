# Week 1 LinkedIn Post — Final Draft (ShiftPilot)

**Status: content final.** The demo video is now real and public (GitHub
Release `week1-demo-v1`); the resulting LinkedIn post URL is the one
remaining placeholder — it cannot exist until this is actually published.
Canonical source this was finalized from: `docs/linkedin-post.md` (kept in
place; this file is the publication-ready copy for the four-week
submission set).

---

**ShiftPilot — my Week-1 build for the Innovation Hacks AI Internship 2026**

Frontline and operational workers usually receive their work as a messy
text dump — deadlines, durations, interruptions, one urgent item, a couple
of non-tasks buried in the middle. Typing that into a task list just moves
the parsing and prioritizing work onto the human.

ShiftPilot turns that dump into an ordered, explainable work plan, under
one rule I designed the whole system around:

**AI interprets. Human verifies. Deterministic software decides.**

The reason that split exists: an LLM is good at pulling structure out of
messy text — durations, dependencies, an urgent flag, a deadline phrase —
but it is not a reliable place to put the actual scheduling decision.
Priority ordering, deadline math, dependency resolution, and "what should I
do next" all need to be the same answer every time given the same state,
auditable, and immune to a model having an off day. So:

- **AI extraction is real and live** — OpenRouter, free tier only, guarded
  by a hard free-model check on every request; there is no paid fallback,
  ever.
- **Humans hold the power** — every extracted candidate is a draft.
  Nothing becomes an operational task until a person edits, rejects, or
  approves it. `approveIntake()` is the only place a task row is ever
  created.
- **Scheduling is deterministic** — priority, ordering, deadlines
  (shift-local, timezone-aware), dependency graphs (with real cycle
  detection), and end-of-shift handover are all computed by tested,
  pure domain functions. The model never sets a priority and never
  touches the schedule.
- **Failure is designed, not hidden** — invalid model output, a
  rate-limited route, or a provider outage degrades gracefully and
  honestly. The app never pretends the AI is on when it isn't.

Stack: TypeScript strict, React + Vite, Fastify, SQLite (Drizzle), Zod,
pnpm monorepo, Vitest — 341 tests, fully offline CI, no secrets in CI.

GitHub: https://github.com/Rishidar-lab/shiftpilot-ai
Live demo: https://shiftpilot-rkmx.onrender.com
Demo video: https://github.com/Rishidar-lab/shiftpilot-ai/releases/tag/week1-demo-v1

#InnovationHacks #AIInternship2026 #AIEngineering #TypeScript
**[ADD OFFICIAL INNOVATION HACKS TAG/HANDLE/URL IF the program specifies one beyond the hashtag]**

---

## Publishing checklist (do not skip)

- [x] Replaced the demo-video placeholder with the real, publicly-verified release URL above (unbranded — no intro/outro asset exists; disclosed in `FINAL_VIDEO_QA.md`, not hidden).
- [ ] Wake the free Render instance before sharing the live-demo link (open it once so the first visitor doesn't hit a cold-start spinner).
- [ ] Keep the exact claims as written: controlled verification, not a benchmark; no accuracy percentage claims; no "production-ready" language; free tier only.
- [ ] Do not publish while any link above is still a placeholder.
- [ ] Record the resulting post URL in `submission/FINAL_SUBMISSION_MATRIX.md` once published.
