import { useState } from 'react'
import { NotebookPen } from 'lucide-react'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { formatSessionTimestamp } from '@/lib/formatTimestamp'

interface Props {
  sessionId: string
  /** Empty string means "a new, unsaved note". */
  noteId: string
}

const PILL_PRIMARY =
  'text-sm px-3 py-1.5 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-40'
const PILL_SECONDARY =
  'text-sm px-3 py-1.5 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)] transition-colors'

export function NoteEditor({ sessionId, noteId }: Props) {
  const isDraft = noteId === ''
  const note = useSessionsStore((s) => {
    const session = s.sessions[sessionId]
    return session ? session.notes.find((n) => n.id === noteId) : undefined
  })
  const addNote = useSessionsStore((s) => s.addNote)
  const updateNote = useSessionsStore((s) => s.updateNote)
  const deleteNote = useSessionsStore((s) => s.deleteNote)
  const openNote = useArtifactStore((s) => s.openNote)
  const close = useArtifactStore((s) => s.close)

  const [mode, setMode] = useState<'view' | 'edit'>(isDraft ? 'edit' : 'view')
  const [draft, setDraft] = useState(note?.body ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [limitHit, setLimitHit] = useState(false)
  const [openedAt] = useState(() => Date.now())

  if (!isDraft && !note) {
    return (
      <div className="text-sm text-[var(--color-text-secondary)] italic">
        This note is no longer available.
      </div>
    )
  }

  const createdAt = note?.createdAt ?? openedAt
  const edited = !!note && note.updatedAt > note.createdAt

  function handleSaveDraft() {
    const created = addNote(sessionId, draft)
    if (!created) {
      setLimitHit(true)
      return
    }
    openNote(sessionId, created.id)
  }

  function handleSaveEdit() {
    updateNote(sessionId, noteId, draft)
    setMode('view')
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    deleteNote(sessionId, noteId)
    close()
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] shrink-0">
        <NotebookPen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{formatSessionTimestamp(createdAt)}</span>
        {edited && <span className="opacity-70">· edited {formatSessionTimestamp(note!.updatedAt)}</span>}
      </div>

      {mode === 'edit' ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write your note…"
          aria-label="Note text"
          className="flex-1 min-h-[12rem] w-full resize-none rounded-lg border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] p-3 text-sm outline-none focus:border-[var(--color-theme-accent)] transition-colors"
        />
      ) : (
        <div className="flex-1 text-sm whitespace-pre-wrap text-[var(--color-text-primary)]">
          {note!.body || <span className="italic text-[var(--color-text-secondary)]">Empty note.</span>}
        </div>
      )}

      {limitHit && (
        <div className="text-xs text-red-600 shrink-0">This conversation already has 5 notes.</div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        {mode === 'edit' ? (
          <>
            <button className={PILL_PRIMARY} onClick={isDraft ? handleSaveDraft : handleSaveEdit}>
              Save
            </button>
            <button
              className={PILL_SECONDARY}
              onClick={() => {
                if (isDraft) {
                  close()
                } else {
                  setDraft(note!.body)
                  setMode('view')
                }
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className={PILL_SECONDARY}
              onClick={() => {
                setDraft(note!.body)
                setMode('edit')
              }}
            >
              Edit
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded-full text-red-600 hover:bg-[var(--color-surface-alt)] transition-colors"
              onClick={handleDelete}
            >
              {confirmingDelete ? 'Click again to confirm' : 'Delete'}
            </button>
            {confirmingDelete && (
              <button
                className="text-xs px-2 py-1 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
