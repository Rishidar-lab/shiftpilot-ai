import {
  ApiErrorEnvelope,
  ExtractionReport,
  HandoverFacts,
  HealthResponse,
  NextDecision,
  RawInput,
  Shift,
  Task,
  WorkPlan,
} from "@shiftpilot/contracts"
import type { ApiErrorCode, IntakeApprovalDecision } from "@shiftpilot/contracts"

/** Shape returned by capture/retrieve intake endpoints. */
export interface IntakeResult {
  rawInput: RawInput
  report: ExtractionReport
}

/** Shape returned by the approval endpoint. */
export interface ApprovalResult {
  rawInput: RawInput
  createdTasks: Task[]
  report: ExtractionReport
}

function parseIntakeResult(payload: unknown): IntakeResult {
  if (typeof payload !== "object" || payload === null) {
    throw new ApiError("internal", "API returned a non-object intake payload")
  }
  const candidate = payload as { rawInput?: unknown; report?: unknown }
  const rawInput = RawInput.safeParse(candidate.rawInput)
  const report = ExtractionReport.safeParse(candidate.report)
  if (!rawInput.success || !report.success) {
    throw new ApiError("internal", "API returned an unexpected intake payload")
  }
  return { rawInput: rawInput.data, report: report.data }
}

function parseApprovalResult(payload: unknown): ApprovalResult {
  if (typeof payload !== "object" || payload === null) {
    throw new ApiError("internal", "API returned a non-object approval payload")
  }
  const candidate = payload as { rawInput?: unknown; createdTasks?: unknown; report?: unknown }
  const rawInput = RawInput.safeParse(candidate.rawInput)
  const createdTasks = Task.array().safeParse(candidate.createdTasks)
  const report = ExtractionReport.safeParse(candidate.report)
  if (!rawInput.success || !createdTasks.success || !report.success) {
    throw new ApiError("internal", "API returned an unexpected approval payload")
  }
  return { rawInput: rawInput.data, createdTasks: createdTasks.data, report: report.data }
}

/**
 * Typed client boundary between the web app and the API
 * (docs/architecture.md §3). Every response crosses validation here — API
 * responses are treated as untrusted input, mirroring server-side rules.
 */
export class ApiClient {
  constructor(private readonly baseUrl: string = "/api") {}

  private async request<T>(
    method: string,
    path: string,
    parse: (payload: unknown) => T,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      const parsed = ApiErrorEnvelope.safeParse(payload)
      if (parsed.success) {
        throw new ApiError(parsed.data.error.code, parsed.data.error.message)
      }
      throw new ApiError("internal", `unexpected error response (HTTP ${response.status})`)
    }

    try {
      return parse(payload)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError("internal", "API returned an unexpected payload")
    }
  }

  getHealth(): Promise<HealthResponse> {
    return this.request("GET", "/health", HealthResponse.parse)
  }

  createShift(dto: {
    date: string
    startAt: string
    endAt: string
    role?: string | null
  }): Promise<Shift> {
    return this.request("POST", "/shifts", Shift.parse, dto)
  }

  listShifts(): Promise<Shift[]> {
    return this.request("GET", "/shifts", Shift.array().parse)
  }

  getShift(id: string): Promise<Shift> {
    return this.request("GET", `/shifts/${id}`, Shift.parse)
  }

  listTasks(shiftId: string): Promise<Task[]> {
    return this.request("GET", `/shifts/${shiftId}/tasks`, Task.array().parse)
  }

  createIntake(shiftId: string, rawText: string): Promise<IntakeResult> {
    return this.request("POST", `/shifts/${shiftId}/intake`, parseIntakeResult, {
      shiftId,
      rawText,
    })
  }

  getIntake(id: string): Promise<IntakeResult> {
    return this.request("GET", `/intake/${id}`, parseIntakeResult)
  }

  approveIntake(id: string, decisions: IntakeApprovalDecision[]): Promise<ApprovalResult> {
    return this.request("POST", `/intake/${id}/approve`, parseApprovalResult, { decisions })
  }

  getPlan(shiftId: string, now?: string): Promise<WorkPlan> {
    const query = now ? `?now=${encodeURIComponent(now)}` : ""
    return this.request("GET", `/shifts/${shiftId}/plan${query}`, WorkPlan.parse)
  }

  getNext(shiftId: string, now?: string): Promise<NextDecision> {
    const query = now ? `?now=${encodeURIComponent(now)}` : ""
    return this.request("GET", `/shifts/${shiftId}/next${query}`, NextDecision.parse)
  }

  getHandover(shiftId: string, now?: string): Promise<HandoverFacts> {
    const query = now ? `?now=${encodeURIComponent(now)}` : ""
    return this.request("GET", `/shifts/${shiftId}/handover${query}`, HandoverFacts.parse)
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
