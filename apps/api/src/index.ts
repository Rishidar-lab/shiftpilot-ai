import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { buildApp } from "./app.js"
import { parseAppConfig } from "./config.js"
import { openDatabase } from "./db/index.js"
import { makeProvider } from "./ai.js"

const config = parseAppConfig(process.env)
if (config.databasePath !== ":memory:") {
  mkdirSync(dirname(config.databasePath), { recursive: true })
}
const db = openDatabase(config.databasePath)
const provider = makeProvider(config)

const app = buildApp({ config, db, provider })

app
  .listen({ port: config.port, host: config.host })
  .then((address) => {
    app.log.info(`ShiftPilot API listening on ${address}`)
  })
  .catch((error: unknown) => {
    app.log.error(error)
    process.exit(1)
  })
