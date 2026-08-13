import { claudeMessage, loadExtractionFixture } from "@shiftpilot/provider"

/**
 * Test helpers for driving a real ClaudeProvider without a network call. The
 * SDK-shaped response builder lives in the provider package so the Anthropic
 * SDK stays confined to the provider boundary (CLAUDE.md).
 */
export const claudeResponse = claudeMessage

/** The `output` half of a labelled fixture (see packages/provider/fixtures). */
export function loadFixture(name: string): unknown {
  return loadExtractionFixture(name).output
}
