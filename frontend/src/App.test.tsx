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
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
    window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the mode picker when there is no active session', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /ask anything/i })).toBeInTheDocument()
  })

  it('starting a session switches to the three-pane chat layout', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    expect(await screen.findByText('Ask me anything.')).toBeInTheDocument()
    expect(screen.getByText(/click a link in the chat/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument()
  })

  it('renders a Sessions/Chat/Artifact tab bar for narrow viewports', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Artifact' })).toBeInTheDocument()
  })

  it('defaults to the chat pane active and switches panes via the tab bar', async () => {
    render(<App />)
    const chatTab = screen.getByRole('button', { name: 'Chat' })
    const sessionsTab = screen.getByRole('button', { name: 'Sessions' })
    expect(chatTab).toHaveAttribute('aria-current', 'true')

    await userEvent.click(sessionsTab)
    expect(sessionsTab).toHaveAttribute('aria-current', 'true')
    expect(chatTab).not.toHaveAttribute('aria-current')
  })

  it('opening an artifact link switches the active pane to Artifact', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')

    useArtifactStore.getState().openArtifact({ type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } })

    expect(await screen.findByRole('button', { name: 'Artifact' })).toHaveAttribute('aria-current', 'true')
  })

  it('selecting a different session from the sessions pane brings the Chat pane forward', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')

    // A second session, created directly on the store, gives the list a
    // distinct entry to click that actually changes the active session id.
    const otherSession = useSessionsStore.getState().createSession('topic', { topicId: 'grace' })

    await userEvent.click(screen.getByRole('button', { name: 'Sessions' }))
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'true')

    await userEvent.click(screen.getByText(describeSession(otherSession)))

    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-current', 'true')
  })

  it('switching the active session resets the artifact store to idle', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    await screen.findByText('Ask me anything.')

    useArtifactStore.setState({
      activeArtifact: { type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } },
      status: 'ready',
      data: { definition: null, verses: [], resultSummary: '' },
      error: null,
    })
    expect(useArtifactStore.getState().status).toBe('ready')

    await userEvent.click(screen.getByRole('button', { name: /new session/i }))

    expect(useArtifactStore.getState().status).toBe('idle')
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
  })
})
