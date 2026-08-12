/**
 * Persistence boundary — M0: TYPES ONLY, nothing wired yet.
 * The SQLite/Drizzle implementation lands in M1 when the first persistence-
 * dependent feature needs it (docs/implementation-plan.md P-01/P-02).
 * Shapes are provisional and may change when M1 lands; no code calls these yet.
 */

export interface ShiftRecord {
  id: string
  date: string
  startMin: number
  endMin: number
  role: string
  createdAt: string
}

export interface TaskRecord {
  id: string
  shiftId: string
  inputId: string | null
  title: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface ShiftRepository {
  insert(shift: ShiftRecord): Promise<void>
  getById(id: string): Promise<ShiftRecord | null>
  list(): Promise<ShiftRecord[]>
}

export interface TaskRepository {
  insertMany(tasks: TaskRecord[]): Promise<void>
  listByShift(shiftId: string): Promise<TaskRecord[]>
}
