# Week 1 LinkedIn Post — Final Draft (ShiftPilot)

**Status: content final.** The demo video is now real and public (GitHub
Release `week1-demo-v1`); the resulting LinkedIn post URL is the one
remaining placeholder — it cannot exist until this is actually published.
Canonical source this was finalized from: `docs/linkedin-post.md` (kept in
place; this file is the publication-ready copy for the four-week
submission set).

---

**ShiftPilot — my Week-1 build for the Innovation Hacks AI Internship 2026**

Frontline workers usually get their shift as a messy text dump —
deadlines, durations, one urgent item, a couple of non-tasks buried in the
middle. Typing that into a task list just moves the parsing work onto the
human.

ShiftPilot turns that dump into an ordered, explainable work plan, under
one rule the whole system is built around:

**AI interprets. Human verifies. Deterministic software decides.**

An LLM is good at pulling structure out of messy text — durations, an
urgent flag, a deadline phrase. It is not a reliable place to put the
scheduling decision itself. So:

- **AI extraction is real and live** — OpenRouter, free tier only, guarded
  by a hard free-model check on every request, no paid fallback ever.
- **Humans hold the power** — every extraction is a draft.
  `approveIntake()` is the only path in the codebase that ever creates a
  real task row.
- **Scheduling is deterministic** — priority, deadline math, dependency
  graphs (with cycle detection), and handover are computed by tested, pure
  domain functions. The model never touches the schedule.
- **Failure is designed, not hidden** — a rate-limited route or provider
  outage degrades honestly instead of pretending the AI is on.

The recorded demo shows this boundary directly: a raw shift dump goes in,
an AI-drafted candidate list comes out still editable, and only after
human approval does a task exist in the deterministic scheduler.

Stack: TypeScript strict, React + Vite, Fastify, SQLite (Drizzle), pnpm
monorepo — 341 tests, fully offline CI.

GitHub: https://github.com/Rishidar-lab/shiftpilot-ai
Live demo: https://shiftpilot-rkmx.onrender.com
Demo video: https://github.com/Rishidar-lab/shiftpilot-ai/releases/tag/week1-demo-v1

#InnovationHacks #AIInternship2026 #AIEngineering #TypeScript

---

## Publishing checklist (do not skip)

- [x] Replaced the demo-video placeholder with the real, publicly-verified release URL above (unbranded — no intro/outro asset exists; disclosed in `FINAL_VIDEO_QA.md`, not hidden).
- [ ] Wake the free Render instance before sharing the live-demo link (open it once so the first visitor doesn't hit a cold-start spinner).
- [ ] Keep the exact claims as written: controlled verification, not a benchmark; no accuracy percentage claims; no "production-ready" language; free tier only.
- [ ] Do not publish while any link above is still a placeholder.
- [ ] Record the resulting post URL in `submission/FINAL_SUBMISSION_MATRIX.md` once published.
