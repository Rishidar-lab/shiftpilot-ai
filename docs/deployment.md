# Deployment — ShiftPilot

Derived from the repository as it actually is, not from a generic template. Every command
below is one the repo already supports; nothing here requires a code change.

Week-1 scope caveat up front: ShiftPilot is a **single-user, single-process** application.
It is not production-hardened (no auth, no tenancy, in-process rate limiting, single-writer
SQLite). This document describes how to run it correctly, not a claim that it is ready to
carry real operational load.

## Topology

The one invariant: **`OPENROUTER_API_KEY` exists only in the backend service's process.**

```
Browser
  │  HTTPS, same origin
  ▼
Static web bundle (apps/web/dist)          ← no credentials, no provider dependency
  │  /api/*  (same-origin path, forwarded by the platform)
  ▼
ShiftPilot API (apps/api, Node 22)         ← reads OPENROUTER_API_KEY from the environment
  │  server-to-server HTTPS
  ▼
OpenRouter (free route only)
```

### Why same-origin, and what that constrains

`apps/web/src/api/client.ts` builds every request against a relative base of `/api`
(`new ApiClient()` in `App.tsx` takes the default). In development the Vite dev server
proxies `/api` to `localhost:8787`. In production the same must be true: the browser has to
reach the API on **its own origin** under `/api`.

That makes the deployment a static site plus a rewrite, which is also the simplest option:

- **Static host with a rewrite/proxy rule** — serve `apps/web/dist`, forward `/api/*` to the
  API service. Render Static Sites, Netlify `_redirects`, Vercel `rewrites`, Cloudflare
  Pages, an nginx/Caddy container: all support this in configuration.

A cross-origin split (web on one domain calling `https://api.example.com` directly) is
**not** supported as-is: there is no build-time API base URL to point at another host. Adding
one is a small change, but it is a change — do not assume the current build can do it.

## Build and run commands

| Purpose      | Command                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| Install      | `pnpm install --frozen-lockfile`                                         |
| Web build    | `pnpm --filter @shiftpilot/web build` → static output in `apps/web/dist` |
| API build    | `pnpm --filter @shiftpilot/api build` → `apps/api/dist/index.js` (tsup)  |
| API start    | `pnpm --filter @shiftpilot/api start` (= `node dist/index.js`)           |
| Migrations   | applied automatically at boot — see below                                |
| Health check | `GET /api/health` → `{"status":"ok", …}`, no credentials in the response |

Two things the API build does **not** bundle, and that must therefore exist on the server:

1. **`better-sqlite3` and `drizzle-orm` stay external.** `better-sqlite3` is a native
   module, so production `node_modules` must be installed on (or built for) the deployment
   platform's architecture. `pnpm install --frozen-lockfile` on the target does this; a
   `node_modules` directory copied from a different OS/arch will not work.
2. **`apps/api/drizzle/` must ship next to `dist/`.** The server locates its migrations by
   walking up from the running file until it finds `drizzle/meta/_journal.json`
   (`apps/api/src/db/index.ts`). Deploy the `apps/api` directory, not `dist` alone.

### Migrations

`openDatabase()` applies pending migrations **at boot, every boot**, and re-applying is a
no-op. A normal deploy therefore needs no migration step.

The standalone `pnpm db:migrate` runs through `tsx`, which is a _devDependency_ — it is a
development and CI tool, not part of a production release. Do not put it in a production
start command that runs against pruned dependencies.

### Database persistence

SQLite in WAL mode at `DATABASE_PATH`. This requires:

- a **persistent writable volume** mounted into the service (Render Disk, Fly volume,
  Railway volume, Kubernetes PVC). An ephemeral container filesystem loses every shift on
  restart or redeploy;
- **exactly one instance.** Multiple replicas would each hold their own SQLite writer and
  their own in-process rate limiter. Do not scale this service horizontally as it stands.

Point `DATABASE_PATH` at the mounted volume, e.g. `/data/shiftpilot.db`. Relative paths
resolve against `apps/api`.

## Production environment variables

Set these in the hosting platform's environment/secrets manager. Never in the repository,
never in a committed file, never in the repository description.

**Required for the backend service**

| Variable        | Value                                  | Notes                                                                                                                |
| --------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `production`                           |                                                                                                                      |
| `HOST`          | `0.0.0.0`                              | **Required in containers.** The default `localhost` binds 127.0.0.1 and the platform's health check cannot reach it. |
| `PORT`          | the platform's injected port           | Defaults to 8787 when the platform does not inject one.                                                              |
| `DATABASE_PATH` | absolute path on the persistent volume | e.g. `/data/shiftpilot.db`                                                                                           |
| `CORS_ORIGIN`   | the public browser origin              | e.g. `https://shiftpilot.example.com`. Must be a full URL.                                                           |
| `AI_PROVIDER`   | `fake` or `openrouter`                 | `fake` is a legitimate production choice for a demo deployment: no key, no spend.                                    |

**Required only when `AI_PROVIDER=openrouter`** (a missing value is a boot failure, never a
silent downgrade to the offline provider)

| Variable                       | Value                                             |
| ------------------------------ | ------------------------------------------------- |
| `OPENROUTER_API_KEY`           | **secret** — secrets manager only                 |
| `OPENROUTER_MODEL`             | `openrouter/free` or a `<vendor>/<model>:free` id |
| `OPENROUTER_BASE_URL`          | optional; defaults to the OpenRouter v1 endpoint  |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | optional; defaults to 1024                        |
| `OPENROUTER_MAX_RETRIES`       | optional; defaults to 0 (429 retries off)         |

**Optional cost/safety controls** — `AI_TIMEOUT_MS`, `AI_MAX_INPUT_CHARS`, `AI_RATE_LIMIT`,
`AI_RATE_LIMIT_WINDOW_MS`. Defaults are in `.env.example` and `apps/api/src/config.ts`.

**The web service needs no environment variables at all**, which is the point: it has no
provider dependency and nothing to leak. The built bundle was checked for credential
strings and contains none.

## Worked example — Render (two services, one origin)

Chosen because it supports a persistent disk and a static-site rewrite, which is exactly
what this repo needs. Any platform with those two features works the same way.

**1. API — Web Service**

- Build: `pnpm install --frozen-lockfile && pnpm --filter @shiftpilot/api build`
- Start: `pnpm --filter @shiftpilot/api start`
- Disk: mount at `/data`
- Environment: `NODE_ENV=production`, `HOST=0.0.0.0`, `DATABASE_PATH=/data/shiftpilot.db`,
  `CORS_ORIGIN=https://<your-web-host>`, `AI_PROVIDER=…`, plus the OpenRouter block as a
  secret if used
- Health check path: `/api/health`
- Instances: **1**

**2. Web — Static Site**

- Build: `pnpm install --frozen-lockfile && pnpm --filter @shiftpilot/web build`
- Publish directory: `apps/web/dist`
- Rewrite: `/api/*` → `https://<api-service-host>/api/*`
- No environment variables

**3. Verify after deploy**

```sh
curl -s https://<your-web-host>/api/health     # through the rewrite, not the API host
```

Expect `{"status":"ok",…}` with `providerIsFake` matching the `AI_PROVIDER` you set. Then
open the site and run one capture → review → approve → plan cycle.

## Single-container alternative

If one deployable unit is preferred: build both, serve `apps/web/dist` with Caddy or nginx
in the same image, and proxy `/api` to the Node process on `127.0.0.1:8787`. Same
invariants — persistent volume for the database, one instance, key in the container's
secret environment rather than the image.

## Before going public

- Rotate the OpenRouter key used during local verification (`docs/eval/`) before the
  repository or any deployment is public.
- Confirm `AI_PROVIDER` is what you intend: `fake` demos honestly and costs nothing;
  `openrouter` spends against a free route with no monetary ceiling the app can enforce.
- Set a spending limit in the OpenRouter console. The application's rate limit, input cap,
  timeout and token ceiling are a spend **brake**, not a cap.
