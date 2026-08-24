import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsPane } from './SessionsPane'
import { useSessionsStore } from '@/store/useSessionsStore'

describe('SessionsPane', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })

  it('lists sessions and calls onSelectSession when clicked', async () => {
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    const onSelectSession = vi.fn()
    render(<SessionsPane activeSessionId={null} onSelectSession={onSelectSession} onNewSession={() => {}} />)
    await userEvent.click(screen.getByText(session.title))
    expect(onSelectSession).toHaveBeenCalledWith(session.id)
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

  it('re-renders when sessions are mutated externally via store', async () => {
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
    // Verify initially empty
    expect(screen.queryByText(/Parable Study/)).not.toBeInTheDocument()
    // Mutate store directly (external mutation, not a click within the component)
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
    // Component should re-render due to Zustand subscription on sessions data
    await waitFor(() => {
      expect(screen.getByText(session.title)).toBeInTheDocument()
    })
  })
})
