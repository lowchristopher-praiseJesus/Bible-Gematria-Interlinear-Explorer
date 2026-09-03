import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatNotesMenu } from './ChatNotesMenu'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'

describe('ChatNotesMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({
      activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null,
    })
  })

  it('with no notes, clicking the icon opens a new draft and no menu', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatNotesMenu sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId: '' })
    expect(screen.queryByText('New note')).not.toBeInTheDocument()
  })

  it('with notes, clicking the icon opens a menu that lists them', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().addNote(session.id, 'Grace and works')
    render(<ChatNotesMenu sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    await userEvent.click(screen.getByText('Grace and works'))
    const noteId = useSessionsStore.getState().sessions[session.id].notes[0].id
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId })
  })

  it('the "New note" action opens a fresh draft', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().addNote(session.id, 'existing')
    render(<ChatNotesMenu sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    await userEvent.click(screen.getByText('New note'))
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId: '' })
  })

  it('replaces "New note" with a limit message at 5 notes', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    for (let i = 0; i < 5; i++) useSessionsStore.getState().addNote(session.id, `n${i}`)
    render(<ChatNotesMenu sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.queryByText('New note')).not.toBeInTheDocument()
    expect(screen.getByText(/maximum of 5 notes/i)).toBeInTheDocument()
  })

  it('clicking the icon a second time closes the open menu', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().addNote(session.id, 'toggle me')
    render(<ChatNotesMenu sessionId={session.id} />)
    const trigger = screen.getByRole('button', { name: 'Notes' })

    await userEvent.click(trigger)
    expect(screen.getByText('New note')).toBeInTheDocument()

    await userEvent.click(trigger)
    expect(screen.queryByText('New note')).not.toBeInTheDocument()
  })

  it('shows a count badge equal to the number of notes', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().addNote(session.id, 'a')
    useSessionsStore.getState().addNote(session.id, 'b')
    render(<ChatNotesMenu sessionId={session.id} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
