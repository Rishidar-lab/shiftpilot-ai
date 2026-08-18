# Screenshots

Real captures of the running application, taken with Playwright against the production
build served by the API process — the same single-service topology the container and the
live deployment use. Each image comes from genuinely driving the flow (type, extract,
review, approve, plan, hand over). Nothing here is a mockup and nothing is retouched.

| File                    | Screen                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `01-landing.png`        | Landing: the proposition, the method, the explainability promises |
| `02-intake.png`         | Natural-language intake with the messy shift dump in the composer |
| `03-review.png`         | Extraction review: dispositions, provenance, ambiguity flags      |
| `04-plan.png`           | Deterministic plan, What Next with reasons, unscheduled section   |
| `04b-plan-explain.png`  | A scheduled task expanded to show its priority factors            |
| `05-handover.png`       | Handover facts computed from the database                         |
| `05b-handover-ai.png`   | The same handover with the AI summary, labelled as drafted prose  |
| `06-mobile-landing.png` | Landing at 390px                                                  |
| `07-mobile-app.png`     | Workspace and composer at 390px                                   |
| `08-tablet-plan.png`    | Plan at 768px                                                     |

The header badge reads **"Simulated AI · no real LLM"** because these runs used the offline
provider. It stays in frame on purpose: mislabelling simulated output as a real model is the
one thing this project is built not to do. The real free-tier OpenRouter route is evidenced
by the live deployment and by `docs/eval/`, not by a screenshot caption.

To re-capture after a UI change, serve the production build (`pnpm build`, then run the API
with `WEB_ROOT` pointing at `apps/web/dist`) against an empty database, and drive the same
screens at 1440px, 390px and 768px. An empty database matters: re-running against a shift
that already holds these tasks makes the extractor reject every candidate as a duplicate,
which is correct behaviour and a confusing screenshot.
