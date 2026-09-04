import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionsStore } from './useSessionsStore'

const TRACE = {
  turnId: 't1',
  requestPath: '/chat',
  steps: [],
  outcome: { type: 'chat', route: null, error: null },
} as never

describe('useSessionsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })

  it('createSession creates a session with a derived title and sets it active', () => {
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    expect(session.mode).toBe('parable')
    expect(session.modeParams).toEqual({ parableId: 'prodigal_son' })
    expect(session.messages).toEqual([])
    expect(useSessionsStore.getState().activeSessionId).toBe(session.id)
    expect(useSessionsStore.getState().sessions[session.id]).toEqual(session)
  })

  it('derives a topic session title from conceptSlug, hyphens included', () => {
    const session = useSessionsStore.getState().createSession('topic', {
      seriesId: 'present-day-ministry-of-jesus',
      conceptSlug: 'the-life-of-rest',
    })
    expect(session.title).toBe('Topical Study — the life of rest')
  })

  it('appendMessage adds a message and bumps updatedAt', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    const before = useSessionsStore.getState().sessions[session.id].updatedAt
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'user', text: 'hi' })
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0].text).toBe('hi')
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('updateModeParams merges into the existing modeParams', () => {
    const session = useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 0 })
    useSessionsStore.getState().updateModeParams(session.id, { dayIndex: 1, completedDays: [0] })
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.modeParams).toEqual({ plan: 'chronological', dayIndex: 1, completedDays: [0] })
  })

  it('deleteSession removes it and clears activeSessionId if it was active', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().deleteSession(session.id)
    expect(useSessionsStore.getState().sessions[session.id]).toBeUndefined()
    expect(useSessionsStore.getState().activeSessionId).toBeNull()
  })

  it('clearAllSessions wipes every session and the active id', () => {
    useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    useSessionsStore.getState().clearAllSessions()
    expect(useSessionsStore.getState().sessions).toEqual({})
    expect(useSessionsStore.getState().activeSessionId).toBeNull()
  })

  it('listSessions returns sessions newest-updated first', () => {
    const a = useSessionsStore.getState().createSession('freeform', {})
    const b = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(a.id, { id: 'm1', role: 'user', text: 'later' })
    const list = useSessionsStore.getState().listSessions()
    expect(list[0].id).toBe(a.id)
    expect(list[1].id).toBe(b.id)
  })

  it('drops a corrupt persisted session instead of crashing on rehydration', async () => {
    localStorage.setItem(
      'bible-explorer-sessions',
      JSON.stringify({
        state: {
          sessions: {
            // Missing `messages` — the shape that previously crashed ChatPane on render.
            bad: { id: 'bad', mode: 'freeform' },
            // Not even an object.
            alsoBad: 'not-a-session',
            ok: {
              id: 'ok',
              mode: 'freeform',
              modeParams: {},
              title: 'Ask Anything',
              messages: [],
              createdAt: 1,
              updatedAt: 1,
            },
          },
          activeSessionId: 'bad',
        },
        version: 1,
      })
    )

    await useSessionsStore.persist.rehydrate()

    const state = useSessionsStore.getState()
    expect(state.sessions.bad).toBeUndefined()
    expect(state.sessions.alsoBad).toBeUndefined()
    expect(state.sessions.ok).toBeDefined()
    // The active session pointed at a dropped entry, so it resets rather
    // than pointing at nothing.
    expect(state.activeSessionId).toBeNull()
  })

  it('round-trips an assistant message trace through append', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: 'hi', trace: TRACE,
    })
    const stored = useSessionsStore.getState().sessions[session.id].messages[0]
    expect(stored.trace?.turnId).toBe('t1')
  })

  it('keeps trace in memory but strips it from the localStorage copy', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: 'hi', trace: TRACE,
    })
    // Still available for "Report an issue" during the session.
    expect(useSessionsStore.getState().sessions[session.id].messages[0].trace?.turnId).toBe('t1')
    // But never written to disk — that blob is what blows the quota.
    const raw = localStorage.getItem('bible-explorer-sessions')!
    expect(raw).not.toContain('turnId')
    expect(JSON.parse(raw).state.sessions[session.id].messages[0].trace).toBeUndefined()
  })

  it('evicts the oldest session instead of throwing when storage is full', () => {
    const older = useSessionsStore.getState().createSession('freeform', {})
    const newer = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(newer.id, { id: 'm', role: 'user', text: 'hi' })

    const realSetItem = localStorage.setItem.bind(localStorage)
    let calls = 0
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      calls += 1
      // Fail only the first attempt (the full blob); let the retry after
      // eviction go through to real storage.
      if (calls === 1) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      realSetItem(key, value)
    })

    try {
      expect(() =>
        useSessionsStore.getState().appendMessage(newer.id, { id: 'm2', role: 'user', text: 'again' })
      ).not.toThrow()

      const persisted = JSON.parse(localStorage.getItem('bible-explorer-sessions')!)
      expect(persisted.state.sessions[older.id]).toBeUndefined()
      expect(persisted.state.sessions[newer.id]).toBeDefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('persists at version 3', () => {
    expect(useSessionsStore.persist.getOptions().version).toBe(3)
  })

  it('createSession starts with an empty notes array', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    expect(session.notes).toEqual([])
  })

  it('addNote appends a note, returns it, and does not bump session.updatedAt', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    const before = useSessionsStore.getState().sessions[session.id].updatedAt
    const note = useSessionsStore.getState().addNote(session.id, 'first thought')
    expect(note).not.toBeNull()
    expect(note!.body).toBe('first thought')
    const stored = useSessionsStore.getState().sessions[session.id]
    expect(stored.notes).toEqual([note])
    expect(stored.updatedAt).toBe(before)
  })

  it('addNote returns null and does not mutate once a session has 5 notes', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    for (let i = 0; i < 5; i++) useSessionsStore.getState().addNote(session.id, `n${i}`)
    const sixth = useSessionsStore.getState().addNote(session.id, 'n6')
    expect(sixth).toBeNull()
    expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(5)
  })

  it('addNote returns null for an unknown session', () => {
    expect(useSessionsStore.getState().addNote('nope', 'x')).toBeNull()
  })

  it('updateNote replaces the body and bumps only the note updatedAt', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    const note = useSessionsStore.getState().addNote(session.id, 'draft')!
    const sessionUpdatedAt = useSessionsStore.getState().sessions[session.id].updatedAt
    useSessionsStore.getState().updateNote(session.id, note.id, 'revised')
    const stored = useSessionsStore.getState().sessions[session.id]
    expect(stored.notes[0].body).toBe('revised')
    expect(stored.notes[0].updatedAt).toBeGreaterThanOrEqual(note.updatedAt)
    expect(stored.updatedAt).toBe(sessionUpdatedAt)
  })

  it('deleteNote removes the matching note only', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    const a = useSessionsStore.getState().addNote(session.id, 'a')!
    const b = useSessionsStore.getState().addNote(session.id, 'b')!
    useSessionsStore.getState().deleteNote(session.id, a.id)
    const notes = useSessionsStore.getState().sessions[session.id].notes
    expect(notes.map((n) => n.id)).toEqual([b.id])
  })

  it('normalises a persisted session whose notes are missing or malformed', async () => {
    localStorage.setItem(
      'bible-explorer-sessions',
      JSON.stringify({
        state: {
          sessions: {
            noNotes: {
              id: 'noNotes', mode: 'freeform', modeParams: {}, title: 'Ask Anything',
              messages: [], createdAt: 1, updatedAt: 1,
            },
            messyNotes: {
              id: 'messyNotes', mode: 'freeform', modeParams: {}, title: 'Ask Anything',
              messages: [], createdAt: 1, updatedAt: 1,
              notes: [
                { id: 'n1', body: 'keep me', createdAt: 2, updatedAt: 2 },
                'not-an-object',
                { id: 5, body: 'bad id' },
                { id: 'n2', body: 'no timestamps' },
              ],
            },
          },
          activeSessionId: 'noNotes',
        },
        version: 2,
      })
    )
    await useSessionsStore.persist.rehydrate()
    const state = useSessionsStore.getState()
    expect(state.sessions.noNotes.notes).toEqual([])
    const kept = state.sessions.messyNotes.notes
    expect(kept.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(typeof kept[1].createdAt).toBe('number')
  })

  it('trims a persisted notes array longer than 5 to the first 5', async () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, body: `${i}`, createdAt: i, updatedAt: i }))
    localStorage.setItem('bible-explorer-sessions', JSON.stringify({
      state: {
        sessions: { s: { id: 's', mode: 'freeform', modeParams: {}, title: 'Ask Anything', messages: [], createdAt: 1, updatedAt: 1, notes } },
        activeSessionId: 's',
      },
      version: 3,
    }))
    await useSessionsStore.persist.rehydrate()
    expect(useSessionsStore.getState().sessions.s.notes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4'])
  })
})