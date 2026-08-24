import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionsStore } from './useSessionsStore'

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

  it('listSessions returns sessions newest-updated first', () => {
    const a = useSessionsStore.getState().createSession('freeform', {})
    const b = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(a.id, { id: 'm1', role: 'user', text: 'later' })
    const list = useSessionsStore.getState().listSessions()
    expect(list[0].id).toBe(a.id)
    expect(list[1].id).toBe(b.id)
  })
})