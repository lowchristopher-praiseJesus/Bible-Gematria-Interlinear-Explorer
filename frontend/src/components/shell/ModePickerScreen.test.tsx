import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModePickerScreen } from './ModePickerScreen'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useReadingPlanStore } from '@/store/useReadingPlanStore'
import * as chatApi from '@/lib/chatApi'
import { listCharacters, listStudyWikis } from '@/lib/modeData'

vi.mock('@/lib/modeData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/modeData')>()
  return { ...actual, listStudyWikis: vi.fn(), listCharacters: vi.fn() }
})

describe('ModePickerScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useReadingPlanStore.setState({ progress: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function firstSession() {
    return Object.values(useSessionsStore.getState().sessions)[0]
  }

  it('shows all four mode cards plus Ask Anything', () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    expect(screen.getByRole('button', { name: /bible in a year/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /parable study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /verse of the day/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /topical study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /socratic study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ask anything/i })).toBeInTheDocument()
  })

  it('selecting Ask Anything posts it as the user turn and starts a freeform session immediately', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    expect(onSessionStarted).toHaveBeenCalled()
    const session = firstSession()
    expect(session.mode).toBe('freeform')
    expect(session.messages[0]).toMatchObject({ role: 'user', text: '💬 Ask Anything' })
    expect(session.messages[1]).toMatchObject({ role: 'assistant', text: 'Ask me anything.' })
  })

  it('selecting Bible in a Year posts it as the user turn and offers the plan choice inline', async () => {
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /bible in a year/i }))

    expect(onSessionStarted).toHaveBeenCalled()
    const session = firstSession()
    expect(session.mode).toBe('reading_plan')
    // The plan hasn't been picked yet — nothing is finalized until the
    // user answers the choice prompt inside the chat.
    expect(session.modeParams).toEqual({})
    expect(session.messages[0]).toMatchObject({ role: 'user', text: '📅 Bible in a Year' })
    expect(session.messages[1].role).toBe('assistant')
    expect(session.messages[1].choicesStatus).toBe('ready')
    expect(session.messages[1].choices).toEqual([
      { label: 'Chronological', modeParams: { plan: 'chronological', dayIndex: 0, completedDays: [] } },
      { label: 'Canonical (book order)', modeParams: { plan: 'canonical', dayIndex: 0, completedDays: [] } },
    ])
  })

  it('selecting Bible in a Year skips straight to the next day when a plan was already chosen', async () => {
    useReadingPlanStore.setState({
      progress: { plan: 'canonical', dayIndex: 4, completedDays: [0, 1, 2, 3] },
    })
    const postChatSpy = vi
      .spyOn(chatApi, 'postChat')
      .mockResolvedValue({ type: 'chat', message: 'Day 5 — Canonical Reading Plan' })
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /bible in a year/i }))

    expect(onSessionStarted).toHaveBeenCalled()
    expect(postChatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'reading_plan',
        mode_params: { plan: 'canonical', dayIndex: 4, completedDays: [0, 1, 2, 3] },
      })
    )
    const session = firstSession()
    expect(session.mode).toBe('reading_plan')
    // No choice prompt this time — the plan is already known.
    expect(session.messages).toHaveLength(2)
    expect(session.messages[1]).toMatchObject({ role: 'assistant', text: 'Day 5 — Canonical Reading Plan' })
  })

  it('selecting Verse of the Day offers a "Surprise me" choice inline', async () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /verse of the day/i }))

    const session = firstSession()
    expect(session.mode).toBe('verse')
    expect(session.messages[0]).toMatchObject({ role: 'user', text: '✨ Verse of the Day' })
    expect(session.messages[1].choices).toEqual([{ label: 'Surprise me', modeParams: {} }])
  })

  it('selecting Parable Study fetches curated parables into the choice prompt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ parables: [{ id: 'prodigal_son', name: 'The Prodigal Son', reference: 'Luke 15:11-32' }] }),
    } as Response)
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /parable study/i }))

    await waitFor(() => expect(firstSession().messages[1].choicesStatus).toBe('ready'))
    expect(firstSession().messages[1].choices).toEqual([
      { label: 'The Prodigal Son (Luke 15:11-32)', modeParams: { parableId: 'prodigal_son' } },
    ])
  })

  it('surfaces a retryable error on the choice prompt when listParables rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    } as Response)
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /parable study/i }))

    await waitFor(() => expect(firstSession().messages[1].choicesStatus).toBe('error'))
    expect(firstSession().messages[1].choicesError).toBeTruthy()
  })

  it('fetches the registered study-wiki series and shows them as a choice prompt', async () => {
    vi.mocked(listStudyWikis).mockResolvedValue([
      { id: 'present-day-ministry-of-jesus', title: 'The Present-Day Ministry of Jesus', speaker: 'Joseph Prince', description: 'desc' },
      { id: 'series-b', title: 'Series B', speaker: 'Speaker B', description: 'b' },
    ])

    render(<ModePickerScreen onSessionStarted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Topical Study/ }))

    await waitFor(() => expect(firstSession().messages[1].choicesStatus).toBe('ready'))
    expect(firstSession().messages[1].choices).toEqual([
      { label: 'The Present-Day Ministry of Jesus — Joseph Prince', modeParams: { seriesId: 'present-day-ministry-of-jesus' } },
      { label: 'Series B — Speaker B', modeParams: { seriesId: 'series-b' } },
    ])
  })

  it('selecting Devotional offers the "your verse vs mine" choice inline', async () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /devotional/i }))

    const session = firstSession()
    expect(session.mode).toBe('devotional')
    expect(session.messages[0]).toMatchObject({ role: 'user', text: '📖 Devotional' })
    expect(session.messages[1].role).toBe('assistant')
    expect(session.messages[1].choicesStatus).toBe('ready')
    expect(session.messages[1].choices).toEqual([
      { label: "I'll choose", modeParams: { source: 'user' } },
      { label: 'Pick one for me', modeParams: { source: 'system' } },
    ])
  })

  it('selecting Socratic Study offers a "Surprise me" choice inline', async () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /socratic study/i }))

    const session = firstSession()
    expect(session.mode).toBe('socratic')
    expect(session.messages[0]).toMatchObject({ role: 'user', text: '🤔 Socratic Study' })
    expect(session.messages[1].choicesStatus).toBe('ready')
    expect(session.messages[1].choices).toEqual([{ label: 'Surprise me', modeParams: {} }])
  })

  it('typing directly into the landing input starts a freeform session with that message', async () => {
    const postChatStreamSpy = vi
      .spyOn(chatApi, 'postChatStream')
      .mockResolvedValue({ type: 'chat', message: 'Great question — here is what I found.' })
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'What does John 3:16 mean?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(onSessionStarted).toHaveBeenCalled()
    expect(postChatStreamSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'What does John 3:16 mean?', mode: 'freeform' })
    )
    const session = firstSession()
    expect(session.mode).toBe('freeform')
    expect(session.messages[0]).toMatchObject({ role: 'user', text: 'What does John 3:16 mean?' })
    expect(session.messages[1]).toMatchObject({ role: 'assistant', text: 'Great question — here is what I found.' })
  })

  it('offers a Deep Study starter', () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    expect(screen.getByRole('button', { name: /deep study/i })).toBeInTheDocument()
  })

  it('selecting Deep Study offers a "Surprise me" choice inline', async () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /deep study/i }))

    const session = firstSession()
    expect(session.mode).toBe('hermeneutics')
    expect(session.messages[0]).toMatchObject({ role: 'user', text: '📚 Deep Study' })
    expect(session.messages[1].choicesStatus).toBe('ready')
    expect(session.messages[1].choices).toEqual([{ label: 'Surprise me', modeParams: { surprise: true } }])
  })

  describe('Chat with a Character', () => {
    beforeEach(() => {
      vi.mocked(listCharacters).mockResolvedValue([
        { id: 'david', name: 'David', testament: 'OT', summary: 'The shepherd boy who became king.' },
      ])
    })

    it('opens the character picker from its own starter', async () => {
      render(<ModePickerScreen onSessionStarted={() => {}} />)
      await userEvent.click(screen.getByRole('button', { name: /chat with a character/i }))

      expect(await screen.findByRole('button', { name: /david/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /bible in a year/i })).not.toBeInTheDocument()
      expect(Object.values(useSessionsStore.getState().sessions)).toHaveLength(0)
    })

    it('picking a character starts a character session and fetches the in-character greeting', async () => {
      const postChat = vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Peace. I am David.' })
      const onSessionStarted = vi.fn()
      render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
      await userEvent.click(screen.getByRole('button', { name: /chat with a character/i }))
      await userEvent.click(await screen.findByRole('button', { name: /david/i }))

      expect(onSessionStarted).toHaveBeenCalled()
      const session = firstSession()
      expect(session.mode).toBe('character')
      expect(session.modeParams).toEqual({ characterId: 'david', characterName: 'David' })
      expect(session.title).toBe('Chat with David')
      expect(session.messages[0]).toMatchObject({ role: 'user', text: '💬 Chat with David' })
      expect(session.messages[1]).toMatchObject({ role: 'assistant', text: 'Peace. I am David.' })
      expect(postChat).toHaveBeenCalledWith({
        message: '',
        mode: 'character',
        mode_params: { characterId: 'david', characterName: 'David' },
      })
    })

    it('Back returns to the mode starters', async () => {
      render(<ModePickerScreen onSessionStarted={() => {}} />)
      await userEvent.click(screen.getByRole('button', { name: /chat with a character/i }))
      await screen.findByRole('button', { name: /david/i })
      await userEvent.click(screen.getByRole('button', { name: /back/i }))

      expect(screen.getByRole('button', { name: /bible in a year/i })).toBeInTheDocument()
    })
  })

  it('opens the session picker and starts a Tell a Story session from the chosen conversation', async () => {
    const source = useSessionsStore.getState().createSession('socratic', {})
    useSessionsStore.getState().appendMessage(source.id, { id: 'm1', role: 'user', text: 'Tell me about the prodigal son.' })
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat', message: "Here's what stood out…",
      data: { themes: [{ id: 't1', label: 'Trust', description: 'desc' }], digest: 'a digest' },
    })
    const onSessionStarted = vi.fn()

    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /tell a story/i }))
    await userEvent.click(screen.getByText('Socratic Study'))

    // ModePickerScreen and ChatPane are rendered XOR by App.tsx — no chat
    // surface exists inside ModePickerScreen itself to show the assistant
    // reply, so (matching this file's existing async-assertion pattern at
    // lines 115/131/144) we assert against the store instead of the DOM.
    await waitFor(() => expect(onSessionStarted).toHaveBeenCalled())
    const storySession = Object.values(useSessionsStore.getState().sessions).find((s) => s.mode === 'story')
    expect(storySession?.messages[1]).toMatchObject({ role: 'assistant', text: "Here's what stood out…" })
    expect(storySession?.modeParams.storyThemes).toEqual([{ id: 't1', label: 'Trust', description: 'desc' }])
  })

  it('ignores a second click on a session card while the first Tell a Story primer call is still in flight', async () => {
    const source = useSessionsStore.getState().createSession('socratic', {})
    useSessionsStore.getState().appendMessage(source.id, { id: 'm1', role: 'user', text: 'Tell me about the prodigal son.' })
    let resolvePostChat!: (value: chatApi.ChatApiResponse) => void
    const postChat = vi.spyOn(chatApi, 'postChat').mockReturnValue(
      new Promise((resolve) => {
        resolvePostChat = resolve
      })
    )
    const onSessionStarted = vi.fn()

    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /tell a story/i }))
    const sessionCard = await screen.findByText('Socratic Study')
    await userEvent.click(sessionCard)
    // Session cards are disabled while a pick is in flight, so a second
    // click on the same (now-disabled) card is a no-op — this simulates a
    // rapid double-click reaching the handler before React re-renders.
    await userEvent.click(sessionCard)

    expect(postChat).toHaveBeenCalledTimes(1)
    expect(Object.values(useSessionsStore.getState().sessions).filter((s) => s.mode === 'story')).toHaveLength(1)

    resolvePostChat({ type: 'chat', message: 'themes', data: { themes: [], digest: '' } })
    await waitFor(() => expect(onSessionStarted).toHaveBeenCalled())
  })
})
