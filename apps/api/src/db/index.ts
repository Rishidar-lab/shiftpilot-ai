import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as schema from "./schema.js"

export type Database = BetterSQLite3Database<typeof schema>

/**
 * Open a SQLite connection, enable WAL + foreign keys, and apply pending
 * migrations. `:memory:` is supported (used by tests). The migrations folder
 * is resolved relative to this file so it works from both `src/db` (dev/test)
 * and `dist/db` (built) — both are exactly two levels below `apps/api`.
 */
export function openDatabase(databasePath: string): Database {
  const raw = new Database(databasePath)
  raw.pragma("journal_mode = WAL")
  raw.pragma("foreign_keys = ON")
  const db = drizzle(raw, { schema })
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })
  return db
}

function resolveMigrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, "../../drizzle")
}
