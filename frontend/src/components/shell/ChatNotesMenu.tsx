import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { NotebookPen, Plus, StickyNote } from 'lucide-react'
import { MAX_NOTES_PER_SESSION, useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { noteLabel } from '@/lib/noteLabel'
import { formatSessionTimestamp } from '@/lib/formatTimestamp'
import type { Note } from '@/types/session'

interface Props {
  sessionId: string
}

// Module-level so the `?? EMPTY_NOTES` fallback returns a stable reference
// — a fresh `[]` each render would make the zustand selector see a new
// value every time and re-render in a loop.
const EMPTY_NOTES: Note[] = []

export function ChatNotesMenu({ sessionId }: Props) {
  const notes = useSessionsStore((s) => s.sessions[sessionId]?.notes ?? EMPTY_NOTES)
  const openNote = useArtifactStore((s) => s.openNote)
  const openNewNote = useArtifactStore((s) => s.openNewNote)
  const [open, setOpen] = useState(false)

  const atLimit = notes.length >= MAX_NOTES_PER_SESSION

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        // With no notes there's nothing to list, so opening the menu goes
        // straight to a fresh draft and the popover never opens.
        if (next && notes.length === 0) {
          openNewNote(sessionId)
          return
        }
        setOpen(next)
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Notes"
          title="Notes"
          className="relative shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
        >
          <NotebookPen className="h-4 w-4" aria-hidden="true" />
          {notes.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[10px] leading-none bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]">
              {notes.length}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 flex w-56 flex-col gap-1 rounded-lg border border-[var(--color-theme-border)] bg-[var(--color-surface)] p-2 shadow-lg"
        >
          <div className="px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
            Notes ({notes.length}/{MAX_NOTES_PER_SESSION})
          </div>
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => {
                openNote(sessionId, note.id)
                setOpen(false)
              }}
              className="flex items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{noteLabel(note)}</span>
                <span className="text-[10px] text-[var(--color-text-secondary)]">
                  {formatSessionTimestamp(note.createdAt)}
                </span>
              </span>
            </button>
          ))}
          <div className="mt-1 border-t border-[var(--color-theme-border)] pt-1">
            {atLimit ? (
              <div className="px-2 py-1.5 text-xs text-[var(--color-text-secondary)]">
                Maximum of {MAX_NOTES_PER_SESSION} notes
              </div>
            ) : (
              <button
                onClick={() => {
                  openNewNote(sessionId)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-[var(--color-theme-accent)] transition-colors hover:bg-[var(--color-surface-alt)]"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                New note
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
