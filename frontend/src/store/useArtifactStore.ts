import { create } from 'zustand'
import {
  fetchBookContext,
  fetchEnglishSearch,
  fetchGematria,
  fetchInterlinear,
  fetchStrongsEntry,
} from '@/lib/chatApi'
import type { ArtifactLink } from '@/types/session'

type ArtifactStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ArtifactState {
  activeArtifact: ArtifactLink | null
  status: ArtifactStatus
  data: unknown
  error: string | null
  openArtifact: (link: ArtifactLink) => Promise<void>
  close: () => void
}

async function fetchForLink(link: ArtifactLink): Promise<unknown> {
  switch (link.type) {
    case 'interlinear':
      return fetchInterlinear(link.params.reference as string)
    case 'strongs':
      return fetchStrongsEntry(link.params.id as string)
    case 'book_context':
      return fetchBookContext(link.params.book as string)
    case 'gematria':
      return fetchGematria(link.params.value as number)
    case 'english_search':
      return fetchEnglishSearch(link.params.query as string)
    default:
      throw new Error(`Unknown artifact type: ${link.type}`)
  }
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  activeArtifact: null,
  status: 'idle',
  data: null,
  error: null,

  openArtifact: async (link) => {
    set({ activeArtifact: link, status: 'loading', data: null, error: null })
    try {
      const data = await fetchForLink(link)
      set({ status: 'ready', data })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  close: () => set({ activeArtifact: null, status: 'idle', data: null, error: null }),
}))
