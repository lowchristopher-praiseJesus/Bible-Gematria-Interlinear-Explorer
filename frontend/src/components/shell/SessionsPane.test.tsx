import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsPane } from './SessionsPane'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { describeSession } from '@/lib/sessionDescription'

// While a search is active the description line is broken into <mark> /
// <span> fragments for highlighting, so a plain getByText(fullString)
// no longer resolves it. This matches the innermost element whose
// combined text is the whole description.
function queryDescriptionLine(text: string): HTMLElement | null {
  return screen.queryByText((_, node) => {
    if (!node) return false
    const own = node.textContent === text
    const childMatches = Array.from(node.children).some((c) => c.textContent === text)
    return own && !childMatches
  })
}

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
    // "Parable Study" isn't the active session's category, so it starts collapsed.
    await userEvent.click(screen.getByRole('button', { name: /Parable Study/ }))
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
    render(<SessionsPane activeSessionId={session.id} onSelectSession={onSelectSession} onNewSession={() => {}} />)

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
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
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
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
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

    // Both start collapsed (neither is the active session) — open both first.
    await userEvent.click(screen.getByRole('button', { name: /Parable Study/ }))
    await userEvent.click(screen.getByRole('button', { name: /Topical Study/ }))
    expect(screen.getByText(describeSession(parableSession))).toBeInTheDocument()
    expect(screen.getByText(describeSession(topicSession))).toBeInTheDocument()

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
    render(<SessionsPane activeSessionId={newer.id} onSelectSession={() => {}} onNewSession={() => {}} />)
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
    // "Parable Study" isn't the active session's category, so it starts collapsed.
    await userEvent.click(screen.getByRole('button', { name: /Parable Study/ }))
    const otherRow = screen.getByText(describeSession(other)).closest('div')!.parentElement!
    await userEvent.click(within(otherRow).getByRole('button', { name: /delete session/i }))
    expect(useArtifactStore.getState().status).toBe('ready')
  })

  it('re-renders when sessions are mutated externally via store', async () => {
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.queryByText(/Parable Study/)).not.toBeInTheDocument()
    useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
    await waitFor(() => {
      expect(screen.getByText(/Parable Study/)).toBeInTheDocument()
    })
  })

  it('groups imported sessions under an Imported section, not their mode section', async () => {
    useSessionsStore.getState().createSession('freeform', {})
    const imported = useSessionsStore.getState().importSession({
      token: 't1', mode: 'devotional', modeParams: { source: 'system' }, title: 'Devotional',
      messages: [{ id: 'x', role: 'user', text: 'shared line' }], notes: [],
    })
    render(<SessionsPane activeSessionId={imported.id} onSelectSession={() => {}} onNewSession={() => {}} />)

    expect(screen.getByRole('button', { name: /Imported \(1\)/ })).toBeInTheDocument()
    // No "Devotional" mode header is created for the imported devotional.
    expect(screen.queryByRole('button', { name: /^Devotional \(/ })).not.toBeInTheDocument()
    // Its row carries the original mode as a sub-label.
    expect(screen.getByText('Imported · Devotional')).toBeInTheDocument()
  })

  it('search matches an imported session and keeps the Imported section shown', async () => {
    const imported = useSessionsStore.getState().importSession({
      token: 't2', mode: 'freeform', modeParams: {}, title: 'x',
      messages: [{ id: 'x', role: 'user', text: 'find this needle' }], notes: [],
    })
    render(<SessionsPane activeSessionId={imported.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    await userEvent.type(screen.getByRole('searchbox'), 'needle')
    expect(screen.getByRole('button', { name: /Imported \(1\)/ })).toBeInTheDocument()
  })

  describe('search', () => {
    it('hides sessions that do not match what was typed, keeping matches grouped by mode', async () => {
      const parable = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      const topic = useSessionsStore.getState().createSession('topic', { conceptSlug: 'faith' })
      render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

      await userEvent.type(screen.getByRole('searchbox', { name: /search conversations/i }), 'prodigal')

      expect(queryDescriptionLine(describeSession(parable))).toBeInTheDocument()
      expect(screen.getByText(/Parable Study/)).toBeInTheDocument()
      expect(queryDescriptionLine(describeSession(topic))).not.toBeInTheDocument()
      expect(screen.queryByText(/Topical Study/)).not.toBeInTheDocument()
    })

    it('matches on message text, not just the session title', async () => {
      const session = useSessionsStore.getState().createSession('freeform', {})
      useSessionsStore.getState().appendMessage(session.id, {
        id: 'u1',
        role: 'user',
        text: 'Tell me about the pearl of great price',
      })
      render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

      await userEvent.type(screen.getByRole('searchbox', { name: /search conversations/i }), 'pearl of great price')

      expect(screen.getByText(/Ask Anything/)).toBeInTheDocument()
    })

    it('reflects the number of matches in the section header count', async () => {
      useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
      useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

      expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveTextContent('(2)')
      await userEvent.type(screen.getByRole('searchbox', { name: /search conversations/i }), 'prodigal')
      expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveTextContent('(1)')
    })

    it('shows a no-results message when the query matches nothing', async () => {
      useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

      await userEvent.type(screen.getByRole('searchbox', { name: /search conversations/i }), 'nothingmatchesthis')

      expect(screen.getByText(/no conversations match/i)).toBeInTheDocument()
      expect(screen.queryByText(/Parable Study/)).not.toBeInTheDocument()
    })

    it('restores the full list when the search box is cleared', async () => {
      const parable = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      const topic = useSessionsStore.getState().createSession('topic', { conceptSlug: 'faith' })
      render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
      // Both start collapsed (neither is the active session) — open both first.
      await userEvent.click(screen.getByRole('button', { name: /Parable Study/ }))
      await userEvent.click(screen.getByRole('button', { name: /Topical Study/ }))
      const box = screen.getByRole('searchbox', { name: /search conversations/i })

      await userEvent.type(box, 'prodigal')
      expect(queryDescriptionLine(describeSession(topic))).not.toBeInTheDocument()

      await userEvent.clear(box)

      expect(screen.getByText(describeSession(parable))).toBeInTheDocument()
      expect(screen.getByText(describeSession(topic))).toBeInTheDocument()
    })

    it('reveals a match inside a section the user had collapsed', async () => {
      const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

      // "Parable Study" isn't the active session's category, so it's already collapsed.
      expect(screen.queryByText(describeSession(session))).not.toBeInTheDocument()

      await userEvent.type(screen.getByRole('searchbox', { name: /search conversations/i }), 'prodigal')

      expect(queryDescriptionLine(describeSession(session))).toBeInTheDocument()
    })

    it('highlights the matched text in a result row', async () => {
      useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

      await userEvent.type(screen.getByRole('searchbox', { name: /search conversations/i }), 'prodigal')

      expect(screen.getByText('Prodigal', { selector: 'mark' })).toBeInTheDocument()
    })
  })

  it('groups Deep Study sessions under their own heading', () => {
    useSessionsStore.getState().createSession('hermeneutics', {})
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    // The label differs from the mode id on purpose — see Global Constraints.
    expect(screen.getByText('Deep Study')).toBeInTheDocument()
  })

  it('groups character sessions under a "Chat with a Character" heading', () => {
    useSessionsStore.getState().createSession('character', { characterId: 'david', characterName: 'David' })
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.getByRole('button', { name: /Chat with a Character/ })).toBeInTheDocument()
  })

  it('groups a story session under its own "Tell a Story" heading', () => {
    useSessionsStore.getState().createSession('story', { storySourceLabel: 'Socratic Study' })
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    expect(screen.getByText('Tell a Story')).toBeInTheDocument()
  })

  describe('default expansion', () => {
    it('starts every category collapsed when there is no active session', () => {
      useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      useSessionsStore.getState().createSession('topic', { conceptSlug: 'faith' })
      render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

      expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: /Topical Study/ })).toHaveAttribute('aria-expanded', 'false')
    })

    it("expands only the active session's category on mount, leaving the rest collapsed", () => {
      useSessionsStore.getState().createSession('topic', { conceptSlug: 'faith' })
      const active = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      render(<SessionsPane activeSessionId={active.id} onSelectSession={() => {}} onNewSession={() => {}} />)

      expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: /Topical Study/ })).toHaveAttribute('aria-expanded', 'false')
    })

    it('expands the Imported section on mount when the active session is imported', () => {
      const imported = useSessionsStore.getState().importSession({
        token: 't3', mode: 'devotional', modeParams: { source: 'system' }, title: 'Devotional',
        messages: [{ id: 'x', role: 'user', text: 'shared line' }], notes: [],
      })
      render(<SessionsPane activeSessionId={imported.id} onSelectSession={() => {}} onNewSession={() => {}} />)

      expect(screen.getByRole('button', { name: /Imported/ })).toHaveAttribute('aria-expanded', 'true')
    })

    it('switches which category is expanded when a different session becomes active', () => {
      const parableSession = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      const topicSession = useSessionsStore.getState().createSession('topic', { conceptSlug: 'faith' })
      const { rerender } = render(
        <SessionsPane activeSessionId={parableSession.id} onSelectSession={() => {}} onNewSession={() => {}} />
      )
      expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveAttribute('aria-expanded', 'true')

      rerender(<SessionsPane activeSessionId={topicSession.id} onSelectSession={() => {}} onNewSession={() => {}} />)

      expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: /Topical Study/ })).toHaveAttribute('aria-expanded', 'true')
    })

    it('keeps the previous category expanded after exiting to no active session', () => {
      const parableSession = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
      const { rerender } = render(
        <SessionsPane activeSessionId={parableSession.id} onSelectSession={() => {}} onNewSession={() => {}} />
      )
      expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveAttribute('aria-expanded', 'true')

      rerender(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)

      expect(screen.getByRole('button', { name: /Parable Study/ })).toHaveAttribute('aria-expanded', 'true')
    })
  })
})
