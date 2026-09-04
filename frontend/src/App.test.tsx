import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { describeSession } from '@/lib/sessionDescription'
import * as chatApi from '@/lib/chatApi'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({ activeArtifact: null, activeNote: null, status: 'idle', data: null, error: null })
    window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the mode picker when there is no active session', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /ask anything/i })).toBeInTheDocument()
  })

  it('starting a session shows the chat plus the (empty) detail panel', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    expect(await screen.findByText('Ask me anything.')).toBeInTheDocument()
    expect(screen.getByText(/click a link in the chat/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument()
  })

  it('renders a mobile top bar with conversations and new-chat controls', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Conversations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument()
  })

  it('opens the conversations drawer from the top bar and closes it on Escape', async () => {
    render(<App />)
    const menu = screen.getByRole('button', { name: 'Conversations' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')

    await userEvent.keyboard('{Escape}')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('the top-bar New chat button returns to the mode picker', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')

    await userEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(await screen.findByText(/start a guided study below/i)).toBeInTheDocument()
  })

  it('opening an artifact link brings the detail sheet forward', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')

    useArtifactStore.getState().openArtifact({ type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } })

    expect(await screen.findByRole('complementary', { name: 'Scripture details' })).toHaveAttribute(
      'data-state',
      'open'
    )
  })

  it('selecting a session from the drawer closes the drawer', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')

    // A second session, created directly on the store, gives the list a
    // distinct entry to click that actually changes the active session id.
    const otherSession = useSessionsStore.getState().createSession('topic', { conceptSlug: 'grace' })

    const menu = screen.getByRole('button', { name: 'Conversations' })
    await userEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(screen.getByText(describeSession(otherSession)))

    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('opening a note brings the detail sheet forward', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')
    const sid = useSessionsStore.getState().activeSessionId!
    const note = useSessionsStore.getState().addNote(sid, 'a note')!

    useArtifactStore.getState().openNote(sid, note.id)

    expect(await screen.findByRole('complementary', { name: 'Scripture details' })).toHaveAttribute(
      'data-state',
      'open'
    )
  })

  it('a note belonging to the newly selected session survives the switch', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')
    const other = useSessionsStore.getState().createSession('topic', { conceptSlug: 'grace' })
    const note = useSessionsStore.getState().addNote(other.id, 'carry me over')!

    // Simulate the sidebar note click: open the note, then select its session.
    useArtifactStore.getState().openNote(other.id, note.id)
    await userEvent.click(screen.getByRole('button', { name: 'Conversations' }))
    // The sidebar note row is a <button>; scope to it since the open
    // NoteEditor also renders the note body text.
    await userEvent.click(screen.getByRole('button', { name: /carry me over/ }))

    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: other.id, noteId: note.id })
  })

  it('switching the active session resets the artifact store to idle', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')

    useArtifactStore.setState({
      activeArtifact: { type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } },
      activeNote: { sessionId: 'stale-session', noteId: 'x' },
      status: 'ready',
      data: { definition: null, verses: [], resultSummary: '' },
      error: null,
    })
    expect(useArtifactStore.getState().status).toBe('ready')

    await userEvent.click(screen.getByRole('button', { name: /new session/i }))

    expect(useArtifactStore.getState().status).toBe('idle')
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
    expect(useArtifactStore.getState().activeNote).toBeNull()
  })
})
