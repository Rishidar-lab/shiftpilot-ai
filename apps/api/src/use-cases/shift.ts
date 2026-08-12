import { randomUUID } from "node:crypto"

import { listShiftRows, insertShift, getShiftRow, toShift } from "../repos/shift.js"
import type { Database } from "../db/index.js"
import { NotFoundError } from "./errors.js"
import type { CreateShiftRequest, Shift } from "@shiftpilot/contracts"

export function createShift(db: Database, dto: CreateShiftRequest): Shift {
  const now = new Date().toISOString()
  const shift: Shift = {
    id: randomUUID(),
    date: dto.date,
    startAt: dto.startAt,
    endAt: dto.endAt,
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
