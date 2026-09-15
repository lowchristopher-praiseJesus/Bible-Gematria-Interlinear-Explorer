import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteEditor } from './NoteEditor'
import { MAX_NOTE_SIZE_CHARS, useSessionsStore } from '@/store/useSessionsStore'
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
    expect(notes[0].body).toBe('<p>A fresh thought</p>')
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

    expect(useSessionsStore.getState().sessions[session.id].notes[0].body).toBe('<p>updated body</p>')
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

  it('saves a title alongside the body and shows it in view mode', async () => {
    const session = newSession()
    render(<BoundEditor sessionId={session.id} />)
    await userEvent.type(screen.getByLabelText('Note title'), 'Grace')
    await userEvent.type(screen.getByLabelText('Note text'), 'body text')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const note = useSessionsStore.getState().sessions[session.id].notes[0]
    expect(note.title).toBe('Grace')
    expect(screen.getByText('Grace')).toBeInTheDocument()
  })

  it('toggles bold on the selected text via the toolbar', async () => {
    const session = newSession()
    render(<BoundEditor sessionId={session.id} />)
    const box = screen.getByLabelText('Note text')
    await userEvent.type(box, 'bold me')
    await userEvent.click(box)
    // Select all text in the editor, then toggle bold on the selection.
    await userEvent.keyboard('{Control>}a{/Control}')
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const note = useSessionsStore.getState().sessions[session.id].notes[0]
    expect(note.body).toContain('<strong>')
  })

  it('re-renders an embedded base64 image on reopen instead of dropping it', () => {
    // Regression: Tiptap's Image extension defaults to allowBase64: false,
    // which parses the initial `content` HTML with a rule that excludes
    // `img[src^="data:"]` — a saved image would vanish the next time the
    // note was opened even though it displayed fine right after inserting.
    const session = newSession()
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const note = useSessionsStore.getState().addNote(session.id, `<p><img src="${dataUrl}"></p>`)!
    render(<NoteEditor sessionId={session.id} noteId={note.id} />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', dataUrl)
  })

  it('reports "too large" (not "5 notes") when a first, oversized draft fails to save', async () => {
    // Regression: addNote returns null for two unrelated reasons (the
    // 5-note cap and the size cap), and the editor used to always blame
    // the 5-note cap — misleading on a session with only one note.
    const session = newSession()
    render(<BoundEditor sessionId={session.id} />)
    const box = screen.getByLabelText('Note text')
    await userEvent.click(box)
    await userEvent.paste('x'.repeat(MAX_NOTE_SIZE_CHARS + 1))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText(/too large to save/i)).toBeInTheDocument()
    expect(screen.queryByText(/already has 5 notes/i)).not.toBeInTheDocument()
    expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(0)
  })

  it('reports "5 notes" when the cap is actually the reason a draft cannot save', async () => {
    const session = newSession()
    for (let i = 0; i < 5; i++) useSessionsStore.getState().addNote(session.id, `n${i}`)
    render(<BoundEditor sessionId={session.id} />)
    await userEvent.type(screen.getByLabelText('Note text'), 'one more')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText(/already has 5 notes/i)).toBeInTheDocument()
  })
})
