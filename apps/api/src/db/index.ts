import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as schema from "./schema.js"

export type Database = BetterSQLite3Database<typeof schema>

/**
 * Open a SQLite connection, enable WAL + foreign keys, and apply pending
 * migrations. `:memory:` is supported (used by tests).
 */
export function openDatabase(databasePath: string): Database {
  const raw = new Database(databasePath)
  raw.pragma("journal_mode = WAL")
  raw.pragma("foreign_keys = ON")
  const db = drizzle(raw, { schema })
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })
  return db
}

/**
 * Find `apps/api/drizzle` from wherever this module ended up.
 *
 * The depth differs between dev and production: from source this file is
 * `src/db/index.ts` (two levels down), but tsup bundles the whole server into a
 * single `dist/index.js` (one level down). Hard-coding one depth meant the built
 * server booted fine in tests and then died with "Can't find meta/_journal.json"
 * as soon as it ran from `dist` — so walk up until the journal is actually
 * there, and fail with a message that says what was searched.
 */
function resolveMigrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  const searched: string[] = []
  for (let depth = 0; depth < 5; depth++) {
    const candidate = path.join(dir, "drizzle")
    searched.push(candidate)
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) return candidate
    dir = path.dirname(dir)
  }
  throw new Error(
    `Could not locate the drizzle migrations folder. Searched: ${searched.join(", ")}`,
  )
}
