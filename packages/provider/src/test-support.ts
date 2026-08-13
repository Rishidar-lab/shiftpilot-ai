import type Anthropic from "@anthropic-ai/sdk"

/**
 * Build an SDK-shaped message around an extraction payload.
 *
 * Lives in this package because it touches `@anthropic-ai/sdk` types, and the
 * SDK is confined to the provider boundary (CLAUDE.md): letting a test in
 * apps/api import it would put the model vendor's types back into the API layer.
 *
 * Tests use this to drive a REAL ClaudeProvider over a stubbed transport, so the
 * adapter still performs its own content extraction, JSON parsing and error
 * mapping rather than having them mocked away.
 */
export function claudeMessage(
  payload: unknown,
  over: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: JSON.stringify(payload), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...over,
  } as Anthropic.Message
}
