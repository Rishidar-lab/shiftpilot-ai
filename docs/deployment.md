# Deployment — ShiftPilot

Derived from the repository as it actually is, and verified: every command and behaviour
below was executed against the production image on 2026-08-15.

Week-1 scope caveat up front: ShiftPilot is a **single-user, single-process** application.
It is not production-hardened (no auth, no tenancy, in-process rate limiting, single-writer
SQLite). This document describes how to run it correctly, not a claim that it is ready to
carry real operational load.

## Topology — one service, one origin

The invariant: **`OPENROUTER_API_KEY` exists only in the backend process.**

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

`apps/web/src/api/client.ts` builds every request against the relative base `/api`, so the
browser must reach the API on its own origin. Rather than requiring a reverse proxy to make
that true, the API process serves the built app itself when `WEB_ROOT` is set: one
deployable, one origin, no proxy, no second long-lived process.

Development is unchanged: `pnpm dev` still runs Vite on :5173 proxying `/api` to :8787, and
`WEB_ROOT` stays unset.

### How the two are kept apart

`apps/api/src/app.ts` registers `@fastify/static` at the root and splits the not-found
handler:

- `GET`/`HEAD` for a non-`/api` path → the SPA shell (`index.html`), so client-side routes
  resolve;
- anything under `/api` → the normal JSON 404 envelope.

That split is load-bearing and covered by `apps/api/src/static-serving.test.ts`: if it were
reversed, a mistyped endpoint would answer `200 text/html` and every client error would
become an unparseable page.

## Build and run commands

| Purpose            | Command                                                          |
| ------------------ | ---------------------------------------------------------------- |
| Install            | `pnpm install --frozen-lockfile`                                 |
| Web build          | `pnpm --filter @shiftpilot/web build` → `apps/web/dist`          |
| API build          | `pnpm --filter @shiftpilot/api build` → `apps/api/dist/` (tsup)  |
| Production migrate | `node dist/db/migrate.js` (compiled — **not** `pnpm db:migrate`) |
| Production start   | `node dist/index.js` (= `pnpm --filter @shiftpilot/api start`)   |
| Health check       | `GET /api/health` → `{"status":"ok", …}`, never any credential   |

Three facts that constrain any deployment:

1. **`better-sqlite3` and `drizzle-orm` stay external to the bundle.** `better-sqlite3` is
   a native module, so production `node_modules` must be installed on (or built for) the
   target's OS/architecture. A `node_modules` copied from a different platform will not work.
2. **`drizzle/` must ship next to `dist/`.** The server finds its migrations by walking up
   from the running file until it sees `drizzle/meta/_journal.json` (`src/db/index.ts`).
3. **Migrations must not run through `tsx`.** `pnpm db:migrate` uses tsx, a devDependency a
   production install does not have. `pnpm build` therefore emits a second entry point,
   `dist/db/migrate.js`, which needs nothing but the runtime dependencies.

### Migration behaviour (verified)

`openDatabase()` applies pending migrations at boot, and the compiled runner applies them
explicitly before the server starts. Both are idempotent:

- fresh empty path → directory created, 5 migrations applied, server starts;
- existing populated database → migrations re-applied as a no-op, **data preserved across
  restart** (verified by restarting the container and re-reading the shift).

### Database persistence

SQLite in WAL mode at `DATABASE_PATH`. This requires:

- a **persistent writable volume**. The image defaults to `/data/shiftpilot.db` and declares
  `VOLUME ["/data"]`. Without a real volume mounted there, the database lives in the
  container's writable layer and is lost on every restart or redeploy;
- **exactly one instance.** Multiple replicas would each hold their own SQLite writer and
  their own in-process rate limiter. Do not scale this service horizontally as it stands.

Never point `DATABASE_PATH` inside `dist/` or any build output.

The container runs as the unprivileged `node` user (uid 1000). If a platform mounts volumes
owned by root, either grant that uid write access or the process will refuse to start with:
`cannot create the database directory "/data" … not writable by this process's user`.

## Startup failure behaviour (verified)

Every deployment mistake is one actionable line on stderr and a non-zero exit — no stack
traces:

| Misconfiguration                   | Message                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| Unwritable `DATABASE_PATH`         | `cannot create the database directory … not writable …`       |
| `WEB_ROOT` with no built app in it | `WEB_ROOT is set to "…" but that directory has no index.html` |
| `AI_PROVIDER=openrouter`, no key   | `requires OPENROUTER_API_KEY and OPENROUTER_MODEL`            |
| A paid `OPENROUTER_MODEL`          | `Paid/non-free OpenRouter model rejected: …`                  |
| Malformed `CORS_ORIGIN`            | `Invalid environment configuration: CORS_ORIGIN: Invalid URL` |

A half-configured AI provider never degrades silently to the offline provider.

## Production environment variables

Set these in the hosting platform's environment/secrets manager. Never in the repository,
never in a committed file, never in the repository description, never in an image layer.

**Backend service**

| Variable        | Value                  | Notes                                                                             |
| --------------- | ---------------------- | --------------------------------------------------------------------------------- |
| `NODE_ENV`      | `production`           | set by the image                                                                  |
| `HOST`          | `0.0.0.0`              | set by the image; the `localhost` default is unreachable in a container           |
| `PORT`          | platform-injected      | image defaults to 8787                                                            |
| `DATABASE_PATH` | `/data/shiftpilot.db`  | must be on the mounted volume                                                     |
| `WEB_ROOT`      | `/app/web`             | set by the image; unset it to run API-only                                        |
| `CORS_ORIGIN`   | the public origin      | full URL. Same-origin serving means CORS is not load-bearing, but keep it correct |
| `AI_PROVIDER`   | `fake` or `openrouter` | `fake` is a legitimate demo deployment: no key, no spend                          |

**Only when `AI_PROVIDER=openrouter`**

| Variable                       | Value                                             |
| ------------------------------ | ------------------------------------------------- |
| `OPENROUTER_API_KEY`           | **secret** — hosting secret manager only          |
| `OPENROUTER_MODEL`             | `openrouter/free` or a `<vendor>/<model>:free` id |
| `OPENROUTER_BASE_URL`          | optional; defaults to the OpenRouter v1 endpoint  |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | optional; defaults to 1024                        |
| `OPENROUTER_MAX_RETRIES`       | optional; defaults to 0 (429 retries off)         |

**Optional cost/safety controls** — `AI_TIMEOUT_MS`, `AI_MAX_INPUT_CHARS`, `AI_RATE_LIMIT`,
`AI_RATE_LIMIT_WINDOW_MS`. Defaults are in `.env.example` and `apps/api/src/config.ts`.

## The image

`Dockerfile` is a two-stage build on `node:22-slim` (same base in both stages so the native
`better-sqlite3` binary matches the runtime libc). The builder installs the workspace,
builds both apps, and produces a pruned runtime tree with
`pnpm --filter @shiftpilot/api deploy --prod --legacy`. The final image carries the server
bundle, its runtime dependencies, the migration SQL and the built web app — no vite, vitest,
tsup, eslint or tsx. **281 MB**, no secrets in any layer.

```sh
docker build -t shiftpilot .

docker run -d --name shiftpilot \
  -p 8080:8787 \
  -v shiftpilot-data:/data \
  -e AI_PROVIDER=fake \
  shiftpilot

curl -s localhost:8080/api/health
```

For the real provider, pass the key from your shell or the platform's secret store — never
a literal in a command you commit:

```sh
docker run -d --name shiftpilot \
  -p 8080:8787 -v shiftpilot-data:/data \
  -e AI_PROVIDER=openrouter \
  -e OPENROUTER_MODEL=openrouter/free \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  shiftpilot
```

The image declares a `HEALTHCHECK` against `/api/health`, and the container CMD runs the
compiled migration runner before exec'ing the server.

## Deploying it

Any platform that runs a Dockerfile and can attach a persistent volume works. The
requirements are the same everywhere:

- build from the repository's `Dockerfile`;
- attach a persistent volume mounted at `/data`;
- set `DATABASE_PATH=/data/shiftpilot.db` (already the image default);
- set `CORS_ORIGIN` to the public URL, and `AI_PROVIDER`;
- add `OPENROUTER_API_KEY` as a **secret** if using the real provider;
- health check path `/api/health`;
- **one instance** — no autoscaling, no rolling second replica against the same volume.

Concretely, on the common free/low-cost options:

- **Fly.io** — `fly launch --no-deploy` (it will detect the Dockerfile),
  `fly volumes create shiftpilot_data --size 1`, mount it at `/data` in `fly.toml`, then
  `fly secrets set OPENROUTER_API_KEY=…` and `fly deploy`. Set `min_machines_running = 1`
  and do not enable multiple machines against one volume.
- **Render** — a Web Service with runtime "Docker", a Disk mounted at `/data`, environment
  variables in the dashboard, health check path `/api/health`, instance count 1.
- **Railway** — deploy from the repo (Dockerfile detected), add a volume at `/data`, set
  variables, one replica.

## Before going public

- Rotate the OpenRouter key used during local verification (`docs/eval/`) and use a **new**
  key for production, injected through the platform's secret manager.
- Confirm `AI_PROVIDER` is what you intend: `fake` demos honestly and costs nothing;
  `openrouter` spends against a free route with no monetary ceiling the app can enforce.
- Set a spending limit in the OpenRouter console. The application's rate limit, input cap,
  timeout and token ceiling are a spend **brake**, not a cap.
