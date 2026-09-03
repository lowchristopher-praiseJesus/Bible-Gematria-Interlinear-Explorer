import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsPane } from './SessionsPane'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { describeSession } from '@/lib/sessionDescription'

describe('SessionsPane', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({ activeArtifact: null, activeNote: null, status: 'idle', data: null, error: null })
  })

  it("renders a session's notes as indented rows beneath it", () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().addNote(session.id, 'Note about mercy')
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.getByText('Note about mercy')).toBeInTheDocument()
  })

  it('clicking a note row opens it in the artifact store', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    const note = useSessionsStore.getState().addNote(session.id, 'Open me')!
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    await userEvent.click(screen.getByText('Open me'))
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId: note.id })
  })

  it('selects the parent session when a note from an inactive session is clicked', async () => {
    const active = useSessionsStore.getState().createSession('freeform', {})
    const other = useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
    const note = useSessionsStore.getState().addNote(other.id, 'from the other one')!
    const onSelectSession = vi.fn()
    render(<SessionsPane activeSessionId={active.id} onSelectSession={onSelectSession} onNewSession={() => {}} />)
    await userEvent.click(screen.getByText('from the other one'))
    expect(onSelectSession).toHaveBeenCalledWith(other.id)
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: other.id, noteId: note.id })
  })

  it('hides note rows when their mode section is collapsed', async () => {
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    useSessionsStore.getState().addNote(session.id, 'collapsible note')
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.getByText('collapsible note')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Parable Study/ }))
    expect(screen.queryByText('collapsible note')).not.toBeInTheDocument()
  })

  it('lists a session under its mode section, with a description and calls onSelectSession when clicked', async () => {
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    const onSelectSession = vi.fn()
    render(<SessionsPane activeSessionId={null} onSelectSession={onSelectSession} onNewSession={() => {}} />)

    expect(screen.getByText(/Parable Study/)).toBeInTheDocument()
    expect(screen.getByText(describeSession(session))).toBeInTheDocument()

    await userEvent.click(screen.getByText(describeSession(session)))
    expect(onSelectSession).toHaveBeenCalledWith(session.id)
  })

  it('shows a timestamp for when the session was started', () => {
    const now = Date.now()
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.setState((state) => ({
      sessions: { ...state.sessions, [session.id]: { ...state.sessions[session.id], createdAt: now } },
    }))
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.getByText(/^Today, \d{1,2}:\d{2} (AM|PM)$/)).toBeInTheDocument()
  })

  it('groups sessions of different modes under separate section headers, in mode-picker order', () => {
    useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 0 })
    useSessionsStore.getState().createSession('topic', { conceptSlug: 'faith' })
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

    const headers = screen.getAllByRole('button', { name: /Bible in a Year|Topical Study|Ask Anything/ })
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringContaining('Bible in a Year'),
      expect.stringContaining('Topical Study'),
      expect.stringContaining('Ask Anything'),
    ])
  })

  it('shows a count of sessions in each section header', () => {
    useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
    useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveTextContent('(2)')
  })

  it('collapses a section on click, hiding its sessions, and expands it again on a second click', async () => {
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    const header = screen.getByRole('button', { name: /Parable Study/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(describeSession(session))).toBeInTheDocument()

    await userEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(describeSession(session))).not.toBeInTheDocument()

    await userEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(describeSession(session))).toBeInTheDocument()
  })

  it('collapses sections independently of one another', async () => {
    const parableSession = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    const topicSession = useSessionsStore.getState().createSession('topic', { conceptSlug: 'faith' })
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /Parable Study/ }))

    expect(screen.queryByText(describeSession(parableSession))).not.toBeInTheDocument()
    expect(screen.getByText(describeSession(topicSession))).toBeInTheDocument()
  })

  it('does not render a section header for a mode with no sessions', () => {
    useSessionsStore.getState().createSession('freeform', {})
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.queryByText(/Parable Study/)).not.toBeInTheDocument()
  })

  it('sorts sessions within a section by most recently updated first', () => {
    const older = useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
    const newer = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    useSessionsStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [older.id]: { ...state.sessions[older.id], updatedAt: 1000 },
        [newer.id]: { ...state.sessions[newer.id], updatedAt: 2000 },
      },
    }))
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    const rows = screen.getAllByText(/lost sheep|prodigal son/i)
    expect(rows.map((r) => r.textContent)).toEqual(['Prodigal son', 'Lost sheep'])
  })

  it('calls onNewSession when the new-session button is clicked', async () => {
    const onNewSession = vi.fn()
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={onNewSession} />)
    await userEvent.click(screen.getByRole('button', { name: /new session/i }))
    expect(onNewSession).toHaveBeenCalled()
  })

  it('deletes a session when its delete button is clicked', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /delete session/i }))
    expect(useSessionsStore.getState().sessions[session.id]).toBeUndefined()
  })

  it('resets the artifact store when the deleted session was the active one', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useArtifactStore.setState({
      activeArtifact: { type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } },
      status: 'ready',
      data: { definition: null, verses: [], resultSummary: '' },
      error: null,
    })
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /delete session/i }))
    expect(useArtifactStore.getState().status).toBe('idle')
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
  })

  it('leaves the artifact store untouched when the deleted session was not active', async () => {
    const active = useSessionsStore.getState().createSession('freeform', {})
    const other = useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
    useArtifactStore.setState({
      activeArtifact: { type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } },
      status: 'ready',
      data: { definition: null, verses: [], resultSummary: '' },
      error: null,
    })
    render(<SessionsPane activeSessionId={active.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    const otherRow = screen.getByText(describeSession(other)).closest('div')!.parentElement!
    await userEvent.click(within(otherRow).getByRole('button', { name: /delete session/i }))
    expect(useArtifactStore.getState().status).toBe('ready')
  })

  it('re-renders when sessions are mutated externally via store', async () => {
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.queryByText(/Parable Study/)).not.toBeInTheDocument()
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
    await waitFor(() => {
      expect(screen.getByText(describeSession(session))).toBeInTheDocument()
    })
  })
})
