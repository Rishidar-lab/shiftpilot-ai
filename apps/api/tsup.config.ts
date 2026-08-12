import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // Workspace packages (@shiftpilot/*) are TS sources and must be BUNDLED into
  // dist (Node cannot import .ts from node_modules at runtime). Real registry
  // deps stay external.
  external: ["fastify", "@fastify/cors", "zod"],
})
