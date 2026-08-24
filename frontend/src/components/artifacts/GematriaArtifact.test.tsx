import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GematriaArtifact } from './GematriaArtifact'
import type { GematriaResponse, GematriaVerseResult, GematriaWordResult } from '@/types/api'

function makeWordResult(i: number): GematriaWordResult {
  return {
    id: i,
    ref: `Genesis 1:${i}`,
    bnum: 1,
    cnum: 1,
    vnum: i,
    strongsNumber: `H${i}`,
    wordHtml: `word${i}`,
    language: 'Hebrew',
    snTranslit: `translit${i}`,
    snMeaning: `meaning${i}`,
  }
}

function makeVerseResult(i: number): GematriaVerseResult {
  return {
    id: i,
    ref: `Exodus 1:${i}`,
    bnum: 2,
    cnum: 1,
    vnum: i,
    total: 777,
    text1769: `Verse text ${i}`,
  }
}

describe('GematriaArtifact', () => {
  it('renders all results when under the cap', () => {
    const data: GematriaResponse = {
      wordResults: [makeWordResult(1)],
      verseResults: [makeVerseResult(1)],
      strongsDefinitions: {},
      resultSummaryWords: '1 word found',
      resultSummaryVerses: '1 verse found',
    }
    render(<GematriaArtifact data={data} />)
    expect(screen.getByText('Genesis 1:1')).toBeInTheDocument()
    expect(screen.getByText('Exodus 1:1')).toBeInTheDocument()
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument()
  })

  it('caps word and verse results at 200 and shows a "Showing N of M" note for each list', () => {
    const wordResults = Array.from({ length: 300 }, (_, i) => makeWordResult(i + 1))
    const verseResults = Array.from({ length: 250 }, (_, i) => makeVerseResult(i + 1))
    const data: GematriaResponse = {
      wordResults,
      verseResults,
      strongsDefinitions: {},
      resultSummaryWords: '300 words found',
      resultSummaryVerses: '250 verses found',
    }
    render(<GematriaArtifact data={data} />)
    expect(screen.getAllByText(/Genesis 1:/).length).toBe(200)
    expect(screen.getAllByText(/Exodus 1:/).length).toBe(200)
    expect(screen.getByText('Showing 200 of 300')).toBeInTheDocument()
    expect(screen.getByText('Showing 200 of 250')).toBeInTheDocument()
  })
})
