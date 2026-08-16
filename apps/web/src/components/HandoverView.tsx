import { useState, type ReactNode } from "react"

import { ApiError } from "../api/client.js"
import type { ApiClient } from "../api/client.js"
import type { HandoverFacts, HandoverNarrative, HandoverResponse } from "@shiftpilot/contracts"
import { useAsync } from "../use-async.js"
import { AsyncPanel } from "./AsyncPanel.js"

/**
 * Every number here is computed by the domain engine from the database. No
 * model drafts these figures, so there is nothing to fabricate
 * (docs/architecture.md §4).
 */
export function HandoverView({ client, shiftId }: { client: ApiClient; shiftId: string }) {
  const handover = useAsync<HandoverFacts>(() => client.getHandover(shiftId), [shiftId])

  return (
    <div className="stagger-1" aria-labelledby="handover-heading">
      <div className="section-head" style={{ marginBottom: 12 }}>
        <h2 id="handover-heading" className="section-title">
          Shift handover
        </h2>
      </div>
      <AsyncPanel
        state={handover.state}
        label="handover"
        onRetry={handover.reload}
        render={(h) => (
          <div className="handover-facts">
            <NarrativePanel client={client} shiftId={shiftId} facts={h} />

            <div>
              <p className="eyebrow" style={{ marginBottom: 8 }}>
                Verified shift facts
              </p>
              <p className="meta" style={{ marginBottom: 12 }}>
                Computed from the database by deterministic domain code — not written by a model.
              </p>
            </div>

            {h.counts.total === 0 ? (
              <div className="empty-state">
                <p className="empty-title">Your shift is clear.</p>
                <p className="empty-copy">
                  This shift has no tasks yet, so there is nothing to hand over. Capture your
                  workload on the Intake tab first.
                </p>
              </div>
            ) : (
              <>
                <div className="fact-counts">
                  <FactCount label="Total" value={h.counts.total} />
                  <FactCount label="Active" value={h.counts.active} />
                  <FactCount label="In progress" value={h.counts.inProgress} />
                  <FactCount label="Completed" value={h.counts.completed} />
                  <FactCount label="Blocked" value={h.counts.blocked} />
                  <FactCount label="Overdue" value={h.counts.overdue} warn={h.counts.overdue > 0} />
                </div>

                <FactSection
                  title="Completed"
                  icon={
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M2 7l3.5 3.5L12 3.5" />
                    </svg>
                  }
                  empty="Nothing completed yet this shift."
                  items={h.completed.map((t) => ({
                    id: t.taskId,
                    text: t.title,
                    note: t.completedAt ? `done ${formatTime(t.completedAt)}` : undefined,
                  }))}
                />

                <FactSection
                  title="Remaining"
                  empty="Nothing left to carry over."
                  items={h.pending.map((t) => ({
                    id: t.taskId,
                    text: t.title,
                    note: `${t.priorityBucket}${t.dueInMin != null ? ` · due in ${t.dueInMin} min` : ""}`,
                  }))}
                />

                <FactSection
                  title="Blocked"
                  empty="No blockers detected."
                  items={h.blocked.map((t) => ({
                    id: t.taskId,
                    text: t.title,
                    note:
                      t.blockedBy.length > 0 ? `blocked by ${t.blockedBy.join(", ")}` : "blocked",
                  }))}
                />

                <FactSection
                  title="Overdue / attention"
                  empty="Nothing requiring special attention."
                  items={h.overdue.map((t) => ({
                    id: t.taskId,
                    text: t.title,
                    note: `${t.overdueMin} min overdue`,
                    warn: true,
                  }))}
                />

                {h.recommendations.length > 0 && (
                  <FactSection
                    title="Recommended for the next shift"
                    empty=""
                    items={h.recommendations.map((r) => ({ id: r.taskId, text: r.title }))}
                  />
                )}
              </>
            )}
          </div>
        )}
      />
    </div>
  )
}

function FactCount({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`fact-count ${warn ? "fc-warn" : ""}`}>
      <span className="fc-value">{value}</span>
      <span className="fc-label">{label}</span>
    </div>
  )
}

function FactSection({
  title,
  icon,
  items,
  empty,
}: {
  title: string
  icon?: ReactNode
  items: Array<{ id: string; text: string; note?: string; warn?: boolean }>
  empty?: string
}) {
  return (
    <div className="fact-section">
      <p className="fact-section-title">
        {icon}
        {title}
      </p>
      {items.length === 0 ? (
        <p className="meta">{empty}</p>
      ) : (
        <ul className="fact-list">
          {items.map((item) => (
            <li key={item.id} className="fact-item">
              {item.text}
              {item.note && (
                <span className={`fact-note ${item.warn ? "warn" : ""}`}> · {item.note}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type NarrativeState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "ready"; narrative: HandoverNarrative }
  | { status: "degraded"; reason: string; detail: string }

/**
 * AI prose over the top of the facts, on explicit request only.
 *
 * Three rules this panel enforces visually:
 *  - the facts below are always rendered, whatever happens here;
 *  - AI-written text is always labelled as AI-written;
 *  - a failure is always visible and always retryable — never blank space, and
 *    never a spinner that has quietly stopped meaning anything (audit A-24).
 */
function NarrativePanel({
  client,
  shiftId,
  facts,
}: {
  client: ApiClient
  shiftId: string
  facts: HandoverFacts
}) {
  const [state, setState] = useState<NarrativeState>({ status: "idle" })

  async function generate() {
    setState({ status: "generating" })
    try {
      const response: HandoverResponse = await client.generateHandoverNarrative(shiftId)
      if (response.narrative) {
        setState({ status: "ready", narrative: response.narrative })
        return
      }
      setState({
        status: "degraded",
        reason: response.degraded?.reason ?? "provider_failure",
        detail: response.degraded?.detail ?? "The AI summary was unavailable.",
      })
    } catch (error) {
      // A transport/HTTP failure lands here; a provider failure arrives as a
      // degraded 200 above. Both end in the same visible, recoverable state.
      setState({
        status: "degraded",
        reason: "provider_failure",
        detail: error instanceof ApiError ? error.message : "The AI summary request failed.",
      })
    }
  }

  const titles = new Map<string, string>([
    ...facts.completed.map((t) => [t.taskId, t.title] as const),
    ...facts.pending.map((t) => [t.taskId, t.title] as const),
    ...facts.blocked.map((t) => [t.taskId, t.title] as const),
    ...facts.overdue.map((t) => [t.taskId, t.title] as const),
  ])

  return (
    <div className="ai-prose">
      <div className="prose-head">
        <span className="prose-label">
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 8.5h6M3 6h4M3 9.5h5" />
          </svg>
          AI-written handover
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={generate}
          disabled={state.status === "generating" || facts.counts.total === 0}
        >
          {state.status === "generating"
            ? "Writing…"
            : state.status === "idle"
              ? "Write AI summary"
              : "Rewrite"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="meta">
          The facts below are already complete. An AI summary is optional — it rephrases them for
          the next worker and adds nothing to them. The facts, not this text, are the record.
        </p>
      )}

      {state.status === "generating" && (
        <p className="meta" role="status" aria-busy="true">
          Asking the AI provider to draft a summary…
        </p>
      )}

      {state.status === "degraded" && (
        <div className="banner banner-warning" role="alert">
          <strong>AI summary unavailable — verified shift facts remain available.</strong>
          <p className="meta" style={{ marginTop: 4 }}>
            {state.detail}
            {state.reason === "unknown_task_reference" &&
              " The draft referred to a task that is not in this shift, so it was rejected."}
          </p>
          <button type="button" className="btn btn-sm" onClick={generate}>
            Try again
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <div className="prose-body">
          <p className="ai-label meta">
            <span className="chip chip-accent">AI-written</span> Drafted by the AI provider from the
            verified facts below.
          </p>
          <p className="prose-headline">{state.narrative.headline}</p>
          <p className="prose-summary">{state.narrative.summary}</p>
          {state.narrative.attention.length > 0 && (
            <div className="prose-attention">
              <h5>Look at first</h5>
              <ul>
                {state.narrative.attention.map((item) => (
                  <li key={item.taskId}>
                    {/* Title comes from the facts, never from the model. */}
                    <strong>{titles.get(item.taskId) ?? "Task"}</strong>
                    <span className="meta"> · {item.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
