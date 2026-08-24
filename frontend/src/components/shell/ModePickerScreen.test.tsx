import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModePickerScreen } from './ModePickerScreen'
import { useSessionsStore } from '@/store/useSessionsStore'
import * as chatApi from '@/lib/chatApi'

describe('ModePickerScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows all four mode cards plus Ask Anything', () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    expect(screen.getByRole('button', { name: /bible in a year/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /parable study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /verse of the day/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /topical study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ask anything/i })).toBeInTheDocument()
  })

  it('selecting Ask Anything creates a freeform session immediately', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    expect(onSessionStarted).toHaveBeenCalled()
    const sessions = Object.values(useSessionsStore.getState().sessions)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].mode).toBe('freeform')
    expect(sessions[0].messages[0].text).toBe('Ask me anything.')
  })

  it('selecting Bible in a Year requires a chronological/canonical sub-choice', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Day 1' })
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /bible in a year/i }))
    expect(screen.getByRole('button', { name: /chronological/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /canonical/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /chronological/i }))
    expect(onSessionStarted).toHaveBeenCalled()
    const sessions = Object.values(useSessionsStore.getState().sessions)
    expect(sessions[0].modeParams).toEqual({ plan: 'chronological', dayIndex: 0, completedDays: [] })
  })

  it('selecting Parable Study fetches and lists curated parables', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ parables: [{ id: 'prodigal_son', name: 'The Prodigal Son', reference: 'Luke 15:11-32' }] }),
    } as Response)
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /parable study/i }))
    expect(await screen.findByRole('button', { name: /the prodigal son/i })).toBeInTheDocument()
  })

  it('shows an error message with a retry option when listParables rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    } as Response)
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /parable study/i }))
    expect(await screen.findByText(/failed to load parables/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('shows an error message with a retry option when listTopics rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    } as Response)
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /topical study/i }))
    expect(await screen.findByText(/failed to load topics/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
