import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArtifactPane } from './ArtifactPane'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import * as chatApi from '@/lib/chatApi'
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
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({
      activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('clears the active artifact and notifies the caller when closed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    useArtifactStore.setState({ activeArtifact: { type: 'strongs', label: 'G26', params: {} }, status: 'ready', data: strongsFixture })
    render(<ArtifactPane onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /close artifact/i }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
    expect(useArtifactStore.getState().status).toBe('idle')
  })

  it('has no back button when there is nothing to go back to', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'strongs', label: 'G26', params: {} }, status: 'ready', data: strongsFixture })
    render(<ArtifactPane />)
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument()
  })

  it('renders the note editor when a note is active', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    const note = useSessionsStore.getState().addNote(session.id, 'my note body')!
    useArtifactStore.setState({ activeNote: { sessionId: session.id, noteId: note.id } })
    render(<ArtifactPane />)
    expect(screen.getByText('my note body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('saving a draft note remounts the editor into view mode with the note persisted', async () => {
    const user = userEvent.setup()
    const session = useSessionsStore.getState().createSession('freeform', {})
    useArtifactStore.setState({ activeNote: { sessionId: session.id, noteId: '' }, activeArtifact: null })
    render(<ArtifactPane />)

    await user.type(screen.getByLabelText('Note text'), 'drafted body')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    const notes = useSessionsStore.getState().sessions[session.id].notes
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toBe('drafted body')
  })

  it('titles the pane "Note" while a note is active', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    const note = useSessionsStore.getState().addNote(session.id, 'x')!
    useArtifactStore.setState({ activeNote: { sessionId: session.id, noteId: note.id } })
    render(<ArtifactPane />)
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('shows a back button after navigating from a verse to its Strong\'s definition, and it returns there', async () => {
    const user = userEvent.setup()
    vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue(explorerFixture)
    const verseLink = { type: 'interlinear' as const, label: 'Genesis 1:1 ▸', params: { versenumber: 1 } }
    useArtifactStore.setState({
      activeArtifact: { type: 'strongs', label: 'G26', params: { id: 'G26' } },
      history: [verseLink],
      status: 'ready',
      data: strongsFixture,
    })
    render(<ArtifactPane />)
    expect(screen.getByText('love')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back/i }))

    // goBack re-fetches the previous artifact; the store is exercised
    // directly here (its own fetching is covered in useArtifactStore.test.ts) —
    // what matters for the pane is that it asked to go back to the verse.
    expect(useArtifactStore.getState().activeArtifact).toEqual(verseLink)
  })
})
