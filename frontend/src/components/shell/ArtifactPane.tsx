import { ChevronLeft, X } from 'lucide-react'
import { useArtifactStore } from '@/store/useArtifactStore'
import { BookContextArtifact } from '@/components/artifacts/BookContextArtifact'
import { EnglishSearchArtifact } from '@/components/artifacts/EnglishSearchArtifact'
import { GematriaArtifact } from '@/components/artifacts/GematriaArtifact'
import { InterlinearArtifact } from '@/components/artifacts/InterlinearArtifact'
import { StrongsArtifact } from '@/components/artifacts/StrongsArtifact'
import { NoteEditor } from '@/components/shell/NoteEditor'
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
} from '@/types/api'

interface Props {
  onClose?: () => void
}

export function ArtifactPane({ onClose }: Props) {
  const { activeArtifact, activeNote, history, status, data, error, close, goBack } = useArtifactStore()

  function handleClose() {
    close()
    onClose?.()
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-theme-border)] shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          {history.length > 0 && (
            <button
              onClick={() => goBack()}
              aria-label="Back"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <span className="font-semibold text-sm truncate">
            {activeNote ? 'Note' : activeArtifact?.label ?? 'Artifact'}
          </span>
        </div>
        <button
          onClick={handleClose}
          aria-label="Close artifact"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeNote ? (
          <NoteEditor
            key={`${activeNote.sessionId}:${activeNote.noteId}`}
            sessionId={activeNote.sessionId}
            noteId={activeNote.noteId}
          />
        ) : (
          <>
            {status === 'idle' && (
              <div className="text-sm text-[var(--color-text-secondary)] italic">
                Click a link in the chat to see details here.
              </div>
            )}
            {status === 'loading' && <div className="text-sm text-[var(--color-text-secondary)]">Loading…</div>}
            {status === 'error' && <div className="text-sm text-red-600">{error}</div>}
            {status === 'ready' && activeArtifact && !!data && (
              <>
                {activeArtifact.type === 'interlinear' && <InterlinearArtifact data={data as ExplorerResponse} />}
                {activeArtifact.type === 'strongs' && <StrongsArtifact data={data as StrongsResponse} />}
                {activeArtifact.type === 'book_context' && <BookContextArtifact data={data as BookContextResponse} />}
                {activeArtifact.type === 'gematria' && <GematriaArtifact data={data as GematriaResponse} />}
                {activeArtifact.type === 'english_search' && <EnglishSearchArtifact data={data as EnglishResponse} />}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
