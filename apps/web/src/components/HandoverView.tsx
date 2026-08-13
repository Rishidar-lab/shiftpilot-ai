import type { ApiClient } from "../api/client.js"
import type { HandoverFacts } from "@shiftpilot/contracts"
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
