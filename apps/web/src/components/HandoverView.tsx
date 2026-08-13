import { useState } from "react"

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
    <section className="card" aria-labelledby="handover-heading">
      <h2 id="handover-heading">Shift handover</h2>
      <AsyncPanel
        state={handover.state}
        label="handover"
        onRetry={handover.reload}
        render={(h) => (
          <>
            <NarrativePanel client={client} shiftId={shiftId} facts={h} />
            <p className="hint">
              Deterministic facts for this shift, computed from the database — not written by a
              model.
            </p>
            <div className="counts">
              <Count label="Total" value={h.counts.total} />
              <Count label="Active" value={h.counts.active} />
              <Count label="In progress" value={h.counts.inProgress} />
              <Count label="Completed" value={h.counts.completed} />
              <Count label="Blocked" value={h.counts.blocked} />
              <Count label="Overdue" value={h.counts.overdue} />
            </div>

            {h.counts.total === 0 && (
              <p className="empty">
                This shift has no tasks yet, so there is nothing to hand over. Capture your workload
                on the Intake tab first.
              </p>
            )}

            <Section
              title="Completed"
              items={h.completed.map((t) => ({ id: t.taskId, text: t.title }))}
            />
            <Section
              title="Pending"
              items={h.pending.map((t) => ({
                id: t.taskId,
                text: t.title,
                note: `${t.priorityBucket}${t.dueInMin != null ? ` · due in ${t.dueInMin} min` : ""}`,
              }))}
            />
            <Section
              title="Blocked"
              items={h.blocked.map((t) => ({
                id: t.taskId,
                text: t.title,
                note: t.blockedBy.length > 0 ? `blocked by ${t.blockedBy.join(", ")}` : "blocked",
              }))}
            />
            <Section
              title="Overdue"
              items={h.overdue.map((t) => ({
                id: t.taskId,
                text: t.title,
                note: `${t.overdueMin} min overdue`,
                warn: true,
              }))}
            />
            <Section
              title="Recommended for the next shift"
              items={h.recommendations.map((r) => ({ id: r.taskId, text: r.title }))}
            />
          </>
        )}
      />
    </section>
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
    <div className="narrative">
      <div className="row between">
        <h3>Summary</h3>
        <button
          type="button"
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
        <p className="hint">
          The facts below are already complete. An AI summary is optional — it rephrases them for
          the next worker and adds nothing to them.
        </p>
      )}

      {state.status === "generating" && (
        <p className="loading" role="status" aria-busy="true">
          Asking the AI provider to draft a summary…
        </p>
      )}

      {state.status === "degraded" && (
        <div className="banner warning" role="alert">
          <strong>AI summary unavailable — showing verified facts only.</strong>
          <p className="hint">
            {state.detail}
            {state.reason === "unknown_task_reference" &&
              " The draft referred to a task that is not in this shift, so it was rejected."}
          </p>
          <div className="row">
            <button type="button" onClick={generate}>
              Try again
            </button>
          </div>
        </div>
      )}

      {state.status === "ready" && (
        <div className="ai-summary">
          <p className="ai-label">
            <span className="badge">AI-written</span> Drafted by the AI provider from the facts
            below. The facts, not this text, are the record.
          </p>
          <h4>{state.narrative.headline}</h4>
          <p>{state.narrative.summary}</p>
          {state.narrative.attention.length > 0 && (
            <>
              <h5>Look at first</h5>
              <ul>
                {state.narrative.attention.map((item) => (
                  <li key={item.taskId}>
                    {/* Title comes from the facts, never from the model. */}
                    <strong>{titles.get(item.taskId) ?? "Task"}</strong>
                    <span className="muted"> · {item.why}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  items,
}: {
  title: string
  items: Array<{ id: string; text: string; note?: string; warn?: boolean }>
}) {
  if (items.length === 0) return null
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.text}
            {item.note && (
              <span className={item.warn ? "warning-text" : "muted"}> · {item.note}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="count">
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </div>
  )
}
