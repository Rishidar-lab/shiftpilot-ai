import type { ApiClient } from "../api/client.js"
import type { HandoverFacts } from "@shiftpilot/contracts"
import { useAsync } from "../use-async.js"

export function HandoverView({ client, shiftId }: { client: ApiClient; shiftId: string }) {
  const handover = useAsync<HandoverFacts>(() => client.getHandover(shiftId), [shiftId])

  if (handover.status === "loading") return <p>Loading handover…</p>
  if (handover.status === "error") {
    return (
      <div className="banner error" role="alert">
        Could not load handover: {handover.message}
      </div>
    )
  }

  const h = handover.data
  return (
    <section className="card">
      <h2>Shift handover</h2>
      <div className="counts">
        <Count label="Total" value={h.counts.total} />
        <Count label="Active" value={h.counts.active} />
        <Count label="In progress" value={h.counts.inProgress} />
        <Count label="Completed" value={h.counts.completed} />
        <Count label="Blocked" value={h.counts.blocked} />
        <Count label="Overdue" value={h.counts.overdue} />
      </div>

      {h.pending.length > 0 && (
        <div>
          <h3>Pending</h3>
          <ul>
            {h.pending.map((t) => (
              <li key={t.taskId}>
                {t.title} <span className="muted">· {t.priorityBucket}</span>
                {t.dueInMin != null && <span className="muted"> · due in {t.dueInMin} min</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {h.blocked.length > 0 && (
        <div>
          <h3>Blocked</h3>
          <ul>
            {h.blocked.map((t) => (
              <li key={t.taskId}>
                {t.title} <span className="muted">· blocked by {t.blockedBy.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {h.overdue.length > 0 && (
        <div>
          <h3>Overdue</h3>
          <ul>
            {h.overdue.map((t) => (
              <li key={t.taskId}>
                {t.title} <span className="warning-text">· {t.overdueMin} min overdue</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {h.recommendations.length > 0 && (
        <div>
          <h3>Recommendations</h3>
          <ul>
            {h.recommendations.map((r) => (
              <li key={r.taskId}>{r.title}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
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
