import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HermeneuticsArtifact } from './HermeneuticsArtifact'
import * as chatApi from '@/lib/chatApi'
import type { PhaseResult } from '@/types/session'
import type { ChapterResponse } from '@/types/api'

const romansFixture: ChapterResponse = {
  book: 'Romans',
  chapter: 8,
  verseCount: 1,
  verses: [
    {
      versenumber: 28118,
      vnum: 1,
      ref: 'Romans 8:1',
      translations: { 'eng-KJV': 'There is therefore now no condemnation...' },
    },
  ],
}

const phases: PhaseResult[] = [
  { index: 1, title: 'Contextual Scope', status: 'done', markdown: 'Addressed to the Church.' },
  { index: 8, title: 'Validation', status: 'done', markdown: 'Checked.', verdicts: [
    { test: 'heart', passed: true }, { test: 'cross', passed: true }, { test: 'grace', passed: true },
  ] },
]

describe('HermeneuticsArtifact', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('shows the passage text, fetched by reference like every other verse box', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(romansFixture)
    render(<HermeneuticsArtifact reference="ROM 8:1" phases={[]} summary="s" />)
    expect(await screen.findByText(/no condemnation/)).toBeInTheDocument()
  })
})
