import { ShiftWordmark } from "./Brand.js"

const GITHUB_URL = "https://github.com/Rishidar-lab/shiftpilot-ai"
const ARCHITECTURE_URL = `${GITHUB_URL}/blob/main/docs/architecture.md`

function ConceptArrow() {
  return (
    <div className="concept-arrow" aria-hidden="true">
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 9h13M10 4l5 5-5 5" />
      </svg>
    </div>
  )
}

function ConceptStep({ flag, title, copy }: { flag: string; title: string; copy: string }) {
  return (
    <div className="concept-step">
      <span className="concept-flag">{flag}</span>
      <div>
        <p className="concept-title">{title}</p>
        <p className="concept-copy">{copy}</p>
      </div>
    </div>
  )
}

export function LandingView({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <ShiftWordmark size={22} colored />
        <div className="landing-nav-actions">
          <a className="btn btn-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <button type="button" className="btn btn-primary" onClick={onOpen}>
            Open ShiftPilot
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="hero-overline">AI workload planning · verified on the OpenRouter free tier</p>
        <h1 className="display hero-title">
          Turn messy work{" "}
          <span className="line-break">
            into an <em>explainable plan.</em>
          </span>
        </h1>
        <p className="hero-sub">
          ShiftPilot reads the way work actually arrives — half-spoken lines, deadlines,
          interruptions — and turns it into reviewable tasks and a deterministic schedule. AI
          interprets. Human verifies. Deterministic software decides.
        </p>
        <div className="hero-cta">
          <button type="button" className="btn btn-primary btn-lg" onClick={onOpen}>
            Open ShiftPilot
          </button>
          <a className="btn btn-lg" href={ARCHITECTURE_URL} target="_blank" rel="noreferrer">
            View architecture
          </a>
        </div>
        <p className="hero-note">Free to run · no paid model · no silent fallback</p>
      </section>

      <section className="concept" aria-label="How ShiftPilot works">
        <ConceptStep
          flag="Messy input"
          title="“Restock aisle 3 by 11am, call Mrs Chen urgently, stocktake the back room for 90 minutes…”"
          copy="One worker's actual shift, dumped as it came in."
        />
        <ConceptArrow />
        <ConceptStep
          flag="AI interprets"
          title="Structured candidate tasks"
          copy="A free-tier model proposes tasks with deadlines, durations and dependencies — every proposal is untrusted until re-validated."
        />
        <ConceptArrow />
        <ConceptStep
          flag="You verify"
          title="Edit · Reject · Approve"
          copy="Nothing becomes operational until a person approves it. The AI proposes; the worker disposes."
        />
        <ConceptArrow />
        <ConceptStep
          flag="ShiftPilot decides"
          title="Explainable deterministic schedule"
          copy="Priority, ordering, deadlines and “what next” are computed in code — with reasons you can read."
        />
        <p className="concept-note">
          A static illustration — the real pipeline runs in the workspace.
        </p>
      </section>

      <section className="trust-strip" aria-label="The ShiftPilot method">
        <div className="trust-strip-head">
          <p className="eyebrow">The method</p>
          <h2 className="trust-strip-title">Three steps. One rule: the AI never decides alone.</h2>
        </div>
        <div className="trust-grid">
          <div className="trust-step stagger-1">
            <span className="trust-num">01</span>
            <h3 className="trust-title">AI interprets</h3>
            <p>Natural language becomes structured candidate tasks.</p>
          </div>
          <div className="trust-step stagger-2">
            <span className="trust-num">02</span>
            <h3 className="trust-title">You verify</h3>
            <p>Nothing becomes operational until you approve it.</p>
          </div>
          <div className="trust-step stagger-3">
            <span className="trust-num">03</span>
            <h3 className="trust-title">ShiftPilot schedules</h3>
            <p>Deterministic code handles priority, dependencies and time.</p>
          </div>
        </div>
      </section>

      <section className="credibility" aria-label="Why it is explainable">
        <div className="credibility-head">
          <p className="eyebrow">Built to be explainable</p>
          <h2 className="credibility-title">Every decision in the plan has a reason.</h2>
        </div>
        <div className="cred-grid">
          <div className="cred-item">
            <p className="cred-title">
              <span className="cred-icon" aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M2 7l3.5 3.5L12 3.5" />
                </svg>
              </span>
              AI interpretation
            </p>
            <p>
              A free-tier OpenRouter model turns language into proposals. A hard guard rejects any
              non-free model before every request — there is no paid path in the code.
            </p>
          </div>
          <div className="cred-item">
            <p className="cred-title">
              <span className="cred-icon" aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M7 1.5l4.5 2v3.2c0 2.6-1.9 4.7-4.5 5.6-2.6-.9-4.5-3-4.5-5.6V3.5L7 1.5Z" />
                </svg>
              </span>
              Human gate
            </p>
            <p>
              No task activates without approval. Extraction is a proposal; the worker edits,
              rejects, or approves — and only approval creates an operational task.
            </p>
          </div>
          <div className="cred-item">
            <p className="cred-title">
              <span className="cred-icon" aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M2.5 4h9M2.5 7h9M2.5 10h5m3.5 0h.5v-7" />
                </svg>
              </span>
              Deterministic planning
            </p>
            <p>
              Priority, dependency and scheduling logic lives in a zero-dependency domain package —
              the same words always produce the same plan, with per-task reasoning you can open.
            </p>
          </div>
          <div className="cred-item">
            <p className="cred-title">
              <span className="cred-icon" aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M7 1.5v11M2 4.5h5a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5H2V4.5Z" />
                </svg>
              </span>
              Safe fallback
            </p>
            <p>
              If the AI is unavailable or returns something unreadable, your input is already saved
              — and the deterministic facts of the shift always still render.
            </p>
          </div>
        </div>
      </section>

      <section className="stack" aria-label="Technology">
        <p className="stack-title">
          React · TypeScript · Fastify · SQLite · Drizzle · Zod · OpenRouter
        </p>
        <div className="stack-list">
          {["React", "TypeScript", "Fastify", "SQLite", "Drizzle", "Zod", "OpenRouter"].map((t) => (
            <span key={t} className="chip chip-accent">
              {t}
            </span>
          ))}
        </div>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <div>
            <p className="footer-brand">
              <ShiftWordmark size={18} colored />
            </p>
            <p className="footer-tagline">
              AI-assisted workload planning. Less task chaos. More deliberate work.
            </p>
          </div>
          <div className="footer-links">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <span className="separator">·</span>
            <a href={ARCHITECTURE_URL} target="_blank" rel="noreferrer">
              Architecture
            </a>
            <span className="separator">·</span>
            <span className="meta">Innovation Hacks AI Internship 2026</span>
            <span className="separator">·</span>
            <span className="meta">Built by Rishi</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
