import { create } from 'zustand'
import {
  fetchBookContext,
  fetchEnglishSearch,
  fetchGematria,
  fetchInterlinear,
  fetchInterlinearByVersenumber,
  fetchStrongsEntry,
} from '@/lib/chatApi'
import type { ArtifactLink } from '@/types/session'

type ArtifactStatus = 'idle' | 'loading' | 'ready' | 'error'

function sameArtifact(a: ArtifactLink | null, b: ArtifactLink): boolean {
  return !!a && a.type === b.type && JSON.stringify(a.params) === JSON.stringify(b.params)
}

interface ArtifactState {
  activeArtifact: ArtifactLink | null
  activeNote: { sessionId: string; noteId: string } | null
  /** Every artifact navigated away from, most-recent last — e.g. the verse
   * a user was reading before clicking a Strong's number. `goBack` pops
   * this to return there instead of just closing the panel. */
  history: ArtifactLink[]
  status: ArtifactStatus
  data: unknown
  error: string | null
  /** A one-shot request to open `link` once `sessionId` is the session on
   * screen. A session switch resets the panel (App), so a starter that
   * wants its new session to land with an artifact already open (Walk the
   * Tabernacle) asks here instead of opening it before the switch. */
  openOnShow: { sessionId: string; link: ArtifactLink } | null
  setOpenOnShow: (request: { sessionId: string; link: ArtifactLink } | null) => void
  openArtifact: (link: ArtifactLink) => Promise<void>
  openNote: (sessionId: string, noteId: string) => void
  openNewNote: (sessionId: string) => void
  goBack: () => Promise<void>
  close: () => void
}

async function fetchForLink(link: ArtifactLink): Promise<unknown> {
  switch (link.type) {
    case 'interlinear':
      return link.params.versenumber !== undefined
        ? fetchInterlinearByVersenumber(link.params.versenumber as number)
        : fetchInterlinear(link.params.reference as string)
    case 'strongs':
      return fetchStrongsEntry(link.params.id as string)
    case 'book_context':
      return fetchBookContext(link.params.book as string)
    case 'gematria':
      return fetchGematria(link.params.value as number)
    case 'english_search':
      return fetchEnglishSearch(link.params.query as string)
    case 'devotional':
      // The finished devotional text travels inline on the link params
      // (set by the chat message that produced it) — nothing to fetch.
      return link.params
    case 'hermeneutics_report':
      // The whole report travels inline on the link params (set by the chat
      // message that produced it) — nothing to fetch.
      return link.params
    case 'story':
      // The finished story travels inline on the link params (set by the
      // chat message that produced it) — nothing to fetch.
      return link.params
    case 'passage_search':
      // The whole result list travels inline on the link params (set by the
      // chat message that produced it) — nothing to fetch.
      return link.params
    case 'tabernacle':
      // Just the opening spot; travels inline on the link params.
      return link.params
    default:
      throw new Error(`Unknown artifact type: ${link.type}`)
  }
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  activeArtifact: null,
  activeNote: null,
  history: [],
  status: 'idle',
  data: null,
  error: null,
  openOnShow: null,
  setOpenOnShow: (request) => set({ openOnShow: request }),

  openArtifact: async (link) => {
    const current = get().activeArtifact
    // Not opening the same thing that's already showing — stack it onto
    // history so `goBack` can return to it (a Strong's lookup from a
    // verse, one verse to the next, etc.).
    const history = current && !sameArtifact(current, link) ? [...get().history, current] : get().history
    set({ activeArtifact: link, activeNote: null, history, status: 'loading', data: null, error: null })
    try {
      const data = await fetchForLink(link)
      set({ status: 'ready', data })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  openNote: (sessionId, noteId) =>
    set({
      activeNote: { sessionId, noteId },
      activeArtifact: null,
      history: [],
      status: 'idle',
      data: null,
      error: null,
    }),

  openNewNote: (sessionId) =>
    set({
      activeNote: { sessionId, noteId: '' },
      activeArtifact: null,
      history: [],
      status: 'idle',
      data: null,
      error: null,
    }),

  goBack: async () => {
    const history = get().history
    if (history.length === 0) return
    const previous = history[history.length - 1]
    set({ activeArtifact: previous, activeNote: null, history: history.slice(0, -1), status: 'loading', data: null, error: null })
    try {
      const data = await fetchForLink(previous)
      set({ status: 'ready', data })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  close: () => set({ activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null }),
}))
