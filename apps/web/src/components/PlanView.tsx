import { useState } from "react"

import type { ApiClient } from "../api/client.js"
import { ApiError } from "../api/client.js"
import type { NextDecision, Task, TaskStatus, WorkPlan } from "@shiftpilot/contracts"
import { useAsync } from "../use-async.js"
import { AsyncPanel } from "./AsyncPanel.js"

/**
 * The plan and the "what next" answer are separate requests, so each gets its
 * own explicit loading/error/retry surface. Task actions re-run both: the plan
 * is a derived projection, so the way to keep it fresh is to recompute it, never
 * to patch it client-side.
 */
export function PlanView({ client, shiftId }: { client: ApiClient; shiftId: string }) {
  const plan = useAsync<WorkPlan>(() => client.getPlan(shiftId), [shiftId])
  const next = useAsync<NextDecision>(() => client.getNext(shiftId), [shiftId])
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function runAction(taskId: string, action: () => Promise<Task>) {
    setActionError(null)
    setPendingTaskId(taskId)
    try {
      await action()
      plan.reload()
      next.reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update the task")
    } finally {
      setPendingTaskId(null)
    }
  }

  return (
    <section className="card" aria-labelledby="plan-heading">
      <h2 id="plan-heading">Work plan</h2>

      <AsyncPanel
        state={next.state}
        label="next action"
        onRetry={next.reload}
        render={(decision) => <NextPanel next={decision} />}
      />

      {actionError && (
        <div className="banner error" role="alert">
          {actionError}
        </div>
      )}

      <AsyncPanel
        state={plan.state}
        label="plan"
        onRetry={plan.reload}
        render={(data) => (
          <>
            <p className="muted">
              {data.sequence.length} task(s) · {data.load.scheduledMinutes}/
              {data.load.availableMinutes} min scheduled
            </p>

            {data.sequence.length === 0 ? (
              <p className="empty">
                Nothing scheduled yet. Capture your workload on the Intake tab and approve the
                extracted tasks — the plan builds itself from there.
              </p>
            ) : (
              <ol className="plan">
                {data.sequence.map((entry) => (
                  <li key={entry.task.id} className={`plan-item ${entry.state}`}>
                    <div className="row between">
                      <strong>{entry.task.title}</strong>
                      <span className={`bucket ${entry.priority?.bucket ?? "low"}`}>
                        {entry.priority?.bucket ?? "—"}
                      </span>
                    </div>
                    <div className="muted">
                      {entry.task.status}
                      {entry.startAt && entry.endAt
                        ? ` · ${formatTime(entry.startAt)}–${formatTime(entry.endAt)}`
                        : ""}
                      {entry.task.deadlineAt ? ` · due ${formatTime(entry.task.deadlineAt)}` : ""}
                    </div>
                    {entry.reasons.length > 0 && (
                      <p className="muted">{entry.reasons.join(" · ")}</p>
                    )}
                    {entry.taskWarnings.length > 0 && (
                      <p className="warning-text">{entry.taskWarnings.join(" · ")}</p>
                    )}
                    <TaskActions
                      task={entry.task}
                      busy={pendingTaskId === entry.task.id}
                      onStatus={(status) =>
                        runAction(entry.task.id, () => client.updateTask(entry.task.id, { status }))
                      }
                      onBlock={(reason) =>
                        runAction(entry.task.id, () => client.blockTask(entry.task.id, reason))
                      }
                    />
                  </li>
                ))}
              </ol>
            )}

            {data.warnings.length > 0 && (
              <div className="banner warning">
                {data.warnings.map((w, i) => (
                  <div key={i}>{describeWarning(w.type)}</div>
                ))}
              </div>
            )}
          </>
        )}
      />
    </section>
  )
}

const NEXT_STATUS: Partial<Record<TaskStatus, { label: string; to: TaskStatus }>> = {
  active: { label: "Start", to: "in_progress" },
  in_progress: { label: "Complete", to: "completed" },
  blocked: { label: "Unblock", to: "active" },
  completed: { label: "Reopen", to: "active" },
}

function TaskActions({
  task,
  busy,
  onStatus,
  onBlock,
}: {
  task: Task
  busy: boolean
  onStatus: (status: TaskStatus) => void
  onBlock: (reason: string) => void
}) {
  const [blocking, setBlocking] = useState(false)
  const [reason, setReason] = useState("")
  const primary = NEXT_STATUS[task.status]

  if (blocking) {
    return (
      <form
        className="row block-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim() === "") return
          onBlock(reason.trim())
          setBlocking(false)
          setReason("")
        }}
      >
        <label htmlFor={`block-reason-${task.id}`}>Why is it blocked?</label>
        <input
          id={`block-reason-${task.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. waiting on delivery"
          required
        />
        <button type="submit" disabled={reason.trim() === ""}>
          Save
        </button>
        <button type="button" onClick={() => setBlocking(false)}>
          Cancel
        </button>
      </form>
    )
  }

  return (
    <div className="row actions">
      {primary && (
        <button type="button" onClick={() => onStatus(primary.to)} disabled={busy}>
          {busy ? "Saving…" : primary.label}
        </button>
      )}
      {task.status !== "completed" && task.status !== "blocked" && (
        <button type="button" onClick={() => setBlocking(true)} disabled={busy}>
          Block
        </button>
      )}
      {task.status !== "completed" && (
        <button type="button" onClick={() => onStatus("completed")} disabled={busy}>
          Mark done
        </button>
      )}
    </div>
  )
}

function NextPanel({ next }: { next: NextDecision }) {
  if (next.kind === "task") {
    return (
      <div className="banner next">
        <strong>Next up:</strong> {next.title}
        {next.startAt ? ` at ${formatTime(next.startAt)}` : ""}
        {next.reasons.length > 0 && <div className="muted">{next.reasons.join(" · ")}</div>}
        {next.alternatives.length > 0 && (
          <div className="muted">
            alternatives: {next.alternatives.map((a) => a.title).join(", ")}
          </div>
        )}
      </div>
    )
  }
  if (next.kind === "blocked") {
    return (
      <div className="banner warning">
        {next.blockedBy.length > 0
          ? `Blocked — resolve ${next.blockedBy.join(", ")} first.`
          : "Blocked — every remaining task is waiting on something that is not runnable."}
        {next.cycleTaskIds.length > 0 && (
          <div className="muted">{next.cycleTaskIds.length} task(s) sit in a dependency cycle.</div>
        )}
      </div>
    )
  }
  if (next.kind === "done") {
    return <div className="banner success">All clear — nothing left this shift.</div>
  }
  return <div className="banner warning">Shift has ended.</div>
}

function describeWarning(type: string): string {
  switch (type) {
    case "dependency_cycle":
      return "Some tasks depend on each other in a loop — they are ordered by priority instead."
    case "cannot_fit":
      return "Some tasks do not fit before the shift ends."
    case "missing_duration":
      return "Some tasks have no estimate; a default was assumed."
    case "shift_ended":
      return "This shift has already ended."
    case "empty_workload":
      return "No tasks in this shift yet."
    case "draft_not_approved":
      return "Some tasks are still drafts awaiting approval."
    default:
      return type
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
