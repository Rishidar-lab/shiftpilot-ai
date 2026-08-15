# ShiftPilot — single-service production image.
#
# One Node process serves the built browser app AND the API from one origin,
# which is what the web client's relative "/api" base requires. No reverse
# proxy, no second long-lived process.
#
# Both stages are the same Debian base on purpose: better-sqlite3 is a native
# module, so the binary compiled in the builder must match the runtime's libc.
#
# No secret is baked in. OPENROUTER_API_KEY is supplied at run time by the
# hosting platform's secret manager and never appears in a layer.

# --- Stage 1: build the monorepo -------------------------------------------
FROM node:22-slim AS builder

# Toolchain for better-sqlite3 when no prebuilt binary matches this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /build

# Manifests first so dependency installation caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/provider/package.json packages/provider/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# A pruned, self-contained production tree: runtime dependencies only, real
# directories instead of workspace symlinks. Dev tooling (vite, vitest, tsup,
# eslint, tsx) is not part of it.
RUN pnpm --filter @shiftpilot/api deploy --prod --legacy /deploy \
  && rm -rf /deploy/src /deploy/tsconfig.json /deploy/tsup.config.ts /deploy/drizzle.config.ts \
  # Workspace package sources come along for the ride but are never loaded — tsup
  # bundles @shiftpilot/* into dist. Test files in particular have no business in
  # a production image, and their placeholder API keys trip image secret scans.
  && find /deploy -name "*.test.ts" -delete

# --- Stage 2: runtime -------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    WEB_ROOT=/app/web \
    DATABASE_PATH=/data/shiftpilot.db \
    AI_PROVIDER=fake

WORKDIR /app

# Server bundle + runtime dependencies + the migration SQL the server locates
# by walking up from dist/ (apps/api/src/db/index.ts).
COPY --from=builder --chown=node:node /deploy ./
# The built browser app, served by this same process.
COPY --from=builder --chown=node:node /build/apps/web/dist ./web

# Default database location. Deliberately NOT declared as a VOLUME: on a free
# tier there is no disk to mount, and declaring one would imply a persistence
# the deployment does not have (it would also spawn anonymous volumes locally).
#
# Unmounted, /data is the container's writable layer — the database is created
# from empty on every start and lost when the instance is replaced. That is the
# intended Week-1 demo behaviour. Mounting a real disk at this same path makes
# it durable with no change to the image or the application.
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run through the COMPILED runner, never tsx (a devDependency that a
# production install does not have). Re-applying is a no-op, so this is safe on
# every restart and never destroys existing data. `exec` keeps the server as
# PID 1's foreground process so it receives SIGTERM.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
