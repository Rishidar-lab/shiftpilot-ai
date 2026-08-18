# Final submission checklist — ShiftPilot, Week 1

**Programme deadline: 20 August 2026. Internal target: 19 August 2026.** Treat the 20th as
emergency contingency only.

Nothing below is ticked on your behalf. Every unticked box is an action only you can take —
an account, a camera, or a form. The engineering side is finished and frozen; see
"Already done" at the bottom for what is not waiting on anyone.

---

## MUST COMPLETE BEFORE AUGUST 20

Engineering is frozen and verified (see "Already done"). Every box below is a human action —
none is ticked on your behalf.

- [ ] Demo recorded
- [ ] Demo reviewed once
- [ ] Demo uploaded
- [ ] Video URL copied
- [ ] LinkedIn draft has GitHub URL
- [ ] LinkedIn draft has live URL
- [ ] LinkedIn draft has video URL
- [ ] Innovation Hacks tagged
- [ ] LinkedIn published
- [ ] LinkedIn post URL copied
- [ ] Followed `veerakarthick235`
- [ ] Follow screenshot captured
- [ ] Screenshot DMed
- [ ] GitHub URL submitted
- [ ] Video URL submitted
- [ ] LinkedIn URL submitted
- [ ] Submission confirmation screenshot saved

Repository facts you can re-check yourself (already true): `main` is clean at `2be57b6`,
`v1.0.0-week1` and `v1.1.0-week1` both exist, CI is green, and the live URL serves the final
UI. The demo script is `docs/demo-narration-final.md`; the primary live workload is locked
there.

---

## Security action, do this first

- [ ] **Revoke the OpenRouter key that was pasted into chat.** Checked on 18 Aug 2026 it is
      **still active**. The deployed service authenticates with a different key held in
      Render's secret store, so revoking this one does not touch the live demo. Do it in the
      OpenRouter console → Keys → revoke.

---

## The links you will need

| What        | Value                                         |
| ----------- | --------------------------------------------- |
| Repository  | https://github.com/Rishidar-lab/shiftpilot-ai |
| Live demo   | https://shiftpilot-rkmx.onrender.com          |
| Release tag | `v1.0.0-week1`                                |
| Demo video  | _(fill in after upload)_                      |
| LinkedIn    | _(fill in after publishing)_                  |

---

## 1. Record the demo

Word-for-word narration: `docs/demo-narration-final.md` (~3:00–3:20). The **primary live
workload is locked** there (three lines: a 2pm deadline, durations, an urgent call, and a
dependency). Do not use the eleven-line stress workload in the recording.

- [ ] Wake the live service first — Render Free cold-starts in ~30–60s, then wait ~30s more.
- [ ] Confirm `/api/health` shows `providerIsFake: false` before using the live route.
- [ ] Never show the Render dashboard, its Environment tab, `.env`, or terminal history.
- [ ] **Mode A (live):** rehearsed clean on 18 Aug (201 in ~52s). Expect the AI step to take
      up to ~a minute; narrate the wait. **Mode B (fallback):** local build on the offline
      provider, "Simulated AI · no real LLM" badge left visible, with the one-line disclaimer
      from the narration. If the live route returns `503 ai_unavailable`, switch to Mode B —
      do not wait hours or change providers.

## 2. Publish the LinkedIn post

Draft: `docs/linkedin-post.md` — final except the video link.

- [ ] Paste the demo-video URL over the `[PLACEHOLDER]` line. Do not publish with a
      placeholder still in the text.
- [ ] Confirm the repo and live URLs resolve from a logged-out browser.
- [ ] **Tag Innovation Hacks.** This is a graded requirement, not a courtesy.
- [ ] Keep the claims exactly as drafted: free tier only, controlled verification rather
      than a benchmark, no accuracy percentage, no "production ready", no Claude claim.

## 3. Follow requirement

From the latest announcement — follow, screenshot, then DM the screenshot.

- [ ] Follow https://github.com/veerakarthick235
- [ ] Capture the screenshot showing the follow
- [ ] DM the screenshot as the announcement instructs

Not automated deliberately: a social action taken on your behalf is not one you can
honestly attest to.

## 4. Submit

- [ ] GitHub URL
- [ ] Demo video URL
- [ ] LinkedIn post URL
- [ ] Screenshot or copy of the submission confirmation

---

## Already done (no action needed)

- Public repository, `main` pushed, MIT licensed, CI green.
- `v1.0.0-week1` and `v1.1.0-week1` tagged and released (v1.1.0 = the final product
  experience; v1.0.0 preserved, never moved).
- Word-for-word demo narration ready (`docs/demo-narration-final.md`) with the primary live
  workload locked and a rehearsed live run (201 in ~52s on 18 Aug).
- Live deployment on Render Free, single service, React at `/` and the API at `/api/*`.
- Real free-tier OpenRouter inference verified through Render's stored secret, including
  across a redeploy, on the pinned `google/gemma-4-26b-a4b-it:free` route.
- 320 tests across 26 files; lint, typecheck, format, build all green.
- Secret scan clean across working tree, index and full history.
- README, architecture, deployment runbook, interview defense, demo script, LinkedIn draft
  and the submission matrix all final and consistent with the shipped code.
- Real screenshots of the final UI in `docs/screenshots/`, used in the README.

## Known limitations to state honestly if asked

- Ephemeral storage: Render Free has no disk, so the demo database resets on restart,
  redeploy or spin-down. Deliberate, documented, and not a data-loss bug.
- Free-route latency: large workloads can exceed the platform's ~100s response ceiling on
  the hosted URL. Handled honestly — the raw input is saved before any AI call and the UI
  offers a retry; it never silently drops work.
- No authentication and no multi-user isolation. Deliberate Week-1 scope.
