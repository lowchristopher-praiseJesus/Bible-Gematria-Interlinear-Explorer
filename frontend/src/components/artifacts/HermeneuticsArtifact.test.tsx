import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HermeneuticsArtifact } from './HermeneuticsArtifact'
import type { PhaseResult } from '@/types/session'

const phases: PhaseResult[] = [
  { index: 1, title: 'Contextual Scope', status: 'done', markdown: 'Addressed to the Church.' },
  { index: 8, title: 'Validation', status: 'done', markdown: 'Checked.', verdicts: [
    { test: 'heart', passed: true }, { test: 'cross', passed: true }, { test: 'grace', passed: true },
  ] },
]

describe('HermeneuticsArtifact', () => {
  it('renders repeated witnesses and verdicts without key collisions', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<HermeneuticsArtifact reference="ROM 8:1" summary="s" phases={[
      { index: 4, title: 'Witnesses', status: 'done', markdown: 'm', citations: [
        { reference: 'JHN 14:2-3', text: 'mansions', verified: true },
        { reference: 'JHN 14:2-3', text: 'mansions', verified: true },
      ] },
      { index: 8, title: 'Validation', status: 'done', markdown: 'm', verdicts: [
        { test: 'heart', passed: true }, { test: 'heart', passed: true },
      ] },
    ]} />)
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
    errors.mockRestore()
  })

  it('shows the reference, every phase body, and the final interpretation', () => {
    render(<HermeneuticsArtifact reference="1TH 4:15-18" phases={phases} summary="The rapture." />)
    expect(screen.getByText('1TH 4:15-18')).toBeInTheDocument()
    expect(screen.getByText(/addressed to the church/i)).toBeInTheDocument()
    expect(screen.getByText(/checked/i)).toBeInTheDocument()
    expect(screen.getByText(/final verified interpretation/i)).toBeInTheDocument()
    expect(screen.getByText(/the rapture/i)).toBeInTheDocument()
  })

  it('renders phase bodies expanded, unlike the chat list', () => {
    render(<HermeneuticsArtifact reference="1TH 4:15-18" phases={phases} summary="s" />)
    expect(screen.queryByRole('button', { name: /contextual scope/i })).not.toBeInTheDocument()
  })

  it('handles a report with no phases', () => {
    render(<HermeneuticsArtifact reference="ROM 8:1" phases={[]} summary="Only a summary." />)
    expect(screen.getByText(/only a summary/i)).toBeInTheDocument()
  })
})
