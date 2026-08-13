import { sql } from "drizzle-orm"
import { check, foreignKey, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

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

/**
 * A single natural-language intake. Persisted BEFORE any AI call so a provider
 * outage never loses the worker's words (docs/architecture.md §5). The AI never
 * writes here directly; `status` tracks the intake lifecycle.
 */
export const rawInputs = sqliteTable(
  "raw_inputs",
  {
    id: text("id").primaryKey(),
    shiftId: text("shift_id").notNull(),
    rawText: text("raw_text").notNull(),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
    failureKind: text("failure_kind"),
    failureMessage: text("failure_message"),
    /** JSON-encoded string[] of report-level warnings (e.g. oversized input). */
    reportWarnings: text("report_warnings").notNull(),
  },
  (table) => [foreignKey({ columns: [table.shiftId], foreignColumns: [shifts.id] })],
)

/**
 * One normalized, reviewable extraction item produced by the domain pipeline
 * for a RawInput. Persisted so the review/approval workflow is resumable and
 * so approval can promote drafts to real tasks in a transaction.
 */
export const extractionDrafts = sqliteTable(
  "extraction_drafts",
  {
    rawInputId: text("raw_input_id").notNull(),
    draftId: text("draft_id").notNull(),
    index: integer("index").notNull(),
    disposition: text("disposition").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    estimatedMinutes: integer("estimated_minutes"),
    deadlineAt: text("deadline_at"),
    deadlineSource: text("deadline_source").notNull(),
    explicitUrgency: text("explicit_urgency").notNull(),
    /** JSON-encoded string[] of dependency references (draft ids or raw text). */
    dependsOn: text("depends_on").notNull(),
    /** The source span this candidate was extracted from. */
    sourceText: text("source_text").notNull(),
    /** JSON-encoded string[] of machine reasons / review notes. */
    reasons: text("reasons").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.rawInputId, table.draftId] }),
    foreignKey({ columns: [table.rawInputId], foreignColumns: [rawInputs.id] }),
  ],
)
