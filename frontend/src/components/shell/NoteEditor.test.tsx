import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteEditor } from './NoteEditor'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'

function newSession() {
  return useSessionsStore.getState().createSession('freeform', {})
}

// Mirrors how ArtifactPane binds the editor: noteId comes from the
// artifact store and the key resets local state on the draft→saved flip.
function BoundEditor({ sessionId }: { sessionId: string }) {
  const activeNote = useArtifactStore((s) => s.activeNote)
  const noteId = activeNote && activeNote.sessionId === sessionId ? activeNote.noteId : ''
  return <NoteEditor key={`${sessionId}:${noteId}`} sessionId={sessionId} noteId={noteId} />
}

describe('NoteEditor', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({
      activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null,
    })
  })

  it('a draft opens in edit mode and Save creates the note', async () => {
    const session = newSession()
    render(<BoundEditor sessionId={session.id} />)
    await userEvent.type(screen.getByLabelText('Note text'), 'A fresh thought')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const notes = useSessionsStore.getState().sessions[session.id].notes
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toBe('A fresh thought')
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId: notes[0].id })
    // The draft remounts into view mode once saved.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('Cancel on a draft closes the pane and persists nothing', async () => {
    const session = newSession()
    render(<NoteEditor sessionId={session.id} noteId="" />)
    await userEvent.type(screen.getByLabelText('Note text'), 'discard me')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(0)
    expect(useArtifactStore.getState().activeNote).toBeNull()
  })

  it('a saved note opens read-only; Edit then Save updates it', async () => {
    const session = newSession()
    const note = useSessionsStore.getState().addNote(session.id, 'original')!
    render(<NoteEditor sessionId={session.id} noteId={note.id} />)

    expect(screen.getByText('original')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByLabelText('Note text')
    await userEvent.clear(box)
    await userEvent.type(box, 'updated body')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(useSessionsStore.getState().sessions[session.id].notes[0].body).toBe('updated body')
    expect(screen.getByText('updated body')).toBeInTheDocument()
  })

  it('Delete needs a second click, then removes the note and closes the pane', async () => {
    const session = newSession()
    const note = useSessionsStore.getState().addNote(session.id, 'kill me')!
    useArtifactStore.getState().openNote(session.id, note.id)
    render(<NoteEditor sessionId={session.id} noteId={note.id} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /click again to confirm/i }))
    expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(0)
    expect(useArtifactStore.getState().activeNote).toBeNull()
  })

  it('shows an unavailable message for a note id that does not exist', () => {
    const session = newSession()
    render(<NoteEditor sessionId={session.id} noteId="ghost" />)
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
  })

  it('shows an "edited" marker once a note updatedAt is ahead of createdAt', () => {
    const session = newSession()
    const note = useSessionsStore.getState().addNote(session.id, 'v1')!
    useSessionsStore.setState((state) => {
      const s = state.sessions[session.id]
      return {
        sessions: {
          ...state.sessions,
          [session.id]: { ...s, notes: s.notes.map((n) => ({ ...n, createdAt: 1000, updatedAt: 2000 })) },
        },
      }
    })
    render(<NoteEditor sessionId={session.id} noteId={note.id} />)
    expect(screen.getByText(/edited/i)).toBeInTheDocument()
  })
})
