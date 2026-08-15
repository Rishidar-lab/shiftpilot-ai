# Deployment runbook — ShiftPilot

Every command and behaviour below was executed against this repository on 2026-08-15, in a
container and on a bare Node process. Nothing here is aspirational.

Week-1 scope, stated up front: ShiftPilot is **single-user and single-process**. No auth, no
tenancy, in-process rate limiting, one SQLite writer. This is how to run it correctly, not a
claim that it is hardened for real operational load.

## 1. Topology — one service, one origin

**`OPENROUTER_API_KEY` exists only in the backend process.** Nothing else is negotiable.

```
Browser
  │  HTTPS
  ▼
ShiftPilot service (one Node 22 process)
  ├── GET /            → built React app (WEB_ROOT)
  ├── GET /api/*       → Fastify API
  └── SQLite at DATABASE_PATH → persistent volume
  │  server-to-server HTTPS
  ▼
OpenRouter (free route only)
```

The web client requests the relative base `/api`, so the browser must reach the API on its
own origin. Instead of a reverse proxy to make that true, the API serves the built app
itself when `WEB_ROOT` is set: one deployable, one origin, no proxy, no second process.

`pnpm dev` is unchanged — Vite serves :5173 and proxies `/api` to :8787 with `WEB_ROOT` unset.

**How the two stay apart:** `apps/api/src/app.ts` registers `@fastify/static` at the root and
splits the not-found handler — `GET`/`HEAD` on a non-`/api` path returns the SPA shell, and
anything under `/api` returns the JSON 404 envelope. Reversed, a mistyped endpoint would
answer `200 text/html`. Eight tests in `apps/api/src/static-serving.test.ts` hold that line.

## 2. Production sequence

Both paths below were run end to end. Pick one.

### Container (recommended)

```sh
docker build -t shiftpilot .
docker run -d --name shiftpilot \
  -p 8080:8787 \
  -v shiftpilot-data:/data \
  -e AI_PROVIDER=fake \
  shiftpilot
```

The image presets `NODE_ENV`, `HOST=0.0.0.0`, `PORT=8787`, `WEB_ROOT=/app/web`,
`DATABASE_PATH=/data/shiftpilot.db`, declares `VOLUME ["/data"]`, runs as the unprivileged
`node` user (uid 1000), and its CMD is `node dist/db/migrate.js && exec node dist/index.js`.

### Bare Node (platforms that build from source)

```sh
pnpm install --frozen-lockfile
pnpm build                                   # apps/web/dist + apps/api/dist
cd apps/api
DATABASE_PATH=/data/shiftpilot.db node dist/db/migrate.js
NODE_ENV=production HOST=0.0.0.0 PORT=$PORT \
DATABASE_PATH=/data/shiftpilot.db WEB_ROOT=../web/dist \
  node dist/index.js
```

Three constraints that any host must satisfy:

1. **`better-sqlite3` and `drizzle-orm` stay external to the bundle.** `better-sqlite3` is
   native, so production `node_modules` must be installed on (or built for) the target's
   OS/architecture. Copying `node_modules` across platforms will not work.
2. **`drizzle/` must sit next to `dist/`.** The server finds migrations by walking up from
   the running file to `drizzle/meta/_journal.json` (`src/db/index.ts`).
3. **Migrations must not run through `tsx`.** `pnpm db:migrate` uses tsx, a devDependency a
   production install does not have. `pnpm build` emits `dist/db/migrate.js` for exactly
   this; it needs only the runtime dependencies.

Verified for both paths: `GET /` → 200 `text/html`, `GET /api/health` → 200, SPA fallback →
200, `GET /api/<unknown>` → JSON 404, the socket genuinely binds `0.0.0.0`, `PORT` is taken
from the environment, and the full capture → review → approve → plan → What Next → complete
→ replan → handover workflow passes.

## 3. Migrations

`openDatabase()` migrates at boot on every start, and the compiled runner migrates before
the server starts. Both are idempotent, verified:

- fresh empty path → parent directory created, 5 migrations applied, server starts;
- populated database → migrations re-applied as a no-op, **data intact across restart**.

There is no destructive path. A restart never resets data.

## 4. Persistence — the honest trade-off

SQLite is a deliberate Week-1 choice and is **not** being replaced for deployment
convenience. What it requires is a real filesystem that survives restarts.

**Preferred — persistent volume**

Mount a volume and point the database at it:

```
DATABASE_PATH=/data/shiftpilot.db
```

Also required: **exactly one instance**. Two replicas would mean two SQLite writers and two
in-process rate limiters against one volume. No autoscaling, no rolling second replica.

**If the chosen tier has no persistent filesystem**, say so rather than implying otherwise.
Two options, both legitimate:

|            | Option A — ephemeral SQLite                                            | Option B — persistent storage                                           |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| What it is | Deploy as-is; the database lives in the container's writable layer     | Use a tier/host that offers a mounted volume                            |
| Data       | **Resets on every redeploy, restart or machine move**                  | Survives restarts and redeploys                                         |
| Cost       | Free                                                                   | Cents/month (Fly ≈ $0.15/GB-mo); no host offers a genuinely free volume |
| Good for   | A demo where the shift is created live on camera                       | The Week-1 demo URL staying alive between sessions                      |
| Must do    | State the reset behaviour in the demo/README — never imply persistence | Mount at `/data`, one instance                                          |

Never point `DATABASE_PATH` inside `dist/` or any build output.

The container runs as uid 1000. If a platform mounts volumes owned by root, grant that uid
write access or startup fails with
`cannot create the database directory "/data" … not writable by this process's user`.

## 5. Production environment variables

Set these in the hosting platform's environment/secrets manager. Never in the repository,
never in a committed file, never in an image layer, never in the repo description.

| Variable        | Value                  | Notes                                                                          |
| --------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `NODE_ENV`      | `production`           | preset in the image                                                            |
| `HOST`          | `0.0.0.0`              | preset; the `localhost` default is unreachable in a container                  |
| `PORT`          | platform-injected      | image default 8787                                                             |
| `DATABASE_PATH` | `/data/shiftpilot.db`  | preset; must be on the volume                                                  |
| `WEB_ROOT`      | `/app/web`             | preset; unset it to run API-only                                               |
| `CORS_ORIGIN`   | the production origin  | full URL. Same-origin serving makes CORS non-load-bearing, but keep it correct |
| `AI_PROVIDER`   | `fake` or `openrouter` | `fake` is a legitimate demo deployment: no key, no spend                       |

Only when `AI_PROVIDER=openrouter`:

| Variable                       | Value                                                |
| ------------------------------ | ---------------------------------------------------- |
| `OPENROUTER_API_KEY`           | **secret manager only** — a NEW rotated key          |
| `OPENROUTER_MODEL`             | `openrouter/free` or a `<vendor>/<model>:free` id    |
| `OPENROUTER_BASE_URL`          | optional; defaults to `https://openrouter.ai/api/v1` |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | optional; default 1024                               |
| `OPENROUTER_MAX_RETRIES`       | optional; default 0 (429 retries off)                |

Optional cost/safety controls: `AI_TIMEOUT_MS`, `AI_MAX_INPUT_CHARS`, `AI_RATE_LIMIT`,
`AI_RATE_LIMIT_WINDOW_MS`. Defaults in `.env.example` and `apps/api/src/config.ts`.

The web build takes **no** environment variables and has no provider dependency — the
compiled bundle was scanned and contains no credential and no reference to the provider host.

## 6. Free-only AI guarantee in production

`assertFreeOpenRouterModel` runs at configuration parse, at provider construction, and
before **every** inference. Only `openrouter/free` and `<vendor>/<model>:free` are accepted.

Re-verified inside the production container:

```
AI_PROVIDER=openrouter, OPENROUTER_MODEL=openai/gpt-5
  → ShiftPilot failed to start: Paid/non-free OpenRouter model rejected: openai/gpt-5
```

There is no paid fallback, no fallback model array, no availability-driven model switch, and
no retry into a different route — the 429 retry replays the identical request body. If the
free route is rate-limited or down, the call fails and the UI shows a typed error; handover
degrades to deterministic facts with a visible "degraded" label.

## 7. Startup failure behaviour

Every misconfiguration is one actionable line on stderr and a non-zero exit — no stack
traces. Verified in the container:

| Misconfiguration                 | Message                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| Unwritable `DATABASE_PATH`       | `cannot create the database directory … not writable …`       |
| `WEB_ROOT` with no built app     | `WEB_ROOT is set to "…" but that directory has no index.html` |
| `AI_PROVIDER=openrouter`, no key | `requires OPENROUTER_API_KEY and OPENROUTER_MODEL`            |
| Paid `OPENROUTER_MODEL`          | `Paid/non-free OpenRouter model rejected: …`                  |
| Malformed `CORS_ORIGIN`          | `Invalid environment configuration: CORS_ORIGIN: Invalid URL` |

A half-configured provider never degrades silently to the offline one.

## 8. Deploying to a host

Any platform that builds a Dockerfile and can attach a volume works. Requirements are the
same everywhere: build from `Dockerfile`, mount a volume at `/data`, set `CORS_ORIGIN` and
`AI_PROVIDER`, add `OPENROUTER_API_KEY` as a **secret**, health check `/api/health`, **one
instance**.

- **Fly.io** — `fly launch --no-deploy` (detects the Dockerfile),
  `fly volumes create shiftpilot_data --size 1`, mount at `/data` in `fly.toml`, set
  `min_machines_running = 1`, `fly secrets set OPENROUTER_API_KEY=…`, `fly deploy`.
- **Render** — Web Service, runtime Docker, Disk mounted at `/data`, env vars in the
  dashboard, health check path `/api/health`, instances 1. (Disks are a paid feature; the
  free tier also sleeps — that is Option A territory.)
- **Railway** — deploy from the repo, add a volume at `/data`, set variables, one replica.

## 9. First production smoke test

Immediately after the first deploy, from your terminal:

```sh
curl -s https://<production-url>/api/health
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<production-url>/
curl -s -o /dev/null -w "%{http_code}\n" https://<production-url>/api/nope   # expect 404
```

Expect `{"status":"ok",…}`, then `200 text/html`, then `404`. Check `providerIsFake` matches
the `AI_PROVIDER` you set — if you configured OpenRouter and it says `true`, the deploy did
not pick up your variables.

Then run the full 18-step browser pass in **`docs/post-deploy-checklist.md`**.

## 10. Restart verification

Persistence is not proven until a restart proves it:

1. create a shift and approve at least one task;
2. restart the service (`fly apps restart`, Render "Manual Deploy → Restart", or
   `docker restart shiftpilot`);
3. reload the page — the shift and its tasks must still be there.

If they vanish, the volume is not mounted where `DATABASE_PATH` points. This exact sequence
was verified locally against the container.

## 11. Rollback and recovery

**Bad deploy.** Every commit on `main` is a deployable image. Roll back by redeploying the
previous commit:

```sh
git log --oneline -5                 # pick the last good commit
fly deploy --image-label <previous>  # or the platform's "rollback to previous deploy"
```

Rolling back **code** is always safe. Rolling back **across a migration** is not: migrations
are forward-only (no down scripts), so a rollback to a commit older than the last applied
migration may meet a database schema it does not expect. Week 1 has five migrations and no
production data yet, so in practice: restore the database file alongside the code.

**Database backup / restore.** The database is one file. With the service stopped:

```sh
docker cp shiftpilot:/data/shiftpilot.db ./backup-$(date +%F).db     # backup
docker cp ./backup-2026-08-15.db shiftpilot:/data/shiftpilot.db      # restore
```

On a volume-backed host, use the platform's snapshot feature (`fly volumes snapshots list`)
or `fly ssh console` + `sqlite3 /data/shiftpilot.db .dump`. WAL mode means `-wal` and `-shm`
files may sit beside it; copy the set, or stop the service first so WAL is checkpointed.

**Total loss.** There is no state that cannot be rebuilt by recreating a shift — Week 1
stores no irreplaceable data. Recreate the service, mount a fresh volume, deploy.

## 12. Before going public

- Use a **new, rotated** OpenRouter key for production, injected through the platform's
  secret manager. The key used for local verification (`docs/eval/`) is treated as exposed.
- Confirm `AI_PROVIDER` is intentional: `fake` demos honestly and costs nothing;
  `openrouter` spends against a free route with no monetary ceiling the app can enforce.
- Set a spending limit in the OpenRouter console. The app's rate limit, input cap, timeout
  and token ceiling are a spend **brake**, not a cap.
