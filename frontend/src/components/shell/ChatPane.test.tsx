import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPane } from './ChatPane'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import * as chatApi from '@/lib/chatApi'

describe('ChatPane', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders existing messages and sends a new one on submit', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Ask me anything.' })
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Sure, go ahead.' })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByText('Ask me anything.')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'What is love?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText('Sure, go ahead.')).toBeInTheDocument()
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.messages).toHaveLength(3) // primer + user + assistant
    expect(updated.messages[1]).toMatchObject({ role: 'user', text: 'What is love?' })
  })

  it('renders markdown bold spans and paragraph breaks in assistant messages', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'This is **bold** text.\n\nA second paragraph.',
    })

    render(<ChatPane sessionId={session.id} />)

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('A second paragraph.')).toBeInTheDocument()
  })

  it('clicking an artifact link opens it in the artifact store', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'Here is John 3:16.',
      artifacts: [{ type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } }],
    })
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /strong's/i }))

    expect(useArtifactStore.getState().activeArtifact).toEqual({ type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } })
  })

  it('shows a "Mark day complete" action for reading_plan sessions', () => {
    const session = useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 0, completedDays: [] })
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Day 1 reading' })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByRole('button', { name: /mark day complete/i })).toBeInTheDocument()
  })

  it('marking a day complete advances dayIndex and records it', async () => {
    const session = useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 2, completedDays: [0, 1] })
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Day 3 reading' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /mark day complete/i }))

    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.modeParams.completedDays).toEqual([0, 1, 2])
    expect(updated.modeParams.dayIndex).toBe(3)
  })
})
