import { useArtifactStore } from '@/store/useArtifactStore'
import { BookContextArtifact } from '@/components/artifacts/BookContextArtifact'
import { EnglishSearchArtifact } from '@/components/artifacts/EnglishSearchArtifact'
import { GematriaArtifact } from '@/components/artifacts/GematriaArtifact'
import { InterlinearArtifact } from '@/components/artifacts/InterlinearArtifact'
import { StrongsArtifact } from '@/components/artifacts/StrongsArtifact'
import { WikiConceptArtifact } from '@/components/artifacts/WikiConceptArtifact'
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
  WikiPageResponse,
} from '@/types/api'

interface Props {
  onClose?: () => void
}

export function ArtifactPane({ onClose }: Props) {
  const { activeArtifact, history, status, data, error, close, goBack } = useArtifactStore()

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
              className="shrink-0 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] leading-none text-base px-1"
            >
              ‹
            </button>
          )}
          <span className="font-semibold text-sm truncate">{activeArtifact?.label ?? 'Artifact'}</span>
        </div>
        <button
          onClick={handleClose}
          aria-label="Close artifact"
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] leading-none text-lg px-1"
        >
          ×
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
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
            {activeArtifact.type === 'wiki_concept' && <WikiConceptArtifact data={data as WikiPageResponse} />}
          </>
        )}
      </div>
    </div>
  )
}
