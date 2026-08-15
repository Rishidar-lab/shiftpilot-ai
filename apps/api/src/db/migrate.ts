import { ensureDatabaseDirectory, exitWithBootFailure } from "../boot.js"
import { parseAppConfig } from "../config.js"
import { openDatabase } from "./index.js"

/**
 * Apply pending migrations to DATABASE_PATH and exit.
 *
 * The server also migrates at boot, so this exists for three other cases:
 * making a fresh database before first run, letting CI prove that the migration
 * chain applies cleanly from empty (docs/implementation-plan.md P-01), and
 * running migrations in production — where it is the COMPILED
 * `dist/db/migrate.js`, because `pnpm db:migrate` goes through tsx, a
 * devDependency a production install does not have.
 */
try {
  const config = parseAppConfig(process.env)
  ensureDatabaseDirectory(config)
  openDatabase(config.databasePath)
  process.stdout.write(`migrations applied to ${config.databasePath}\n`)
} catch (error) {
  exitWithBootFailure(error)
}
