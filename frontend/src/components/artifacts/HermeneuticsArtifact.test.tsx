import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HermeneuticsArtifact } from './HermeneuticsArtifact'
import type { PhaseResult } from '@/types/session'

const phases: PhaseResult[] = [
  { index: 1, title: 'Contextual Scope', status: 'done', markdown: 'Addressed to the Church.' },
  { index: 8, title: 'Validation', status: 'done', markdown: 'Checked.', verdicts: [
    { test: 'heart', passed: true }, { test: 'cross', passed: true }, { test: 'grace', passed: true },
  ] },
]

describe('HermeneuticsArtifact', () => {
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
