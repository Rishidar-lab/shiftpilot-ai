import { buildApp } from "./app.js"
import { parseAppConfig } from "./config.js"

const config = parseAppConfig(process.env)
const app = buildApp({ config })

app
  .listen({ port: config.port, host: config.host })
  .then((address) => {
    app.log.info(`ShiftPilot API listening on ${address}`)
  })
  .catch((error: unknown) => {
    app.log.error(error)
    process.exit(1)
  })
