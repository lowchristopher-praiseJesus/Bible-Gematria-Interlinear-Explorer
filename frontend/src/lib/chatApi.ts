import { usfmToFullRef } from './usfm'
import type {
  BookContextResponse,
  ChapterResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
  WikiPageResponse,
} from '@/types/api'
import type { ArtifactLink, ModeParams } from '@/types/session'
import type { Trace } from '@/types/trace'

const CHAT_API = '/api/bible-chat'

interface ChatPayload {
  message: string
  history?: { role: 'user' | 'assistant'; text: string }[]
  page_context?: string
  mode?: string
  mode_params?: ModeParams
}

/**
 * Translate the camelCase ModeParams session model into the snake_case
 * keys the FastAPI backend expects on the wire
 * (dayIndex -> day_index, completedDays -> completed_days,
 *  parableId -> parable_id, seriesId -> series_id, conceptSlug -> concept_slug).
 * Unknown keys pass through unchanged so the mapper stays forward-compatible.
 */
export function toWireModeParams(params: ModeParams): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    switch (key) {
      case 'dayIndex':
        out.day_index = value
        break
      case 'completedDays':
        out.completed_days = value
        break
      case 'parableId':
        out.parable_id = value
        break
      case 'seriesId':
        out.series_id = value
        break
      case 'conceptSlug':
        out.concept_slug = value
        break
      default:
        out[key] = value
    }
  }
  return out
}

interface ChatApiResponse {
  type: string
  message: string
  data?: Record<string, unknown> | null
  route?: string
  follow_up_questions?: string[]
  artifacts?: ArtifactLink[]
  trace?: Trace
}

/**
 * Shared response guard for every fetch in this module. `fetch` only
 * rejects on network failure — an HTTP error (4xx/5xx) still resolves
 * with a body, so without this check a malformed error response gets
 * parsed as if it were success data.
 */
export async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

/**
 * A verse reference always ends in `chapter:verse` or
 * `chapter:verse-verse_end`. Strip a trailing range down to its start
 * verse so callers always resolve to the first verse of the range —
 * Flask's own range parsing does `second_n.isdigit()` on the substring
 * after the chapter's colon and silently falls back to verse 1 when a
 * range like "11-32" is present, since it never parses the "-32" suffix.
 * A bare book/chapter reference with no chapter:verse is left unchanged.
 */
function stripVerseRange(reference: string): string {
  return reference.replace(/^(.*\d+:\d+)-\d+$/, '$1')
}

export async function postChat(payload: ChatPayload): Promise<ChatApiResponse> {
  const { mode_params, ...rest } = payload
  const res = await fetch(`${CHAT_API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...rest,
      ...(mode_params && { mode_params: toWireModeParams(mode_params) }),
    }),
  })
  return parseJsonResponse<ChatApiResponse>(res)
}

export async function fetchInterlinear(reference: string): Promise<ExplorerResponse> {
  const res = await fetch(
    `/api/explorer?reference=${encodeURIComponent(usfmToFullRef(stripVerseRange(reference)))}`
  )
  return parseJsonResponse<ExplorerResponse>(res)
}

export async function fetchInterlinearByVersenumber(versenumber: number): Promise<ExplorerResponse> {
  const res = await fetch(`/api/explorer?versenumber=${versenumber}`)
  return parseJsonResponse<ExplorerResponse>(res)
}

/**
 * `fast: true` skips the backend's external multi-translation fetch and
 * returns only the KJV text already sitting in Complete.db — near-instant,
 * no network calls on the server side. Callers use it to paint something
 * readable immediately, then follow up with a plain (non-fast) call to
 * fill in the rest of the translations in the background.
 */
export async function fetchChapter(reference: string, opts?: { fast?: boolean }): Promise<ChapterResponse> {
  const params = new URLSearchParams({ reference: usfmToFullRef(reference) })
  if (opts?.fast) params.set('fast', 'true')
  const res = await fetch(`${CHAT_API}/passage?${params.toString()}`)
  return parseJsonResponse<ChapterResponse>(res)
}

export async function fetchStrongsEntry(id: string): Promise<StrongsResponse> {
  const res = await fetch(`/api/strongs?strongsnumber=${encodeURIComponent(id)}`)
  return parseJsonResponse<StrongsResponse>(res)
}

export async function fetchBookContext(book: string): Promise<BookContextResponse> {
  const res = await fetch(`${CHAT_API}/book_context/${encodeURIComponent(book)}`)
  return parseJsonResponse<BookContextResponse>(res)
}

export async function fetchGematria(value: number): Promise<GematriaResponse> {
  const res = await fetch(`/api/gematria?value=${value}`)
  return parseJsonResponse<GematriaResponse>(res)
}

export async function fetchEnglishSearch(query: string): Promise<EnglishResponse> {
  const res = await fetch(`/api/english?words=${encodeURIComponent(query)}`)
  return parseJsonResponse<EnglishResponse>(res)
}

export async function fetchWikiConcept(seriesId: string, slug: string): Promise<WikiPageResponse> {
  const res = await fetch(`${CHAT_API}/study-wikis/${encodeURIComponent(seriesId)}/pages/${encodeURIComponent(slug)}`)
  return parseJsonResponse<WikiPageResponse>(res)
}
