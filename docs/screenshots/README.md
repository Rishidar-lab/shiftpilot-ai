# Screenshots

Real captures of the running application, taken with Playwright against the production
container (`docker run` of this repository's `Dockerfile`) on the offline `FakeAiProvider`.
Nothing here is a mockup, and nothing is retouched.

| File              | Screen                                                          |
| ----------------- | --------------------------------------------------------------- |
| `01-intake.png`   | Natural-language intake with the messy shift dump               |
| `02-review.png`   | Extraction review: dispositions, provenance, ambiguity flags    |
| `03-plan.png`     | Deterministic plan, priority bands, What Next, capacity warning |
| `04-handover.png` | Handover facts with the labelled AI summary                     |

The header badge reads **"Simulated AI · no real LLM"** because these runs used the offline
provider. It stays in frame on purpose: mislabelling simulated output as a real model is the
one thing this project is built not to do.

To re-capture after a UI change, run the app (`pnpm dev`, or the container) and take the
same four screens at 1280px wide.
