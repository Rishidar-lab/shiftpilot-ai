import { useEffect, useState } from "react"

import type { ApiClient } from "../api/client.js"
import { ApiError } from "../api/client.js"
import type { ApprovalResult, IntakeResult } from "../api/client.js"
import type { ExtractionDraft } from "@shiftpilot/contracts"
import { Category, UrgencyLevel } from "@shiftpilot/contracts"
import { COMPOSER_EXAMPLES, DEMO_WORKLOAD, describeProviderError } from "../demo.js"

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

/** Server pipeline stages, shown in their real order during extraction. */
const PIPELINE_STAGES = ["Persist input", "AI extraction", "Structure check", "Preparing review"]

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

function editsFor(draft: ExtractionDraft): DraftEdits {
  return {
    title: draft.title,
    category: draft.category ?? "",
    estimatedMinutes: draft.estimatedMinutes != null ? String(draft.estimatedMinutes) : "",
    explicitUrgency: draft.explicitUrgency,
    deadlineAt: toLocalInput(draft.deadlineAt),
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
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
  // A landing quick-action can prefill the composer via sessionStorage. Read it
  // once on mount and clear it so a later manual visit starts blank.
  const [rawText, setRawText] = useState(() => {
    if (typeof sessionStorage === "undefined") return ""
    const intent = sessionStorage.getItem("shiftpilot:intent")
    if (intent) sessionStorage.removeItem("shiftpilot:intent")
    return intent ?? ""
  })
  const [intake, setIntake] = useState<IntakeResult | null>(null)
  const [edits, setEdits] = useState<Record<string, DraftEdits>>({})
  const [actions, setActions] = useState<Record<string, Action>>({})
  const [extracting, setExtracting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApprovalResult | null>(null)

  async function handleExtract() {
    setError(null)
    setResult(null)
    setExtracting(true)
    try {
      setIntake(await client.createIntake(shiftId, rawText))
    } catch (err) {
      if (err instanceof ApiError) {
        setError(describeProviderError(err.code, err.message))
      } else {
        setError("Could not extract tasks")
      }
    } finally {
      setExtracting(false)
    }
  }

  useEffect(() => {
    if (!intake) return
    const draftEdits: Record<string, DraftEdits> = {}
    const draftActions: Record<string, Action> = {}
    for (const draft of intake.report.drafts) {
      draftEdits[draft.id] = editsFor(draft)
      draftActions[draft.id] = draft.disposition === "rejected" ? "reject" : "approve"
    }
    setEdits(draftEdits)
    setActions(draftActions)
  }, [intake])

  async function handleApprove() {
    if (!intake) return
    setError(null)
    setApproving(true)
    try {
      const decisions = intake.report.drafts
        // A draft the pipeline rejected can never become a task; the server
        // enforces this too, so do not even offer it.
        .filter((draft) => draft.disposition !== "rejected")
        .map((draft) => {
          const action = actions[draft.id] ?? "approve"
          if (action === "reject") return { draftId: draft.id, action: "reject" as const }
          const e = edits[draft.id] ?? editsFor(draft)
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
      setResult(await client.approveIntake(intake.rawInput.id, decisions))
      onApproved()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(describeProviderError(err.code, err.message))
      } else {
        setError("Could not approve this intake")
      }
    } finally {
      setApproving(false)
    }
  }

  if (result) {
    return (
      <div className="panel panel-pad stagger-1" aria-labelledby="approved-heading">
        <h2 id="approved-heading" className="section-title" style={{ marginBottom: 8 }}>
          Intake approved
        </h2>
        <p className="banner banner-success" role="status">
          {result.createdTasks.length} task(s) created from this intake.
        </p>
        <ul className="handover-facts" style={{ marginTop: 12 }}>
          {result.createdTasks.map((t) => (
            <li key={t.id} className="fact-item" style={{ borderTop: "1px solid var(--border)" }}>
              {t.title}{" "}
              <span className="chip chip-muted meta" style={{ marginLeft: 4 }}>
                {t.category}
              </span>
            </li>
          ))}
        </ul>

        <div className="trust-timeline" aria-label="Processing timeline">
          <TimelineItem n={1} state="done" title="Input persisted" />
          <TimelineItem
            n={2}
            state="done"
            title="AI extraction"
            copy={`${result.rawInput.provider} · prompt ${result.rawInput.promptVersion}`}
          />
          <TimelineItem n={3} state="done" title="Schema validation" />
          <TimelineItem
            n={4}
            state="done"
            title="Review required"
            copy="Every candidate was reviewed and decided."
          />
          <TimelineItem n={5} state="done" title="Human approval" />
          <TimelineItem
            n={6}
            state="current"
            title="Planner recomputes"
            copy="Open the plan to see your re-sequenced shift."
          />
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setResult(null)
            setIntake(null)
            setRawText("")
          }}
        >
          New intake
        </button>
      </div>
    )
  }

  return (
    <div className="stagger-1">
      <div className="composer">
        <div className="composer-top">
          <label className="composer-question" htmlFor="intake-text">
            What needs to happen this shift?
          </label>
          <textarea
            id="intake-text"
            className="composer-textarea"
            aria-describedby="intake-help"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && rawText.trim() !== "") {
                e.preventDefault()
                handleExtract()
              }
            }}
            rows={6}
            placeholder={
              "Describe everything you need to get done…\n\ne.g. Restock aisle 3 by 3pm, 15 min · Call Mrs Chen about her order"
            }
          />
        </div>
        <div className="composer-examples">
          <span className="composer-examples-label">Try:</span>
          {Object.entries(COMPOSER_EXAMPLES).map(([label, content]) => (
            <button
              key={label}
              type="button"
              className="example-chip"
              onClick={() => setRawText(content)}
            >
              {label}
            </button>
          ))}
          {rawText !== "" && (
            <button type="button" className="example-chip" onClick={() => setRawText("")}>
              Clear
            </button>
          )}
        </div>
        <div className="composer-actions">
          <span className="composer-hint" id="intake-help">
            Multi-line works · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to build · nothing becomes a task
            until you approve it
          </span>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleExtract}
            disabled={extracting || rawText.trim() === ""}
          >
            {extracting ? "Building your shift…" : "Build my shift"}
          </button>
        </div>
      </div>

      <div className="composer-examples" style={{ marginTop: 8, padding: 0 }}>
        <span className="composer-examples-label">Demo workload:</span>
        <button type="button" className="example-chip" onClick={() => setRawText(DEMO_WORKLOAD)}>
          Try demo workload
        </button>
      </div>

      {extracting && <PipelineProgress />}

      {error && (
        <div className="banner banner-error" role="alert" style={{ marginTop: 12 }}>
          <strong>Extraction failed.</strong> {error}
          <p className="meta" style={{ marginTop: 4 }}>
            Your text was saved — nothing was lost.
          </p>
          <button type="button" className="btn" onClick={handleExtract} disabled={extracting}>
            Try again
          </button>
        </div>
      )}

      {intake && (
        <IntakeReview
          intake={intake}
          edits={edits}
          actions={actions}
          onEdit={(id, patch) =>
            setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_EDITS), ...patch } }))
          }
          onAction={(id, action) => setActions((prev) => ({ ...prev, [id]: action }))}
          onSubmit={handleApprove}
          submitting={approving}
        />
      )}
    </div>
  )
}

function PipelineProgress() {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setStage((s) => (s + 1) % PIPELINE_STAGES.length), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="pipeline" role="status" aria-busy="true" aria-live="polite">
      <p className="pipeline-label">Processing your workload through the ShiftPilot pipeline</p>
      <div className="pipeline-stages">
        {PIPELINE_STAGES.map((s, i) => (
          <span key={s} className={`pipeline-stage ${i === stage ? "active" : ""}`}>
            <span className="dot" aria-hidden="true" />
            {s}
          </span>
        ))}
      </div>
      <div className="pipeline-bar" aria-hidden="true" />
    </div>
  )
}

function TimelineItem({
  n,
  state,
  title,
  copy,
}: {
  n: number
  state: "done" | "current" | "pending"
  title: string
  copy?: string
}) {
  return (
    <div className={`tl-item ${state}`}>
      <span className="tl-dot" aria-hidden="true">
        {state === "done" ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1.5 5.5L4 8l4.5-6" />
          </svg>
        ) : (
          n
        )}
      </span>
      <div className="tl-body">
        <p className="tl-title">{title}</p>
        {copy && <p className="tl-copy">{copy}</p>}
      </div>
    </div>
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
  const reviewable = report.drafts.filter((d) => d.disposition !== "rejected")
  const approvedCount = reviewable.filter((d) => (actions[d.id] ?? "approve") !== "reject").length

  if (report.drafts.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 12 }}>
        <p className="empty-title">No tasks could be read from that text.</p>
        <p className="empty-copy">Try listing one task per line, e.g. “Restock aisle 3 by 3pm”.</p>
      </div>
    )
  }

  return (
    <div className="review" style={{ marginTop: 16 }}>
      <div className="trust-timeline" aria-label="Processing timeline">
        <TimelineItem
          n={1}
          state="done"
          title="Input persisted"
          copy="Your text is durable before any AI call."
        />
        <TimelineItem
          n={2}
          state="done"
          title="AI extraction"
          copy={`${intake.rawInput.provider} · prompt ${intake.rawInput.promptVersion}`}
        />
        <TimelineItem
          n={3}
          state="done"
          title="Schema validation"
          copy={`${report.drafts.length} candidate(s) passed the trust boundary.`}
        />
        <TimelineItem
          n={4}
          state="current"
          title="Review required"
          copy="You are in control of every candidate below."
        />
        <TimelineItem n={5} state="pending" title="Human approval" />
        <TimelineItem n={6} state="pending" title="Planner recomputed" />
      </div>

      {report.warnings.length > 0 && (
        <div className="banner banner-warning" role="status">
          {report.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className="review-head" style={{ margin: "16px 0" }}>
        <h3 className="section-title">Extracted tasks ({report.drafts.length})</h3>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
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
      </div>

      <div className="bulk-approve" style={{ marginTop: 16 }}>
        <p className="bulk-copy">
          <strong>
            Approve {approvedCount} valid task{approvedCount === 1 ? "" : "s"}
          </strong>
          {approvedCount === 0 && " — select at least one task to approve"}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={submitting || approvedCount === 0}
        >
          {submitting
            ? "Approving…"
            : `Approve ${approvedCount} task${approvedCount === 1 ? "" : "s"}`}
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
    <article
      className={`review-card ${draft.disposition} ${action === "reject" ? "is-rejected" : ""}`}
    >
      <div className="review-card-top">
        <span className={`review-status ${draft.disposition}`}>
          <span className="dot" aria-hidden="true" />
          {draft.disposition === "needsReview" ? "Needs review" : draft.disposition}
        </span>
        {!rejected && (
          <label className="approve-toggle" htmlFor={`approve-${draft.id}`}>
            <input
              id={`approve-${draft.id}`}
              type="checkbox"
              checked={action === "approve"}
              onChange={(e) => onAction(draft.id, e.target.checked ? "approve" : "reject")}
            />
            {action === "approve" ? "Approve" : "Rejected — click to approve"}
          </label>
        )}
      </div>

      <label htmlFor={`title-${draft.id}`} style={{ fontSize: "0.78rem", color: "var(--text-3)" }}>
        Task title
      </label>
      <input
        id={`title-${draft.id}`}
        className="review-title-input"
        value={edits.title}
        onChange={(e) => onEdit(draft.id, { title: e.target.value })}
        disabled={rejected}
      />

      <div className="review-meta-grid">
        <label className="field-label" htmlFor={`category-${draft.id}`}>
          Category
          <select
            id={`category-${draft.id}`}
            className="field"
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
        <label className="field-label" htmlFor={`urgency-${draft.id}`}>
          Urgency
          <select
            id={`urgency-${draft.id}`}
            className="field"
            value={edits.explicitUrgency}
            onChange={(e) => onEdit(draft.id, { explicitUrgency: e.target.value })}
            disabled={rejected}
          >
            {UrgencyLevel.options.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label" htmlFor={`minutes-${draft.id}`}>
          Duration (min)
          <input
            id={`minutes-${draft.id}`}
            className="field"
            type="number"
            min={1}
            max={480}
            value={edits.estimatedMinutes}
            onChange={(e) => onEdit(draft.id, { estimatedMinutes: e.target.value })}
            disabled={rejected}
          />
        </label>
        <label className="field-label" htmlFor={`deadline-${draft.id}`}>
          Deadline
          <input
            id={`deadline-${draft.id}`}
            className="field"
            type="datetime-local"
            value={edits.deadlineAt}
            onChange={(e) => onEdit(draft.id, { deadlineAt: e.target.value })}
            disabled={rejected}
          />
        </label>
      </div>

      <div className="review-provenance">
        {draft.estimatedMinutes != null && (
          <span
            className={`chip ${draft.estimateSource === "inferred" ? "chip-inferred" : "chip-accent"}`}
          >
            {draft.estimatedMinutes} min
            {draft.estimateSource === "inferred" ? " · AI estimate" : ""}
          </span>
        )}
        {draft.estimatedMinutes == null && <span className="chip chip-muted">No duration</span>}
        {draft.deadlineHint && (
          <span
            className={`chip ${draft.deadlineSource === "unresolved" ? "chip-warning" : "chip-info"}`}
          >
            Due: “{draft.deadlineHint}”
          </span>
        )}
        {draft.deadlineAt && draft.deadlineSource !== "unresolved" && (
          <span className="chip chip-info">Resolved: {formatTime(draft.deadlineAt)}</span>
        )}
        {draft.explicitUrgency && draft.explicitUrgency !== "none" && (
          <span className="chip chip-warning">{draft.explicitUrgency} urgency</span>
        )}
        {draft.dependsOn.length > 0 && (
          <span className="chip chip-info">Depends on: {draft.dependsOn.join(", ")}</span>
        )}
        <span
          className={`chip ${draft.estimateSource === "inferred" ? "chip-accent" : draft.estimateSource === "stated" ? "chip-success" : "chip-muted"}`}
        >
          {draft.estimateSource === "stated"
            ? "User stated"
            : draft.estimateSource === "inferred"
              ? "AI interpreted"
              : "Defaulted"}
        </span>
      </div>

      {draft.deadlineHint && draft.deadlineSource === "unresolved" && (
        <p className="review-note warn" style={{ marginTop: 4 }}>
          Deadline “{draft.deadlineHint}” was not understood — please set it yourself.
        </p>
      )}

      {draft.reasons.length > 0 && (
        <div className="review-reasons">
          {draft.reasons.map((r, i) => (
            <span key={i} className="review-reason">
              <span aria-hidden="true">⚠</span> {r}
            </span>
          ))}
        </div>
      )}

      {rejected && (
        <p className="review-note">
          Rejected by validation ({draft.rejectionReason ?? "policy"}) — it will not become a task.
        </p>
      )}

      {!rejected && (
        <div className="review-actions">
          <button type="button" className="btn btn-sm" onClick={() => onAction(draft.id, "reject")}>
            Reject
          </button>
        </div>
      )}
    </article>
  )
}
