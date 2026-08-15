# LinkedIn post — draft (do not publish; fill placeholders first)

**Status: DRAFT — do not publish yet.** The GitHub URL below is real. The live demo and
demo-video links are still placeholders and must be filled with the URLs Render and your
video host actually issue — do not guess them. Tag **Innovation Hacks** (and the internship
hashtags the program uses). Audience: technical recruiters and the Innovation Hacks review
panel. ~200 words; screenshot or short video preferred.

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

It also ships as one deployable service — the React app and the API on a single origin,
in one container — so the whole thing runs from a single free instance.

Stack: TypeScript strict · React + Vite · Fastify · SQLite (Drizzle) · Zod · pnpm monorepo ·
Vitest. 293 tests, fully offline CI, no secrets in CI.

Verified live: a controlled 16/16 evaluation of the free-tier OpenRouter route (smoke
HTTP 2xx; recorded fixtures; reports in the repo).

Repo: https://github.com/Rishidar-lab/shiftpilot-ai
Live demo: [PLACEHOLDER — the real *.onrender.com URL, once the service is running]
Video: [PLACEHOLDER — the demo video URL, once recorded]

#InnovationHacks #AIInternship2026 #AIBuild #OpenSource #TypeScript

---

## Rules for publishing

- The repo is public and its URL above is final. Both remaining links are placeholders:
  publish only once each has been replaced with a URL that actually resolves.
- Mention the live demo only if it is up. Free instances cold-start after inactivity — open
  the link and let it wake before posting, so the first visitor does not meet a spinner.
- Keep the exact claims: controlled verification, not a benchmark; no accuracy
  percentages; no "production-ready"; free tier only; no Claude claim.
- Do not publish with placeholders — if the repo or video is not ready, wait.
