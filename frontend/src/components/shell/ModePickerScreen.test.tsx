import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModePickerScreen } from './ModePickerScreen'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useReadingPlanStore } from '@/store/useReadingPlanStore'
import * as chatApi from '@/lib/chatApi'
import { listStudyWikis } from '@/lib/modeData'

vi.mock('@/lib/modeData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/modeData')>()
  return { ...actual, listStudyWikis: vi.fn() }
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

  it('typing directly into the landing input starts a freeform session with that message', async () => {
    const postChatSpy = vi
      .spyOn(chatApi, 'postChat')
      .mockResolvedValue({ type: 'chat', message: 'Great question — here is what I found.' })
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'What does John 3:16 mean?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(onSessionStarted).toHaveBeenCalled()
    expect(postChatSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'What does John 3:16 mean?', mode: 'freeform' })
    )
    const session = firstSession()
    expect(session.mode).toBe('freeform')
    expect(session.messages[0]).toMatchObject({ role: 'user', text: 'What does John 3:16 mean?' })
    expect(session.messages[1]).toMatchObject({ role: 'assistant', text: 'Great question — here is what I found.' })
  })
})
