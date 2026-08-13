import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Loader for recorded/synthetic extraction fixtures (see fixtures/README.md).
 *
 * `source` is the fixture's own claim about where it came from and is never
 * inferred here: a hand-written payload stays "synthetic" until an actual API
 * response replaces it. Tests and docs must not describe a synthetic fixture as
 * having come from a model.
 */
export interface ExtractionFixture {
  name: string
  source: "synthetic" | "recorded"
  note: string
  /** The worker text this payload corresponds to. */
  input: string
  /** The provider-shaped payload, exactly as `extractTasks` would return it. */
  output: unknown
  /** Present on recorded fixtures only. */
  model?: string
  promptVersion?: string
  recordedAt?: string
}

function fixturesDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 5; depth++) {
    const candidate = path.join(dir, "fixtures", "extraction")
    if (existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error("could not locate the extraction fixtures directory")
}

export function listExtractionFixtures(): ExtractionFixture[] {
  const dir = fixturesDir()
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as ExtractionFixture)
}

export function loadExtractionFixture(name: string): ExtractionFixture {
  const found = listExtractionFixtures().find((fixture) => fixture.name === name)
  if (found === undefined) throw new Error(`unknown extraction fixture: ${name}`)
  return found
}
