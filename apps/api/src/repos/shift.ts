import { eq } from "drizzle-orm"

import { shifts } from "../db/schema.js"
import type { Database } from "../db/index.js"
import { Shift } from "@shiftpilot/contracts"

export function insertShift(db: Database, row: typeof shifts.$inferInsert): void {
  db.insert(shifts).values(row).run()
}

export function getShiftRow(db: Database, id: string): typeof shifts.$inferSelect | undefined {
  return db.select().from(shifts).where(eq(shifts.id, id)).get()
}

export function listShiftRows(db: Database): (typeof shifts.$inferSelect)[] {
  return db.select().from(shifts).orderBy(shifts.date).all()
}

/** Parse a DB row into a contracts Shift, failing fast if stored data is malformed. */
export function toShift(row: typeof shifts.$inferSelect): Shift {
  return Shift.parse(row)
}
