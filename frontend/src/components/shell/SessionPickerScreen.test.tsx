import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionPickerScreen } from './SessionPickerScreen'
import { useSessionsStore } from '@/store/useSessionsStore'

describe('SessionPickerScreen', () => {
  beforeEach(() => {
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })

  it('lists past sessions that have at least one message', () => {
    const withMessages = useSessionsStore.getState().createSession('socratic', {})
    useSessionsStore.getState().appendMessage(withMessages.id, { id: 'm1', role: 'user', text: 'hi' })
    useSessionsStore.getState().createSession('freeform', {}) // no messages — excluded

    render(<SessionPickerScreen onPick={() => {}} onBack={() => {}} />)

    expect(screen.getByText('Socratic Study')).toBeInTheDocument()
    expect(screen.getAllByRole('button').length).toBe(2) // Back + the one eligible session
  })

  it('excludes other Tell a Story sessions from the list', () => {
    const story = useSessionsStore.getState().createSession('story', {})
    useSessionsStore.getState().appendMessage(story.id, { id: 'm1', role: 'assistant', text: 'Here is your story.' })

    render(<SessionPickerScreen onPick={() => {}} onBack={() => {}} />)

    expect(screen.queryByText('Tell a Story')).not.toBeInTheDocument()
  })

  it('calls onPick with the chosen session', async () => {
    const session = useSessionsStore.getState().createSession('socratic', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'user', text: 'hi' })
    const onPick = vi.fn()

    render(<SessionPickerScreen onPick={onPick} onBack={() => {}} />)
    await userEvent.click(screen.getByText('Socratic Study'))

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }))
  })

  it('calls onBack when Back is clicked', async () => {
    const onBack = vi.fn()
    render(<SessionPickerScreen onPick={() => {}} onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('disables the session cards and ignores clicks while submitting', async () => {
    const session = useSessionsStore.getState().createSession('socratic', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'user', text: 'hi' })
    const onPick = vi.fn()

    render(<SessionPickerScreen onPick={onPick} onBack={() => {}} submitting />)
    const card = screen.getByText('Socratic Study').closest('button')!
    expect(card).toBeDisabled()

    await userEvent.click(card)

    expect(onPick).not.toHaveBeenCalled()
  })
})
