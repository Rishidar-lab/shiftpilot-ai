import { buildApp } from "./app.js"
import { ensureDatabaseDirectory, exitWithBootFailure } from "./boot.js"
import { parseAppConfig } from "./config.js"
import { openDatabase } from "./db/index.js"
import { makeProvider } from "./ai.js"

/**
 * Boot sequence. Every step can fail on a misconfigured deployment — invalid
 * environment, unmounted volume, WEB_ROOT pointing at nothing, a provider
 * selected without its credentials — and each failure is reported as one
 * actionable line rather than a stack trace.
 */
try {
  const config = parseAppConfig(process.env)
  ensureDatabaseDirectory(config)

  const db = openDatabase(config.databasePath)
  const provider = makeProvider(config)
  const app = buildApp({ config, db, provider })

  app
    .listen({ port: config.port, host: config.host })
    .then(() => {
      // The CONFIGURED bind, not the first address fastify resolves: with
      // HOST=0.0.0.0 that first address is 127.0.0.1, which reads like the
      // server is loopback-only to anyone debugging why a container is
      // unreachable. Fastify still logs every interface it bound.
      app.log.info(
        `ShiftPilot API listening on ${config.host}:${config.port} ` +
          `(provider=${provider.meta.id}, web=${config.webRoot ?? "not served"})`,
      )
    })
    .catch((error: unknown) => {
      app.log.error(error)
      process.exit(1)
    })
} catch (error) {
  exitWithBootFailure(error)
}
