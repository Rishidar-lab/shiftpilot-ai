import { describe, expect, it } from "vitest"

import { createAiProvider } from "./provider.js"
import { parseAppConfig } from "../config.js"
import { FakeAiProvider } from "@shiftpilot/provider"

describe("createAiProvider", () => {
  it("returns the deterministic FakeAiProvider by default", () => {
    const provider = createAiProvider(parseAppConfig({}))
    expect(provider).toBeInstanceOf(FakeAiProvider)
  })
})
