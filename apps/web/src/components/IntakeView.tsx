import { useEffect, useState } from "react"

import type { ApiClient } from "../api/client.js"
import { ApiError } from "../api/client.js"
import type { ApprovalResult, IntakeResult } from "../api/client.js"
import type { ExtractionDraft } from "@shiftpilot/contracts"
import { Category, UrgencyLevel } from "@shiftpilot/contracts"

interface DraftEdits {
  title: string
  category: string
  estimatedMinutes: string
  explicitUrgency: string
  deadlineAt: string
}

type Action = "approve" | "reject"

const EMPTY_EDITS: DraftEdits = {
  title: "",
  category: "",
  estimatedMinutes: "",
  explicitUrgency: "",
  deadlineAt: "",
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function IntakeView({
  client,
  shiftId,
  onApproved,
}: {
  client: ApiClient
  shiftId: string
  onApproved: () => void
}) {
  const [rawText, setRawText] = useState("")
  const [intake, setIntake] = useState<IntakeResult | null>(null)
  const [edits, setEdits] = useState<Record<string, DraftEdits>>({})
  const [actions, setActions] = useState<Record<string, Action>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApprovalResult | null>(null)

  async function handleExtract() {
    setError(null)
    setResult(null)
    setSubmitting(true)
    try {
      const created = await client.createIntake(shiftId, rawText)
      setIntake(created)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to extract tasks")
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (!intake) return
    const draftEdits: Record<string, DraftEdits> = {}
    const draftActions: Record<string, Action> = {}
    for (const draft of intake.report.drafts) {
      draftEdits[draft.id] = {
        title: draft.title,
        category: draft.category ?? "",
        estimatedMinutes: draft.estimatedMinutes != null ? String(draft.estimatedMinutes) : "",
        explicitUrgency: draft.explicitUrgency ?? "",
        deadlineAt: toLocalInput(draft.deadlineAt),
      }
      draftActions[draft.id] = draft.disposition === "rejected" ? "reject" : "approve"
    }
    setEdits(draftEdits)
    setActions(draftActions)
  }, [intake])

  async function handleApprove() {
    if (!intake) return
    setError(null)
    setSubmitting(true)
    try {
      const decisions = intake.report.drafts.map((draft) => {
        const action = actions[draft.id] ?? "approve"
        const e = edits[draft.id] ?? {
          title: draft.title,
          category: draft.category ?? "",
          estimatedMinutes: draft.estimatedMinutes != null ? String(draft.estimatedMinutes) : "",
          explicitUrgency: draft.explicitUrgency ?? "",
          deadlineAt: toLocalInput(draft.deadlineAt),
        }
        if (action === "reject") {
          return { draftId: draft.id, action: "reject" as const }
        }
        return {
          draftId: draft.id,
          action: "approve" as const,
          edits: {
            title: e.title || draft.title,
            category: (e.category || draft.category || "other") as Category,
            estimatedMinutes: e.estimatedMinutes
              ? Number(e.estimatedMinutes)
              : draft.estimatedMinutes,
            explicitUrgency: (e.explicitUrgency || draft.explicitUrgency) as UrgencyLevel,
            deadlineAt: fromLocalInput(e.deadlineAt) ?? draft.deadlineAt,
            dependsOn: draft.dependsOn,
          },
        }
      })
      const approval = await client.approveIntake(intake.rawInput.id, decisions)
      setResult(approval)
      onApproved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve intake")
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <section className="card">
        <h2>Intake approved</h2>
        <p className="success">{result.createdTasks.length} task(s) created from this intake.</p>
        <ul>
          {result.createdTasks.map((t) => (
            <li key={t.id}>
              {t.title} <span className="muted">· {t.category}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            setResult(null)
            setIntake(null)
            setRawText("")
          }}
        >
          New intake
        </button>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Natural-language intake</h2>
      <p className="hint">
        Type your shift tasks in plain language. Shift Pilot extracts structured tasks for your
        review — nothing becomes a real task until you approve it.
      </p>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        rows={5}
        placeholder={
          "e.g.\nRestock aisle 3 by 3pm, 15 min\nUrgent: evacuate if alarm\nLunch break at noon"
        }
      />
      <div className="row">
        <button
          type="button"
          onClick={handleExtract}
          disabled={submitting || rawText.trim() === ""}
        >
          {submitting ? "Extracting…" : "Extract tasks"}
        </button>
        {intake && (
          <button type="button" onClick={() => setIntake(null)}>
            Clear
          </button>
        )}
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {intake && (
        <IntakeReview
          intake={intake}
          edits={edits}
          actions={actions}
          onEdit={(id, patch) =>
            setEdits((prev) => {
              const current = prev[id] ?? EMPTY_EDITS
              return { ...prev, [id]: { ...current, ...patch } }
            })
          }
          onAction={(id, action) => setActions((prev) => ({ ...prev, [id]: action }))}
          onSubmit={handleApprove}
          submitting={submitting}
        />
      )}
    </section>
  )
}

function IntakeReview({
  intake,
  edits,
  actions,
  onEdit,
  onAction,
  onSubmit,
  submitting,
}: {
  intake: IntakeResult
  edits: Record<string, DraftEdits>
  actions: Record<string, Action>
  onEdit: (id: string, patch: Partial<DraftEdits>) => void
  onAction: (id: string, action: Action) => void
  onSubmit: () => void
  submitting: boolean
}) {
  const { report } = intake
  const approvedCount = report.drafts.filter((d) => actions[d.id] !== "reject").length

  return (
    <div className="review">
      {report.warnings.length > 0 && (
        <div className="banner warning">
          {report.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
      <div className="row between">
        <h3>Extracted tasks ({report.drafts.length})</h3>
        <span className="muted">
          provider: {intake.rawInput.provider} · {intake.rawInput.promptVersion}
        </span>
      </div>

      {report.drafts.map((draft) => (
        <DraftCard
          key={draft.id}
          draft={draft}
          edits={edits[draft.id] ?? EMPTY_EDITS}
          action={actions[draft.id] ?? "approve"}
          onEdit={onEdit}
          onAction={onAction}
        />
      ))}

      <div className="row">
        <button type="button" onClick={onSubmit} disabled={submitting || approvedCount === 0}>
          {submitting ? "Approving…" : `Approve ${approvedCount} task(s)`}
        </button>
      </div>
    </div>
  )
}

function DraftCard({
  draft,
  edits,
  action,
  onEdit,
  onAction,
}: {
  draft: ExtractionDraft
  edits: DraftEdits
  action: Action
  onEdit: (id: string, patch: Partial<DraftEdits>) => void
  onAction: (id: string, action: Action) => void
}) {
  const rejected = draft.disposition === "rejected"
  return (
    <article className={`draft ${draft.disposition} ${action === "reject" ? "is-rejected" : ""}`}>
      <div className="row between">
        <span className={`disposition ${draft.disposition}`}>{draft.disposition}</span>
        {!rejected && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={action === "approve"}
              onChange={(e) => onAction(draft.id, e.target.checked ? "approve" : "reject")}
            />
            Approve
          </label>
        )}
      </div>

      <input
        className="title"
        value={edits.title}
        onChange={(e) => onEdit(draft.id, { title: e.target.value })}
        disabled={rejected}
      />

      <div className="grid">
        <label>
          Category
          <select
            value={edits.category}
            onChange={(e) => onEdit(draft.id, { category: e.target.value })}
            disabled={rejected}
          >
            <option value="">(unset)</option>
            {Category.options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Urgency
          <select
            value={edits.explicitUrgency}
            onChange={(e) => onEdit(draft.id, { explicitUrgency: e.target.value })}
            disabled={rejected}
          >
            <option value="">(none)</option>
            {UrgencyLevel.options.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label>
          Duration (min)
          <input
            type="number"
            min={1}
            max={480}
            value={edits.estimatedMinutes}
            onChange={(e) => onEdit(draft.id, { estimatedMinutes: e.target.value })}
            disabled={rejected}
          />
        </label>
        <label>
          Deadline
          <input
            type="datetime-local"
            value={edits.deadlineAt}
            onChange={(e) => onEdit(draft.id, { deadlineAt: e.target.value })}
            disabled={rejected}
          />
        </label>
      </div>

      {draft.dependsOn.length > 0 && (
        <p className="muted">Depends on: {draft.dependsOn.join(", ")}</p>
      )}
      {draft.reasons.length > 0 && (
        <ul className="reasons">
          {draft.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {rejected && <p className="muted">This candidate was rejected and will not become a task.</p>}
    </article>
  )
}
