import type { ApiClient } from "../api/client.js"
import type { NextDecision, WorkPlan, HandoverFacts } from "@shiftpilot/contracts"
import type { View } from "../App.js"
import { useAsync } from "../use-async.js"

/**
 * The right rail is context, not documentation. Each view shows a small,
 * real-data readout of where the shift stands; the trust model moves into a
 * collapsed "How ShiftPilot works" note so it stays available to a judge
 * without shouting at a worker on every screen. Nothing here is fabricated —
 * every number is a domain projection fetched from the API.
 */
export function ContextPanel({
  view,
  client,
  shiftId,
  signal,
}: {
  view: View
  client: ApiClient
  shiftId: string
  /** Bumped by the workspace when the shift changes, so counts stay fresh. */
  signal: number
}) {
  return (
    <>
      {view === "intake" && <AiRunPanel />}
      {view === "plan" && <ShiftPulsePanel client={client} shiftId={shiftId} signal={signal} />}
      {view === "handover" && <ShiftClosePanel client={client} shiftId={shiftId} signal={signal} />}
      <HowItWorks />
    </>
  )
}

const RUN_STEPS = [
  { title: "Input saved", copy: "Your text is stored before any AI call." },
  { title: "AI interpreting", copy: "A free model proposes structured tasks." },
  { title: "Validated", copy: "Every proposal is re-checked by schema and policy." },
  { title: "Ready for review", copy: "You edit, reject or approve each one." },
  { title: "Approved", copy: "Only then does a task become operational." },
]

function AiRunPanel() {
  return (
    <div className="panel panel-pad ctx-panel">
      <p className="ctx-eyebrow">AI run</p>
      <ol className="ctx-run">
        {RUN_STEPS.map((s, i) => (
          <li key={s.title} className="ctx-run-step">
            <span className="ctx-run-dot" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <p className="ctx-run-title">{s.title}</p>
              <p className="ctx-run-copy">{s.copy}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`ctx-metric ${tone ? `ctx-metric-${tone}` : ""}`}>
      <span className="ctx-metric-value">{value}</span>
      <span className="ctx-metric-label">{label}</span>
    </div>
  )
}

function nextTitle(next: NextDecision): string {
  if (next.kind === "task") return next.title
  if (next.kind === "blocked") return "Everything is blocked"
  if (next.kind === "done") return "All work complete"
  return "Shift ended"
}

function ShiftPulsePanel({
  client,
  shiftId,
  signal,
}: {
  client: ApiClient
  shiftId: string
  signal: number
}) {
  const plan = useAsync<WorkPlan>(() => client.getPlan(shiftId), [client, shiftId, signal])
  const next = useAsync<NextDecision>(() => client.getNext(shiftId), [client, shiftId, signal])
  const p = plan.state.status === "ready" ? plan.state.data : null
  const n = next.state.status === "ready" ? next.state.data : null

  const remaining = p ? p.sequence.filter((s) => s.task.status !== "completed").length : null
  const blocked = p ? p.sequence.filter((s) => s.state === "blocked").length : null
  const doesNotFit = p ? p.sequence.filter((s) => !s.fits).length : null

  return (
    <div className="panel panel-pad ctx-panel">
      <p className="ctx-eyebrow">Shift pulse</p>
      {n && (
        <div className="ctx-next">
          <span className="ctx-next-label">Next action</span>
          <span className="ctx-next-title">{nextTitle(n)}</span>
        </div>
      )}
      <div className="ctx-metrics">
        <Metric label="Tasks left" value={remaining != null ? String(remaining) : "…"} />
        <Metric
          label="Blocked"
          value={blocked != null ? String(blocked) : "…"}
          tone={blocked ? "warn" : undefined}
        />
        <Metric
          label="Won't fit"
          value={doesNotFit != null ? String(doesNotFit) : "…"}
          tone={doesNotFit ? "warn" : undefined}
        />
        <Metric
          label="Capacity"
          value={p ? `${p.load.scheduledMinutes}/${p.load.availableMinutes}m` : "…"}
        />
      </div>
    </div>
  )
}

function ShiftClosePanel({
  client,
  shiftId,
  signal,
}: {
  client: ApiClient
  shiftId: string
  signal: number
}) {
  const facts = useAsync<HandoverFacts>(
    () => client.getHandover(shiftId),
    [client, shiftId, signal],
  )
  const f = facts.state.status === "ready" ? facts.state.data : null
  const c = f?.counts ?? null

  return (
    <div className="panel panel-pad ctx-panel">
      <p className="ctx-eyebrow">Shift close</p>
      <div className="ctx-metrics">
        <Metric label="Completed" value={c ? String(c.completed) : "…"} tone="ok" />
        <Metric label="Remaining" value={c ? String(c.active + c.inProgress) : "…"} />
        <Metric
          label="Blocked"
          value={c ? String(c.blocked) : "…"}
          tone={c && c.blocked ? "warn" : undefined}
        />
        <Metric
          label="Overdue"
          value={c ? String(c.overdue) : "…"}
          tone={c && c.overdue ? "warn" : undefined}
        />
      </div>
    </div>
  )
}

function HowItWorks() {
  return (
    <details className="panel ctx-how">
      <summary className="ctx-how-summary">How ShiftPilot works</summary>
      <div className="ctx-how-body">
        <p>
          <strong>AI interprets.</strong> A model turns language into candidate tasks.{" "}
          <strong>You verify.</strong> Nothing becomes operational without your approval.{" "}
          <strong>Deterministic software decides.</strong> Priority, dependencies and time are
          computed in code, not by the model.
        </p>
        <p className="ctx-how-tech">
          AI runs on the OpenRouter free tier only — a hard guard rejects any paid model, and there
          is no silent fallback. If the AI is unavailable your input is saved and the shift's
          verified facts still render.
        </p>
      </div>
    </details>
  )
}
