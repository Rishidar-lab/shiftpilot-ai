import { eq } from "drizzle-orm"

import { taskDependencies, tasks } from "../db/schema.js"
import type { Database } from "../db/index.js"
import { Task } from "@shiftpilot/contracts"

export interface TaskWithDeps {
  row: typeof tasks.$inferSelect
  dependsOn: string[]
}

export function insertTask(
  db: Database,
  row: typeof tasks.$inferInsert,
  dependsOn: string[],
): void {
  db.insert(tasks).values(row).run()
  insertDependencies(db, row.id, dependsOn)
}

/** Insert only the task row (no dependency edges); used by the approval flow,
 *  which creates every row first and resolves dependency edges in a second pass. */
export function insertTaskRow(db: Database, row: typeof tasks.$inferInsert): void {
  db.insert(tasks).values(row).run()
}

export function getTask(db: Database, id: string): TaskWithDeps | undefined {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (row === undefined) return undefined
  return { row, dependsOn: dependenciesOf(db, id) }
}

export function listTasksByShift(db: Database, shiftId: string): TaskWithDeps[] {
  const rows = db.select().from(tasks).where(eq(tasks.shiftId, shiftId)).all()
  return rows.map((row) => ({ row, dependsOn: dependenciesOf(db, row.id) }))
}

export function updateTask(
  db: Database,
  id: string,
  patch: Partial<typeof tasks.$inferInsert>,
  dependsOn?: string[],
): void {
  db.update(tasks).set(patch).where(eq(tasks.id, id)).run()
  if (dependsOn !== undefined) {
    db.delete(taskDependencies).where(eq(taskDependencies.taskId, id)).run()
    insertDependencies(db, id, dependsOn)
  }
}

function dependenciesOf(db: Database, id: string): string[] {
  return db
    .select({ dependsOnId: taskDependencies.dependsOnId })
    .from(taskDependencies)
    .where(eq(taskDependencies.taskId, id))
    .all()
    .map((row) => row.dependsOnId)
}

function insertDependencies(db: Database, id: string, dependsOn: string[]): void {
  const unique = [...new Set(dependsOn)]
  if (unique.length === 0) return
  db.insert(taskDependencies)
    .values(unique.map((dependsOnId) => ({ taskId: id, dependsOnId })))
    .run()
}

/** Public so the approval use-case can resolve dependency edges after all
 *  approved rows exist (avoids forward-reference FK violations). */
export { insertDependencies }

export function toTask({ row, dependsOn }: TaskWithDeps): Task {
  return Task.parse({ ...row, dependsOn })
}
