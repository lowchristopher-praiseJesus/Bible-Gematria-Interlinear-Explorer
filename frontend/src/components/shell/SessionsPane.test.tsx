import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsPane } from './SessionsPane'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'

describe('SessionsPane', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
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

  it('resets the artifact store when the deleted session was the active one', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useArtifactStore.setState({
      activeArtifact: { type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } },
      status: 'ready',
      data: { definition: null, verses: [], resultSummary: '' },
      error: null,
    })
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /delete session/i }))
    expect(useArtifactStore.getState().status).toBe('idle')
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
  })

  it('leaves the artifact store untouched when the deleted session was not active', async () => {
    const active = useSessionsStore.getState().createSession('freeform', {})
    const other = useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
    useArtifactStore.setState({
      activeArtifact: { type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } },
      status: 'ready',
      data: { definition: null, verses: [], resultSummary: '' },
      error: null,
    })
    render(<SessionsPane activeSessionId={active.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    const otherRow = screen.getByText(other.title).closest('div')!
    await userEvent.click(
      otherRow.querySelector('button[aria-label="Delete session"]') as HTMLButtonElement
    )
    expect(useArtifactStore.getState().status).toBe('ready')
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
