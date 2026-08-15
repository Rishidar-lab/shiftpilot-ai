# Screenshots

Empty on purpose: no screenshots are committed yet, and the README links to these three
paths. Capture them from a local run (`pnpm dev`, fake provider) before publishing, or
remove the Screenshots section from the README so it does not link to files that do not
exist.

| File          | What to capture                                                             |
| ------------- | --------------------------------------------------------------------------- |
| `capture.png` | The Intake screen with the messy paste block from `docs/demo-seed-data.md`  |
| `review.png`  | The review list: dispositions, ambiguity flags, an edit in progress         |
| `plan.png`    | The deterministic plan with What Next and the "does not fit" warning banner |

Two rules when capturing:

- The header badge must read **"Simulated AI · no real LLM"** if the run is on the fake
  provider. Do not crop it out — mislabelling simulated output as a real model is the one
  thing this project is built not to do.
- No credentials, no terminal with an exported key, no browser tab showing a provider
  console.
