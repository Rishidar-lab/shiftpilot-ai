import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import type { AppConfig } from "./config.js"

/**
 * Startup concerns shared by the two production entry points: the server
 * (`index.ts`) and the compiled migration runner (`db/migrate.ts`). They fail
 * on exactly the same misconfigurations — a bad variable, an unmounted volume —
 * and a container image that runs one before the other must report both the
 * same way, or half of the deployment mistakes come back as raw stack traces.
 */

/** Create the database's parent directory, or say what the deployment got wrong. */
export function ensureDatabaseDirectory(config: AppConfig): void {
  if (config.databasePath === ":memory:") return

  const dir = dirname(config.databasePath)
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    throw new Error(
      `cannot create the database directory "${dir}" (DATABASE_PATH=${config.databasePath}): ` +
        `${(error as Error).message}. In a container this usually means the persistent volume ` +
        "is not mounted there, or is not writable by this process's user.",
      { cause: error },
    )
  }
}

/**
 * Report a startup failure as one actionable line, then exit non-zero.
 *
 * An operator reading container logs needs to know which variable is wrong, not
 * which frame threw — and a stack trace in a deploy log buries the message.
 */
export function exitWithBootFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`ShiftPilot failed to start: ${message}\n`)
  process.exit(1)
}
