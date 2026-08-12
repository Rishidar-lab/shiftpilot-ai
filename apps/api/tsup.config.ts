import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
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
