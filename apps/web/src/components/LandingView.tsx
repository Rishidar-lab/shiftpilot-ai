import { ShiftWordmark } from "./Brand.js"
import { COMPOSER_EXAMPLES } from "../demo.js"

const GITHUB_URL = "https://github.com/Rishidar-lab/shiftpilot-ai"
const ARCHITECTURE_URL = `${GITHUB_URL}/blob/main/docs/architecture.md`

/**
 * Landing is command-first: the worker sees the question the product asks —
 * "what needs to happen this shift?" — and four ways in, not a marketing wall.
 * A quick action carries its example text into the composer; the technical
 * story (provider, free tier, deterministic domain) lives further down, not in
 * the hero.
 */
const QUICK_ACTIONS: Array<{ label: string; intent: string }> = [
  { label: "Plan my shift", intent: COMPOSER_EXAMPLES["Plan my shift"]! },
  { label: "Prioritize workload", intent: COMPOSER_EXAMPLES["Prioritize workload"]! },
  { label: "Resolve blockers", intent: COMPOSER_EXAMPLES["Resolve dependencies"]! },
  { label: "Prepare handover", intent: COMPOSER_EXAMPLES["Prepare handover"]! },
]

export function LandingView({ onOpen }: { onOpen: (intent?: string) => void }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <ShiftWordmark size={22} colored />
        <div className="landing-nav-actions">
          <a className="btn btn-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <button type="button" className="btn btn-primary" onClick={() => onOpen()}>
            Open ShiftPilot
          </button>
        </div>
      </header>

      <section className="hero-command">
        <p className="hero-kicker">A focused AI operations pilot</p>
        <h1 className="display hero-title">Turn messy work into an explainable plan.</h1>
        <p className="hero-sub">
          ShiftPilot turns a messy workload into a plan you can verify and trust — reviewable tasks,
          priorities and a clear next action.
        </p>

        <div className="command-card" role="group" aria-label="Start a shift">
          <p className="command-question">What needs to happen this shift?</p>
          <div className="command-actions">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                className="command-chip"
                onClick={() => onOpen(a.intent)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-lg command-open"
            onClick={() => onOpen()}
          >
            Open today's shift →
          </button>
        </div>

        <p className="hero-principle">
          <span>AI interprets</span>
          <span className="dot" aria-hidden="true">
            ·
          </span>
          <span>You verify</span>
          <span className="dot" aria-hidden="true">
            ·
          </span>
          <span>ShiftPilot schedules</span>
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
            <p>Messy language becomes reviewable work.</p>
          </div>
          <div className="trust-step stagger-2">
            <span className="trust-num">02</span>
            <h3 className="trust-title">You verify</h3>
            <p>Nothing becomes real until you approve it.</p>
          </div>
          <div className="trust-step stagger-3">
            <span className="trust-num">03</span>
            <h3 className="trust-title">ShiftPilot schedules</h3>
            <p>Code — not the model — handles priority, dependencies and time.</p>
          </div>
        </div>
      </section>

      <section className="how" aria-label="How ShiftPilot works">
        <div className="how-head">
          <p className="eyebrow">How it works</p>
          <h2 className="how-title">The AI helps interpret. You stay in control.</h2>
        </div>
        <div className="how-grid">
          <p>
            <strong>Human gate.</strong> Extraction is a proposal. You edit, reject or approve each
            task — and only approval makes it operational.
          </p>
          <p>
            <strong>Deterministic planning.</strong> Priority, dependencies and scheduling live in a
            tested domain package: the same words always produce the same plan, with reasons you can
            open.
          </p>
          <p>
            <strong>Free-tier AI, no surprises.</strong> The model runs on the OpenRouter free tier
            only — a hard guard rejects any paid model, with no silent fallback.
          </p>
          <p>
            <strong>Safe when the AI is down.</strong> Your input is saved before any AI call, and
            the shift's verified facts always still render.
          </p>
        </div>
        <p className="how-stack">
          React · TypeScript · Fastify · SQLite · Drizzle · Zod · OpenRouter
        </p>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <div>
            <p className="footer-brand">
              <ShiftWordmark size={18} colored />
            </p>
            <p className="footer-tagline">Less task chaos. More deliberate work.</p>
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
          </div>
        </div>
      </footer>
    </div>
  )
}
