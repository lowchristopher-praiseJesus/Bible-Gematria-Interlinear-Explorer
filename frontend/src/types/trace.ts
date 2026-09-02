export interface TraceStepTokens {
  prompt: number
  completion: number
  total: number
}

export interface TraceStep {
  index: number
  kind: 'routing' | 'context' | 'tool' | 'llm'
  label: string
  startedAt: number
  endedAt: number
  durationMs: number
  status: 'completed' | 'error' | 'skipped'
  request: unknown | null
  response: { preview: unknown; bytesTotal: number } | null
  tokens: TraceStepTokens | null
  error: string | null
}

export interface Trace {
  turnId: string
  requestPath: '/chat' | '/chat/stream' | 'primer'
  startedAt: number
  endedAt: number
  durationMs: number
  input: {
    message: string
    mode: string | null
    modeParams: Record<string, unknown> | null
    historyLength: number
    pageContext: string | null
  }
  steps: TraceStep[]
  outcome: { type: string; route: string | null; error: string | null }
  totals: { toolCalls: number; llmCalls: number; llmTokens: number | null; durationMs: number }
}
