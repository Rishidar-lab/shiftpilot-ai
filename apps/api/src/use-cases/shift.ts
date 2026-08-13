import { randomUUID } from "node:crypto"

import { listShiftRows, insertShift, getShiftRow, toShift } from "../repos/shift.js"
import type { Database } from "../db/index.js"
import { NotFoundError } from "./errors.js"
import type { CreateShiftRequest, Shift } from "@shiftpilot/contracts"

/**
 * The zone a shift's wall-clock phrases resolve against. Explicit when the
 * client states one; otherwise the server's own zone, which is the correct
 * default for the single-site, single-user Week-1 scope (docs/architecture.md §4).
 */
export function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

export function createShift(db: Database, dto: CreateShiftRequest): Shift {
  const now = new Date().toISOString()
  const shift: Shift = {
    id: randomUUID(),
    date: dto.date,
    startAt: dto.startAt,
    endAt: dto.endAt,
    timezone: dto.timezone ?? defaultTimeZone(),
    role: dto.role ?? null,
    createdAt: now,
  }
  insertShift(db, shift)
  return shift
}

export function getShift(db: Database, id: string): Shift {
  const row = getShiftRow(db, id)
  if (row === undefined) throw new NotFoundError("shift", id)
  return toShift(row)
}

export function listShifts(db: Database): Shift[] {
  return listShiftRows(db).map(toShift)
}
