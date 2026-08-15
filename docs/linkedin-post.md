# LinkedIn post — draft (do not publish; fill placeholders first)

**Status: DRAFT.** Publish only after the repo is public and the demo video URL exists.
Replace every `[PLACEHOLDER]`. Do not invent URLs. Tag **Innovation Hacks** (and the
internship hashtags used by the program). Target audience: technical recruiters and the
Innovation Hacks review panel. ~200 words; screenshot or short video preferred.

---

**ShiftPilot — my Week-1 build for the Innovation Hacks AI Internship 2026**

Week-1 problem: frontline and operational workers receive work as a messy text dump —
deadlines, durations, interruptions, one urgent item, two non-tasks buried in the middle.
Typing that into a task list just means the human does the parsing and the prioritising.

ShiftPilot turns that dump into an ordered, explainable work plan — with one rule on top:

**AI interprets. Human verifies. Deterministic software decides.**

- **AI extraction is real and live** — OpenRouter on the free tier only, guarded by a
  hard free-model check on every request (paid models are rejected by code, and there is
  no paid fallback ever).
- **Humans hold the power** — every extracted candidate is a draft; nothing becomes a
  task until a person edits, rejects, or approves it.
- **Scheduling is deterministic** — priority, ordering, deadlines (shift-local, IANA
  timezone), dependency edges, overflow flags, "what should I do next?" and end-of-shift
  handover are all computed by tested domain engines. The model never sets a priority.
- **Failure is designed** — invalid model output, a rate-limited route, or a provider
  outage degrades gracefully and honestly; the app never pretends the AI is on when it is
  not.

Stack: TypeScript strict · React + Vite · Fastify · SQLite (Drizzle) · pnpm monorepo ·
Vitest. 283 tests, fully offline CI, no secrets in CI.

Verified live: a controlled 16/16 evaluation of the free-tier OpenRouter route (smoke
HTTP 2xx; recorded fixtures; reports in the repo).

Repo: [link to github.com/your-user/shiftpilot-ai] · Demo: [link to demo video]

#InnovationHacks #AIInternship2026 #AIBuild #OpenSource #TypeScript

---

## Rules for publishing

- Only after checklist item 1 (key rotation) is done and item 2 (public repo) is pushed.
- Keep the exact claims: controlled verification, not a benchmark; no accuracy
  percentages; no "production-ready"; free tier only; no Claude claim.
- Do not publish with placeholders — if the repo or video is not ready, wait.
