import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EnglishSearchArtifact } from './EnglishSearchArtifact'
import type { EnglishResponse, EnglishResult } from '@/types/api'

function makeResult(i: number): EnglishResult {
  return {
    id: i,
    ref: `Genesis 1:${i}`,
    bnum: 1,
    cnum: 1,
    vnum: i,
    text: `Verse text ${i}`,
    matchPositions: [],
  }
}

describe('EnglishSearchArtifact', () => {
  it('renders all results when under the cap', () => {
    const data: EnglishResponse = {
      searchTerm: 'love',
      results: [makeResult(1), makeResult(2)],
      resultSummary: '2 results found',
    }
    render(<EnglishSearchArtifact data={data} />)
    expect(screen.getByText('Genesis 1:1')).toBeInTheDocument()
    expect(screen.getByText('Genesis 1:2')).toBeInTheDocument()
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument()
  })

  it('caps rendered results at 200 and shows a "Showing N of M" note when there are more', () => {
    const results = Array.from({ length: 500 }, (_, i) => makeResult(i + 1))
    const data: EnglishResponse = {
      searchTerm: 'love',
      results,
      resultSummary: '500 results found',
    }
    render(<EnglishSearchArtifact data={data} />)
    expect(screen.getAllByText(/Genesis 1:/).length).toBe(200)
    expect(screen.getByText('Showing 200 of 500')).toBeInTheDocument()
  })
})
