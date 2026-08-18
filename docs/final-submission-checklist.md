# Final submission checklist — ShiftPilot, Week 1

**Programme deadline: 20 August 2026. Internal target: 19 August 2026.** Treat the 20th as
emergency contingency only.

Nothing below is ticked on your behalf. Every unticked box is an action only you can take —
an account, a camera, or a form. The engineering side is finished and frozen; see
"Already done" at the bottom for what is not waiting on anyone.

---

## MUST COMPLETE BEFORE AUGUST 20

- [x] Final live UI verified
- [x] GitHub CI green
- [x] `v1.0.0-week1` created
- [ ] Demo video recorded
- [ ] Demo video uploaded
- [ ] Demo URL copied
- [ ] LinkedIn post finalized
- [ ] GitHub URL included
- [ ] Live URL included
- [ ] Demo URL included
- [ ] Innovation Hacks tagged
- [ ] LinkedIn post published
- [ ] LinkedIn URL copied
- [ ] Follow `veerakarthick235`
- [ ] Follow screenshot captured
- [ ] Screenshot DMed
- [ ] GitHub URL submitted
- [ ] Demo video URL submitted
- [ ] LinkedIn URL submitted
- [ ] Submission confirmation captured

The three boxes already ticked are repository facts you can re-check yourself: the tag
exists on `main`, CI is green on that commit, and the live URL serves the final UI.

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

Script: `docs/demo-script.md` (2–4 minutes, timed section by section).

- [ ] Wake the live service first if recording against it — Render Free cold-starts in
      30–60s, and an unwoken instance opens the video on a spinner.
- [ ] Never show the Render dashboard, its Environment tab, `.env`, or terminal history.
- [ ] Record the real AI extraction **locally** rather than on the hosted URL. The full
      11-line workload takes 42–129s on the free route and Cloudflare cuts a Render
      response off at ~100s; locally there is no such ceiling. If you do extract live, use
      a shorter workload and say plainly that the full dump is a free-tier stress case.

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
- `v1.0.0-week1` tagged on the final commit, GitHub Release published.
- Live deployment on Render Free, single service, React at `/` and the API at `/api/*`.
- Real free-tier OpenRouter inference verified through Render's stored secret, including
  across a redeploy, on the pinned `google/gemma-4-26b-a4b-it:free` route.
- 311 tests across 24 files; lint, typecheck, format, build all green.
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
