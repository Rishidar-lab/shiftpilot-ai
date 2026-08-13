import type { ApiClient } from "../api/client.js"
import type { NextDecision, WorkPlan } from "@shiftpilot/contracts"
import { useAsync } from "../use-async.js"

export function PlanView({ client, shiftId }: { client: ApiClient; shiftId: string }) {
  const plan = useAsync<WorkPlan>(() => client.getPlan(shiftId), [shiftId])
  const next = useAsync(() => client.getNext(shiftId), [shiftId])

  if (plan.status === "loading") return <p>Loading plan…</p>
  if (plan.status === "error") {
    return (
      <div className="banner error" role="alert">
        Could not load plan: {plan.message}
      </div>
    )
  }

  const p = plan.data
  return (
    <section className="card">
      <h2>Work plan</h2>
      <p className="muted">
        {p.sequence.length} task(s) · {p.load.scheduledMinutes}/{p.load.availableMinutes} min
        scheduled
      </p>

      {next.status === "ready" && <NextPanel next={next.data} />}

      <ol className="plan">
        {p.sequence.map((task) => (
          <li key={task.task.id} className={`plan-item ${task.state}`}>
            <div className="row between">
              <strong>{task.task.title}</strong>
              <span className={`bucket ${task.priority?.bucket ?? "low"}`}>
                {task.priority?.bucket ?? "—"}
              </span>
            </div>
            <div className="muted">
              {task.task.status}
              {task.startAt && task.endAt
                ? ` · ${formatTime(task.startAt)}–${formatTime(task.endAt)}`
                : ""}
              {task.task.deadlineAt ? ` · due ${formatTime(task.task.deadlineAt)}` : ""}
            </div>
            {task.reasons.length > 0 && <p className="muted">{task.reasons.join(" · ")}</p>}
            {task.taskWarnings.length > 0 && (
              <p className="warning-text">{task.taskWarnings.join(" · ")}</p>
            )}
          </li>
        ))}
      </ol>

      {p.warnings.length > 0 && (
        <div className="banner warning">
          {p.warnings.map((w, i) => (
            <div key={i}>{w.type}</div>
          ))}
        </div>
      )}
    </section>
  )
}

function NextPanel({ next }: { next: NextDecision }) {
  if (next.kind === "task") {
    return (
      <div className="banner next">
        <strong>Next up:</strong> {next.title}
        {next.startAt ? ` at ${formatTime(next.startAt)}` : ""}
        {next.alternatives.length > 0 && (
          <span className="muted">
            {" "}
            · alternatives: {next.alternatives.map((a) => a.title).join(", ")}
          </span>
        )}
      </div>
    )
  }
  if (next.kind === "blocked") {
    return (
      <div className="banner warning">Blocked — resolve {next.blockedBy.join(", ")} first.</div>
    )
  }
  if (next.kind === "done")
    return <div className="banner success">All clear — nothing left this shift.</div>
  return <div className="banner warning">Shift has ended.</div>
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
