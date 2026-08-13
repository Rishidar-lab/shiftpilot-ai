import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { parseAppConfig } from "../config.js"
import { openDatabase } from "./index.js"

/**
 * Apply pending migrations to DATABASE_PATH and exit.
 *
 * The server also migrates at boot, so this exists for two other cases: making
 * a fresh database before first run, and letting CI prove that the migration
 * chain applies cleanly from empty (docs/implementation-plan.md P-01).
 */
const config = parseAppConfig(process.env)
if (config.databasePath !== ":memory:") {
  mkdirSync(dirname(config.databasePath), { recursive: true })
}
openDatabase(config.databasePath)
process.stdout.write(`migrations applied to ${config.databasePath}\n`)
