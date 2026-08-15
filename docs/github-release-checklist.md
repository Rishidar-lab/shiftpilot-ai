# GitHub release checklist — ShiftPilot Week 1

Everything below the "Pre-flight" section was verified on 2026-08-15 against this working
tree. Re-run the checks if anything changes before you publish.

## Repository metadata

- **Name:** `shiftpilot-ai`
- **Description:** AI-assisted workload planning with human-reviewed extraction and
  deterministic scheduling.
- **Suggested topics:** `ai`, `typescript`, `react`, `fastify`, `sqlite`, `drizzle-orm`,
  `zod`, `openrouter`, `llm`, `human-in-the-loop`, `monorepo`, `pnpm`, `vitest`
- **Default branch:** `main`
- **Visibility:** public (this is a portfolio/submission repository)

## Pre-flight — verified 2026-08-15

| Check                    | Result | Evidence                                                                |
| ------------------------ | ------ | ----------------------------------------------------------------------- |
| No secret tracked        | PASS   | `git grep` for `sk-ant-*`, `sk-or-v1-*`, AWS keys, PEM blocks — no hits |
| No `.env` tracked        | PASS   | `git ls-files \| grep .env` → `.env.example` only                       |
| `.env` ignored           | PASS   | `.gitignore:10`; `git check-ignore` confirms root and `apps/*` paths    |
| `.env.example` complete  | PASS   | all 20 keys in the zod env schema are present, placeholders only        |
| No runtime database      | PASS   | `*.db`, `data/`, `.ci-data/` ignored; nothing tracked                   |
| No logs                  | PASS   | no log files tracked                                                    |
| No `node_modules`        | PASS   | ignored, not tracked                                                    |
| No `dist`                | PASS   | ignored, not tracked                                                    |
| README renders           | PASS   | valid Markdown, one Mermaid block, tables balanced                      |
| LICENSE exists           | PASS   | MIT (`LICENSE`)                                                         |
| CI exists                | PASS   | `.github/workflows/ci.yml`, no secrets, no paid calls                   |
| Default branch is `main` | PASS   | `git branch` → `* main`                                                 |
| Working tree clean       | —      | verify immediately before pushing (`git status --porcelain`)            |

Secret-scan commands used:

```sh
git grep -nE "sk-ant-[A-Za-z0-9_-]{10,}|sk-or-v1-[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files | grep -iE '\.env|\.(db|sqlite|log)$'
```

Both must return nothing (the `.env.example` line is expected and contains no values).

## One thing to do before making the repository public

Rotate the OpenRouter API key that was used for the live verification runs in `docs/eval/`.
It never entered the repository, but it was used from a shell on this machine and there is
no reason to keep a key alive once its verification job is done.

## Create and push

Run from the repository root. **Nothing below has been executed.**

### Option A — GitHub CLI (creates the repo, adds the remote, and pushes in one step)

```sh
gh auth status    # must show an authenticated account first

gh repo create shiftpilot-ai \
  --public \
  --description "AI-assisted workload planning with human-reviewed extraction and deterministic scheduling." \
  --source . \
  --remote origin \
  --push
```

Then add the topics:

```sh
gh repo edit --add-topic ai,typescript,react,fastify,sqlite,drizzle-orm,zod,openrouter,llm,human-in-the-loop,monorepo,pnpm,vitest
```

### Option B — create the repository in the GitHub UI, then push

Create an **empty** repository named `shiftpilot-ai` (no README, no .gitignore, no license —
this repository already has all three), then:

```sh
git remote add origin git@github.com:<your-github-username>/shiftpilot-ai.git
git push -u origin main
```

Use `https://github.com/<your-github-username>/shiftpilot-ai.git` instead if you are not on
SSH. The Git identity configured here is `rishidar-lab`.

## After pushing

```sh
gh run watch                 # CI: install → lint → typecheck → format → test → build → migration smoke
gh repo view --web           # confirm the README, Mermaid diagram and tables render
```

Then confirm by eye:

- the README renders, including the Mermaid architecture diagram (GitHub renders it natively);
- the repository contains **no** `.env`, no `*.db`, no `dist/`, no `node_modules/`;
- CI is green.

## Tag the submission

Justified: this is a defined deliverable (Week-1 submission) that a reviewer may return to
after later work has landed.

```sh
git tag -a v1.0.0-week1 -m "ShiftPilot Week 1 — AI-assisted workload planning, human-reviewed extraction, deterministic scheduling"
git push origin v1.0.0-week1

gh release create v1.0.0-week1 \
  --title "ShiftPilot v1.0.0-week1" \
  --notes "Week-1 submission for the Innovation Hacks AI Internship 2026. Capture → AI extraction → human review → deterministic planning → handover. 283 tests, offline by default, live OpenRouter free-tier verification recorded in docs/eval/."
```

## Not done here, on purpose

- No remote was created. No push was made. No release was published.
- The demo video and LinkedIn post (`docs/linkedin-post.md`) still need the real repository
  URL once it exists.
