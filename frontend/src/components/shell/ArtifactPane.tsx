import { useArtifactStore } from '@/store/useArtifactStore'
import { BookContextArtifact } from '@/components/artifacts/BookContextArtifact'
import { EnglishSearchArtifact } from '@/components/artifacts/EnglishSearchArtifact'
import { GematriaArtifact } from '@/components/artifacts/GematriaArtifact'
import { InterlinearArtifact } from '@/components/artifacts/InterlinearArtifact'
import { StrongsArtifact } from '@/components/artifacts/StrongsArtifact'
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
} from '@/types/api'

export function ArtifactPane() {
  const { activeArtifact, status, data, error } = useArtifactStore()

  return (
    <div className="h-full overflow-y-auto p-4">
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
    </div>
  )
}
