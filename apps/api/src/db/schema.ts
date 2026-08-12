import { sql } from "drizzle-orm"
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

/** snake_case columns mirror the contracts entities (docs/architecture.md §4). */
export const shifts = sqliteTable("shifts", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  role: text("role"),
  createdAt: text("created_at").notNull(),
})

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  shiftId: text("shift_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  estimatedMinutes: integer("estimated_minutes"),
  deadlineAt: text("deadline_at"),
  deadlineSource: text("deadline_source").notNull(),
  explicitUrgency: text("explicit_urgency").notNull(),
  status: text("status").notNull(),
  blockReason: text("block_reason"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
})

export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    taskId: text("task_id").notNull(),
    dependsOnId: text("depends_on_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnId] }),
    check("no_self_dependency", sql`${table.taskId} != ${table.dependsOnId}`),
  ],
)
