import { afterEach, describe, expect, it, vi } from 'vitest'
import * as chatApi from '@/lib/chatApi'
import { startTellAStory } from './tellAStory'
import type { ModeParams, Session, SessionMessage } from '@/types/session'

function makeDeps() {
  const sessions: Record<string, Session> = {}
  const messages: Record<string, SessionMessage[]> = {}
  const modeParams: Record<string, Partial<ModeParams>> = {}
  let nextId = 0
  const createSession = vi.fn((mode: 'story', params: ModeParams): Session => {
    const id = `story-session-${++nextId}`
    const session: Session = {
      id, createdAt: 0, updatedAt: 0, mode, modeParams: params,
      title: 'Tell a Story', messages: [], notes: [],
    }
    sessions[id] = session
    messages[id] = []
    return session
  })
  const appendMessage = vi.fn((sessionId: string, message: SessionMessage) => {
    messages[sessionId] = [...(messages[sessionId] ?? []), message]
  })
  const updateModeParams = vi.fn((sessionId: string, patch: Partial<ModeParams>) => {
    modeParams[sessionId] = { ...(modeParams[sessionId] ?? {}), ...patch }
  })
  return { createSession, appendMessage, updateModeParams, sessions, messages, modeParams }
}

function makeSourceSession(): Session {
  return {
    id: 'source-1', createdAt: 0, updatedAt: 0, mode: 'socratic', modeParams: {},
    title: 'Socratic Study', notes: [],
    messages: [
      { id: 'm1', role: 'user', text: 'Tell me about the prodigal son.' },
      { id: 'm2', role: 'assistant', text: "It's a parable about a father's forgiveness." },
    ],
  }
}

describe('startTellAStory', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates a story session sourced from the given session and stores the derived themes', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat',
      message: "Here's what stood out…",
      data: { themes: [{ id: 't1', label: 'Trust', description: 'desc' }], digest: 'a digest' },
    })
    const deps = makeDeps()
    const source = makeSourceSession()

    const newId = await startTellAStory(deps, source)

    expect(deps.createSession).toHaveBeenCalledWith('story', {
      storySourceSessionId: 'source-1',
      storySourceLabel: 'Socratic Study',
    })
    expect(chatApi.postChat).toHaveBeenCalledWith({
      message: '',
      mode: 'story',
      mode_params: {
        storySourceMessages: [
          { role: 'user', text: 'Tell me about the prodigal son.' },
          { role: 'assistant', text: "It's a parable about a father's forgiveness." },
        ],
      },
    })
    expect(deps.modeParams[newId]).toEqual({
      storyThemes: [{ id: 't1', label: 'Trust', description: 'desc' }],
      storyDigest: 'a digest',
      storySelectedThemeIds: [],
      storyAgeRange: '3-6',
    })
    expect(deps.messages[newId]).toHaveLength(2) // synthetic user turn + assistant themes reply
    expect(deps.messages[newId][1]).toMatchObject({ role: 'assistant', text: "Here's what stood out…" })
  })

  it('appends an error message and does not set modeParams when the primer call fails', async () => {
    vi.spyOn(chatApi, 'postChat').mockRejectedValue(new Error('network down'))
    const deps = makeDeps()

    const newId = await startTellAStory(deps, makeSourceSession())

    expect(deps.messages[newId][1].text).toContain('network down')
    expect(deps.updateModeParams).not.toHaveBeenCalled()
  })
})
