import { defineConfig } from "tsup"

export default defineConfig({
  // Two entries: the server, and a standalone migration runner. The runner is
  // COMPILED on purpose — `pnpm db:migrate` goes through tsx, a devDependency
  // that a production install does not have, so a deployment must never depend
  // on it. `node dist/db/migrate.js` needs nothing but the runtime deps.
  entry: ["src/index.ts", "src/db/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // Workspace packages (@shiftpilot/*) are TS sources and must be BUNDLED into
  // dist (Node cannot import .ts from node_modules at runtime). They are listed
  // in dependencies, so tsup would otherwise externalize them — noExternal
  // forces them into the bundle. Real registry deps stay external.
  noExternal: [/^@shiftpilot\//],
  external: ["fastify", "@fastify/cors", "zod"],
})
