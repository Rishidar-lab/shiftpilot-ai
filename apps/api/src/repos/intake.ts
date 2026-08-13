import { eq } from "drizzle-orm"

import { extractionDrafts, rawInputs } from "../db/schema.js"
import type { Database } from "../db/index.js"
import { ExtractionDraft, RawInput } from "@shiftpilot/contracts"

export type RawInputRow = typeof rawInputs.$inferSelect
export type DraftRow = typeof extractionDrafts.$inferSelect

export function insertRawInput(db: Database, row: typeof rawInputs.$inferInsert): void {
  db.insert(rawInputs).values(row).run()
}

export function getRawInputRow(db: Database, id: string): RawInputRow | undefined {
  return db.select().from(rawInputs).where(eq(rawInputs.id, id)).get()
}

export function updateRawInput(
  db: Database,
  id: string,
  patch: Partial<typeof rawInputs.$inferInsert>,
): void {
  db.update(rawInputs).set(patch).where(eq(rawInputs.id, id)).run()
}

export function insertDrafts(db: Database, rawInputId: string, drafts: ExtractionDraft[]): void {
  if (drafts.length === 0) return
  db.insert(extractionDrafts)
    .values(drafts.map((d) => toDraftRow(d, rawInputId)))
    .run()
}

export function listDraftRows(db: Database, rawInputId: string): DraftRow[] {
  return db.select().from(extractionDrafts).where(eq(extractionDrafts.rawInputId, rawInputId)).all()
}

/** Reconstruct a contracts RawInput from its DB row (drops the JSON warnings column). */
export function toRawInput(row: RawInputRow): RawInput {
  return RawInput.parse({
    id: row.id,
    shiftId: row.shiftId,
    rawText: row.rawText,
    status: row.status,
    provider: row.provider,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
    failureKind: row.failureKind,
    failureMessage: row.failureMessage,
  })
}

export function toDraft(row: DraftRow): ExtractionDraft {
  return ExtractionDraft.parse({
    id: row.draftId,
    index: row.index,
    disposition: row.disposition,
    title: row.title,
    description: row.description,
    category: row.category,
    estimatedMinutes: row.estimatedMinutes,
    deadlineAt: row.deadlineAt,
    deadlineSource: row.deadlineSource,
    explicitUrgency: row.explicitUrgency,
    dependsOn: JSON.parse(row.dependsOn) as string[],
    sourceText: row.sourceText,
    reasons: JSON.parse(row.reasons) as string[],
  })
}

function toDraftRow(
  draft: ExtractionDraft,
  rawInputId: string,
): typeof extractionDrafts.$inferInsert {
  return {
    rawInputId,
    draftId: draft.id,
    index: draft.index,
    disposition: draft.disposition,
    title: draft.title,
    description: draft.description,
    category: draft.category,
    estimatedMinutes: draft.estimatedMinutes,
    deadlineAt: draft.deadlineAt,
    deadlineSource: draft.deadlineSource,
    explicitUrgency: draft.explicitUrgency,
    dependsOn: JSON.stringify(draft.dependsOn),
    sourceText: draft.sourceText,
    reasons: JSON.stringify(draft.reasons),
  }
}
