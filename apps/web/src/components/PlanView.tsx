import { useState } from "react"

import type { ApiClient } from "../api/client.js"
import { ApiError } from "../api/client.js"
import type { NextDecision, Task, TaskStatus, WorkPlan, ScheduledTask } from "@shiftpilot/contracts"
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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function runAction(taskId: string, action: () => Promise<Task>, verb: string) {
    setActionError(null)
    setPendingTaskId(taskId)
    try {
      await action()
      await Promise.all([plan.reload(), next.reload()])
      showToast(verb)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update the task")
    } finally {
      setPendingTaskId(null)
    }
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }

  const planData = plan.state.status === "ready" ? plan.state.data : null
  const scheduled = (planData?.sequence ?? []).filter((e) => e.fits)
  const unscheduled = (planData?.sequence ?? []).filter((e) => !e.fits)

  return (
    <div className="stagger-1" aria-labelledby="plan-heading">
      <AsyncPanel
        state={next.state}
        label="next action"
        onRetry={next.reload}
        render={(decision) => (
          <WhatNextHero
            next={decision}
            plan={planData}
            busy={pendingTaskId !== null}
            onAction={(taskId, status) =>
              runAction(taskId, () => client.updateTask(taskId, { status }), "Plan updated")
            }
          />
        )}
      />

      {actionError && (
        <div className="banner banner-error" role="alert" style={{ marginTop: 12 }}>
          {actionError}
        </div>
      )}

      <AsyncPanel
        state={plan.state}
        label="plan"
        onRetry={plan.reload}
        render={(data) => (
          <>
            <div className="section-head" style={{ margin: "24px 0 12px" }}>
              <h2 id="plan-heading" className="section-title">
                Work plan
              </h2>
              <p className="plan-load">
                {data.sequence.length} task(s) · {data.load.scheduledMinutes}/
                {data.load.availableMinutes} min scheduled
              </p>
            </div>

            {data.sequence.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">Nothing scheduled yet</p>
                <p className="empty-copy">
                  Capture your workload on the Intake tab and approve the extracted tasks — the plan
                  builds itself from there.
                </p>
              </div>
            ) : (
              <>
                {scheduled.length > 0 && (
                  <ol className="timeline" aria-label="Scheduled tasks in order">
                    {scheduled.map((entry) => (
                      <TimelineEntry
                        key={entry.task.id}
                        entry={entry}
                        selected={selectedTaskId === entry.task.id}
                        onSelect={() =>
                          setSelectedTaskId((cur) => (cur === entry.task.id ? null : entry.task.id))
                        }
                        busy={pendingTaskId === entry.task.id}
                        onStatus={(status) =>
                          runAction(
                            entry.task.id,
                            () => client.updateTask(entry.task.id, { status }),
                            "Plan updated",
                          )
                        }
                        onBlock={(reason) =>
                          runAction(
                            entry.task.id,
                            () => client.blockTask(entry.task.id, reason),
                            "Plan updated",
                          )
                        }
                      />
                    ))}
                  </ol>
                )}

                {unscheduled.length > 0 && (
                  <div className="unscheduled" style={{ marginTop: 12 }}>
                    <p className="unscheduled-head">Unscheduled — outside this shift</p>
                    <p className="meta" style={{ marginBottom: 4 }}>
                      These tasks do not fit before the shift ends. They stay visible; the worker
                      decides their fate.
                    </p>
                    {unscheduled.map((entry) => (
                      <div key={entry.task.id} className="unscheduled-item">
                        <span className="u-title">{entry.task.title}</span>
                        <span className="u-reason">
                          {entry.reasons.join(" · ") ||
                            (entry.task.dependsOn.length > 0
                              ? "Waiting on another task"
                              : "Does not fit in remaining shift time")}
                        </span>
                        <div className="timeline-actions" style={{ justifyContent: "flex-start" }}>
                          <TaskActions
                            task={entry.task}
                            busy={pendingTaskId === entry.task.id}
                            onStatus={(status) =>
                              runAction(
                                entry.task.id,
                                () => client.updateTask(entry.task.id, { status }),
                                "Plan updated",
                              )
                            }
                            onBlock={(reason) =>
                              runAction(
                                entry.task.id,
                                () => client.blockTask(entry.task.id, reason),
                                "Plan updated",
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {data.completedTasks.length > 0 && (
                  <p className="meta" style={{ marginTop: 12 }}>
                    {data.completedTasks.length} completed · {data.cancelledTasks.length} cancelled
                    this shift
                  </p>
                )}

                {data.warnings.length > 0 && (
                  <div className="banner banner-warning" role="status" style={{ marginTop: 12 }}>
                    {data.warnings.map((w, i) => (
                      <div key={i}>{describeWarning(w.type)}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      />

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 7l3.5 3.5L12 3.5" />
          </svg>
          {toast}
        </div>
      )}
    </div>
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
        className="block-form"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim() === "") return
          onBlock(reason.trim())
          setBlocking(false)
          setReason("")
        }}
      >
        <label
          className="field-label"
          htmlFor={`block-reason-${task.id}`}
          style={{ fontSize: "0.8rem" }}
        >
          Why is it blocked?
          <input
            id={`block-reason-${task.id}`}
            className="field"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. waiting on delivery"
            required
          />
        </label>
        <button type="submit" className="btn btn-sm" disabled={reason.trim() === ""}>
          Save
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBlocking(false)}>
          Cancel
        </button>
      </form>
    )
  }

  return (
    <div className="timeline-actions">
      {primary && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onStatus(primary.to)}
          disabled={busy}
        >
          {busy ? "Saving…" : primary.label}
        </button>
      )}
      {task.status !== "completed" && task.status !== "blocked" && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setBlocking(true)}
          disabled={busy}
        >
          Block
        </button>
      )}
      {/*
       * Only offer the shortcut when the primary action is not already
       * "complete" — otherwise an in-progress task shows two buttons that do
       * exactly the same thing, and the user has to guess whether they differ.
       */}
      {task.status !== "completed" && primary?.to !== "completed" && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => onStatus("completed")}
          disabled={busy}
        >
          Mark done
        </button>
      )}
    </div>
  )
}

function TimelineEntry({
  entry,
  selected,
  onSelect,
  busy,
  onStatus,
  onBlock,
}: {
  entry: ScheduledTask
  selected: boolean
  onSelect: () => void
  busy: boolean
  onStatus: (status: TaskStatus) => void
  onBlock: (reason: string) => void
}) {
  const { task } = entry
  const dur =
    task.estimatedMinutes != null ? (
      <span className="dur">{task.estimatedMinutes} min</span>
    ) : (
      <span className="dur">no estimate</span>
    )

  return (
    <li
      className={`timeline-entry ${entry.state} ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="timeline-time">
        <span>
          {entry.startAt && entry.endAt
            ? `${formatTime(entry.startAt)}–${formatTime(entry.endAt)}`
            : "Unplaced"}
        </span>
        {dur}
      </div>
      <div className="timeline-body">
        <div className="timeline-title-row">
          <span className="timeline-title">{task.title}</span>
          {entry.priority?.bucket && (
            <span className={`chip ${bucketChip(entry.priority.bucket)}`}>
              <span className="dot" aria-hidden="true" />
              {entry.priority.bucket}
            </span>
          )}
          <span className="chip">{task.status}</span>
        </div>
        <div className="timeline-note">
          {entry.state === "blocked" && (
            <span className="waiting-for">
              Waiting for: {task.blockReason ?? "its blocker to clear"}
            </span>
          )}
          {entry.state === "waiting" && (
            <span className="waiting-for">
              Waiting for: {entry.reasons.join(" · ") || "a dependency to complete"}
            </span>
          )}
          {entry.state === "cycle" && (
            <span className="waiting-for">Stuck in a dependency cycle — ordered by priority.</span>
          )}
          {task.deadlineAt && <span>Due {formatTime(task.deadlineAt)}</span>}
          {entry.reasons.length > 0 && entry.state !== "waiting" && (
            <span>{entry.reasons.join(" · ")}</span>
          )}
          {entry.taskWarnings.length > 0 && (
            <span className="waiting-for">{entry.taskWarnings.join(" · ")}</span>
          )}
        </div>

        {selected && entry.priority && <Explainability entry={entry} />}

        <div className="timeline-actions" onClick={(e) => e.stopPropagation()}>
          <TaskActions task={task} busy={busy} onStatus={onStatus} onBlock={onBlock} />
        </div>
      </div>
    </li>
  )
}

/** Deterministic scoring, surfaced with the REAL factors from the domain. */
function Explainability({ entry }: { entry: ScheduledTask }) {
  const priority = entry.priority
  if (!priority) return null

  return (
    <div className="explain" aria-label="Technical reasoning">
      <p className="eyebrow" style={{ marginBottom: 4 }}>
        Why this position
      </p>
      <div className="review-provenance" style={{ marginBottom: 8 }}>
        <span className="chip chip-accent">
          Priority score {priority.score} · {priority.bucket}
        </span>
      </div>
      {priority.factors.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Factor</th>
              <th style={{ textAlign: "right" }}>Contribution</th>
            </tr>
          </thead>
          <tbody>
            {priority.factors.map((f) => (
              <tr key={f.kind}>
                <td>{f.label}</td>
                <td className="score">
                  {f.contribution > 0 ? `+${f.contribution}` : f.contribution}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="meta">No contributory factors — base score only.</p>
      )}
      <details style={{ marginTop: 8 }}>
        <summary>Technical reasoning</summary>
        <p className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
          Position {entry.position + 1} of the shift · state {entry.state} ·{" "}
          {entry.fits ? "fits within shift time" : "outside shift time"}.
          {entry.reasons.length > 0 && <> Planner notes: {entry.reasons.join(" · ")}.</>}
        </p>
      </details>
    </div>
  )
}

function WhatNextHero({
  next,
  plan,
  busy,
  onAction,
}: {
  next: NextDecision
  plan: WorkPlan | null
  busy: boolean
  onAction: (taskId: string, status: TaskStatus) => void
}) {
  if (next.kind === "task") {
    const scheduled = plan?.sequence.find((e) => e.task.id === next.taskId)
    const task = scheduled?.task
    const duration = task?.estimatedMinutes
    const primary = task ? NEXT_STATUS[task.status] : null

    return (
      <div className="whatnext stagger-1">
        <p className="whatnext-eyebrow">
          <span className="dot" aria-hidden="true" />
          Next up:
        </p>
        <h2 className="whatnext-title">{next.title}</h2>
        <p className="whatnext-sub">
          {scheduled?.startAt ? (
            <>
              <span className="chip chip-accent">Start {formatTime(scheduled.startAt)}</span>
              {duration != null && <span className="chip">{duration} min</span>}
            </>
          ) : (
            duration != null && <span className="chip">{duration} min</span>
          )}
          {task && <span className="chip">{task.status}</span>}
        </p>
        {next.reasons.length > 0 && (
          <div className="whatnext-reasons">
            <p className="eyebrow" style={{ marginBottom: 4 }}>
              Why this task
            </p>
            {next.reasons.map((r) => (
              <span key={r} className="whatnext-reason">
                <span className="mark" aria-hidden="true">
                  ✓
                </span>{" "}
                {r}
              </span>
            ))}
          </div>
        )}
        {next.alternatives.length > 0 && (
          <p className="whatnext-then">Then: {next.alternatives.map((a) => a.title).join(", ")}</p>
        )}
        <div className="whatnext-actions">
          {task && primary && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onAction(next.taskId, primary.to)}
            >
              {busy ? "Saving…" : primary.label}
            </button>
          )}
          {task?.status === "in_progress" && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onAction(next.taskId, "completed")}
            >
              Mark complete
            </button>
          )}
        </div>
      </div>
    )
  }
  if (next.kind === "blocked") {
    return (
      <div className="banner banner-warning stagger-1">
        <strong>
          {next.blockedBy.length > 0
            ? `Blocked — resolve ${next.blockedBy.join(", ")} first.`
            : "Blocked — every remaining task is waiting on something that is not runnable."}
        </strong>
        {next.cycleTaskIds.length > 0 && (
          <p className="meta" style={{ marginTop: 4 }}>
            {next.cycleTaskIds.length} task(s) sit in a dependency cycle.
          </p>
        )}
      </div>
    )
  }
  if (next.kind === "done") {
    return (
      <div className="banner banner-success stagger-1">
        <strong>All clear — nothing left this shift.</strong>
      </div>
    )
  }
  return <div className="banner banner-warning stagger-1">Shift has ended.</div>
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

function bucketChip(bucket: string): string {
  switch (bucket) {
    case "critical":
      return "chip-danger"
    case "high":
      return "chip-warning"
    case "medium":
      return "chip-info"
    default:
      return "chip-muted"
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
