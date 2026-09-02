// frontend/src/components/admin/TrajectoryView.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrajectoryView, formatDuration } from './TrajectoryView'
import type { Trace } from '@/types/trace'

const trace: Trace = {
  turnId: 't1', requestPath: '/chat',
  startedAt: 1000, endedAt: 2000, durationMs: 1000,
  input: { message: 'what is grace', mode: 'freeform', modeParams: null, historyLength: 0, pageContext: null },
  steps: [
    { index: 0, kind: 'routing', label: 'fell through to LLM', startedAt: 1000, endedAt: 1005,
      durationMs: 5, status: 'completed', request: null, response: null, tokens: null, error: null },
    { index: 1, kind: 'tool', label: 'fetch_scripture_study', startedAt: 1010, endedAt: 1300,
      durationMs: 290, status: 'completed', request: { args: { reference: 'EPH 2:8' } },
      response: { preview: { ok: true }, bytesTotal: 40000 }, tokens: null, error: null },
    { index: 2, kind: 'llm', label: 'Ollama (m)', startedAt: 1320, endedAt: 1980,
      durationMs: 660, status: 'completed', request: { system: 'You are a research assistant', messages: [] },
      response: { preview: 'Grace is unmerited favour.', bytesTotal: 26 },
      tokens: { prompt: 800, completion: 40, total: 840 }, error: null },
  ],
  outcome: { type: 'chat', route: 'AI Fallback', error: null },
  totals: { toolCalls: 1, llmCalls: 1, llmTokens: 840, durationMs: 1000 },
}

describe('TrajectoryView', () => {
  it('renders the three timeline lanes and the step rows', () => {
    render(<TrajectoryView trace={trace} userMessage="what is grace" assistantText="Grace is unmerited favour." />)
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('SYSTEM')).toBeInTheDocument()
    expect(screen.getByText('USER')).toBeInTheDocument()
    expect(screen.getByText('ASSISTANT')).toBeInTheDocument()
    expect(screen.getByText('fetch_scripture_study')).toBeInTheDocument()
  })

  it('shows tokens, timing and a truncation note in the detail drawer', async () => {
    render(<TrajectoryView trace={trace} userMessage="what is grace" assistantText="Grace is unmerited favour." />)
    await userEvent.click(screen.getByText('fetch_scripture_study'))
    expect(screen.getByText(/290 ms ·/)).toBeInTheDocument()     // drawer Request Timing
    expect(screen.getByText(/40000 bytes total/)).toBeInTheDocument()

    await userEvent.click(screen.getByTitle(/Ollama \(m\)/))     // llm step is a timeline segment
    expect(screen.getByText(/840 total/)).toBeInTheDocument()    // total tokens
    expect(screen.queryByText(/bytes total/)).not.toBeInTheDocument() // nothing truncated
  })

  it('formatDuration switches to seconds past 1000ms', () => {
    expect(formatDuration(812)).toBe('812 ms')
    expect(formatDuration(1800)).toBe('1.8 s')
  })
})
