import { ApiErrorEnvelope, HealthResponse } from "@shiftpilot/contracts"
import type { ApiErrorCode } from "@shiftpilot/contracts"

/**
 * Typed client boundary between the web app and the API
 * (docs/architecture.md §3). Every response crosses zod validation here —
 * API responses are treated as untrusted input, mirroring server-side rules.
 */
export class ApiClient {
  constructor(private readonly baseUrl: string = "/api") {}

  async getHealth(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`)
    const body: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      const parsed = ApiErrorEnvelope.safeParse(body)
      if (parsed.success) {
        throw new ApiError(parsed.data.error.code, parsed.data.error.message)
      }
      throw new ApiError("internal", `unexpected error response (HTTP ${response.status})`)
    }

    const parsed = HealthResponse.safeParse(body)
    if (!parsed.success) {
      throw new ApiError("internal", "API returned an unexpected health payload")
    }
    return parsed.data
  }
}

export class ApiError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}
