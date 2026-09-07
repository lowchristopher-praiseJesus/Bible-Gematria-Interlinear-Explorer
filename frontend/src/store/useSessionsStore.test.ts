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

  it('creates a devotional session titled "Devotional"', () => {
    const s = useSessionsStore.getState().createSession('devotional', { source: 'system' })
    expect(s.mode).toBe('devotional')
    expect(s.title).toBe('Devotional')
    expect(s.modeParams).toEqual({ source: 'system' })
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

  it('persists at version 4', () => {
    expect(useSessionsStore.persist.getOptions().version).toBe(4)
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

  describe('importSession', () => {
    const payload = {
      token: 'tok-123',
      sharedAt: '2026-09-07T00:00:00.000Z',
      mode: 'devotional' as const,
      modeParams: { source: 'system' as const, delivered: true },
      title: 'Devotional',
      messages: [
        { id: 'orig-1', role: 'user' as const, text: 'share me' },
        { id: 'orig-2', role: 'assistant' as const, text: 'a devotional', trace: { turnId: 'x' } as never },
        { role: 'user', text: 'no id — dropped' } as never,
      ],
      notes: [{ id: 'orig-n', body: 'shared note', createdAt: 1, updatedAt: 1 }],
    }

    it('creates a fresh session flagged imported without stealing focus', () => {
      const before = useSessionsStore.getState().activeSessionId
      const s = useSessionsStore.getState().importSession(payload)
      expect(s.imported).toEqual({
        token: 'tok-123', importedAt: expect.any(Number), sharedAt: '2026-09-07T00:00:00.000Z',
      })
      expect(s.mode).toBe('devotional')
      expect(s.modeParams).toEqual({ source: 'system', delivered: true })
      expect(useSessionsStore.getState().activeSessionId).toBe(before)
      expect(useSessionsStore.getState().sessions[s.id]).toEqual(s)
    })

    it('sanitizes messages: drops malformed, strips trace, regenerates ids', () => {
      const s = useSessionsStore.getState().importSession(payload)
      expect(s.messages).toHaveLength(2)
      expect(s.messages.map((m) => m.text)).toEqual(['share me', 'a devotional'])
      expect(s.messages[0].id).not.toBe('orig-1')
      expect(s.messages[1]).not.toHaveProperty('trace')
    })

    it('regenerates note ids and keeps note bodies', () => {
      const s = useSessionsStore.getState().importSession(payload)
      expect(s.notes).toHaveLength(1)
      expect(s.notes[0].body).toBe('shared note')
      expect(s.notes[0].id).not.toBe('orig-n')
    })

    it('falls back to a derived title when the payload title is blank', () => {
      const s = useSessionsStore.getState().importSession({ ...payload, title: '   ' })
      expect(s.title).toBe('Devotional')
    })

    it('strips misshapen artifacts/data/choices but keeps well-formed ones', () => {
      const s = useSessionsStore.getState().importSession({
        ...payload,
        messages: [
          {
            id: 'junk',
            role: 'assistant' as const,
            text: 'crafted extras',
            choices: 'xxx',
            artifacts: 'nope',
            data: 5,
          } as never,
          {
            id: 'real',
            role: 'assistant' as const,
            text: 'a real artifact',
            artifacts: [{ type: 'strongs', label: 'x', params: { id: 'H1' } }],
          } as never,
        ],
      })
      expect(s.messages).toHaveLength(2)
      const [junk, real] = s.messages
      expect(junk).not.toHaveProperty('choices')
      expect(junk).not.toHaveProperty('artifacts')
      expect(junk).not.toHaveProperty('data')
      expect(real.artifacts).toEqual([{ type: 'strongs', label: 'x', params: { id: 'H1' } }])
    })
  })

  it('rehydrates a valid imported marker and drops a malformed one', async () => {
    localStorage.setItem(
      'bible-explorer-sessions',
      JSON.stringify({
        version: 4,
        state: {
          activeSessionId: null,
          sessions: {
            good: {
              id: 'good', mode: 'freeform', modeParams: {}, title: 'x',
              messages: [], notes: [], createdAt: 1, updatedAt: 1,
              imported: { token: 't', importedAt: 5 },
            },
            bad: {
              id: 'bad', mode: 'freeform', modeParams: {}, title: 'y',
              messages: [], notes: [], createdAt: 1, updatedAt: 1,
              imported: { token: 123 },
            },
          },
        },
      })
    )
    await useSessionsStore.persist.rehydrate()
    const state = useSessionsStore.getState()
    expect(state.sessions.good.imported).toEqual({ token: 't', importedAt: 5 })
    expect(state.sessions.bad.imported).toBeUndefined()
  })
})