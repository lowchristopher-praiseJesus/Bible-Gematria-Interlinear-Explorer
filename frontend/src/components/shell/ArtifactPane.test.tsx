import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ArtifactPane } from './ArtifactPane'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { ExplorerResponse, StrongsResponse } from '@/types/api'

const explorerFixture: ExplorerResponse = {
  verse: {
    id: 1, ref: 'Genesis 1:1', bnum: 1, cnum: 1, vnum: 1, Ch: '', wordnum: 0, letternum: 0,
    total: 2701, text1769: 'In the beginning...', textAV1611: 'In the beginning...',
    language: 'Hebrew', originalText: '', stephanusText: null, stephanusTotal: null,
    lcFiles: ['gen001.jpg'], hasQere: false, code: null, alert: null,
  },
  navigation: { previous: 31102, next: 2 },
  kjvWords: [],
  originalWords: [],
  strongsDefinitions: {},
}

const strongsFixture: StrongsResponse = {
  definition: {
    strongsNumber: 'G26', root: 'ἀγάπη', transliteration: 'agape', transliteration1: 'agape',
    transliteration2: 'agape', partOfSpeech: 'Noun', meaning: 'love', strongsDefinition: 'to love in a social or moral sense',
    outline: null, note: null, usageCount: 100, verseCount: 90, bookCount: 20, value: 6,
  },
  verses: [],
  resultSummary: '90 verses found in 20 books',
}

describe('ArtifactPane', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

  it('shows an empty state when nothing is active', () => {
    render(<ArtifactPane />)
    expect(screen.getByText(/click a link in the chat/i)).toBeInTheDocument()
  })

  it('shows a loading state', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'strongs', label: '', params: {} }, status: 'loading' })
    render(<ArtifactPane />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows an error state', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'strongs', label: '', params: {} }, status: 'error', error: 'network down' })
    render(<ArtifactPane />)
    expect(screen.getByText(/network down/i)).toBeInTheDocument()
  })

  it('renders the interlinear artifact when ready', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'interlinear', label: '', params: {} }, status: 'ready', data: explorerFixture })
    render(<ArtifactPane />)
    expect(screen.getByText('Genesis 1:1')).toBeInTheDocument()
  })

  it('renders the strongs artifact when ready', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'strongs', label: '', params: {} }, status: 'ready', data: strongsFixture })
    render(<ArtifactPane />)
    expect(screen.getByText('G26')).toBeInTheDocument()
    expect(screen.getByText('love')).toBeInTheDocument()
  })
})
