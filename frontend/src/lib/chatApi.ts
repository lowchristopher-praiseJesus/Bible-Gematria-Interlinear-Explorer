import { usfmToFullRef } from './usfm'
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
} from '@/types/api'
import type { ArtifactLink, ModeParams } from '@/types/session'

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
 *  parableId -> parable_id, topicId -> topic_id).
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
      case 'topicId':
        out.topic_id = value
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
  return res.json()
}

export async function fetchInterlinear(reference: string): Promise<ExplorerResponse> {
  const res = await fetch(`/api/explorer?reference=${encodeURIComponent(usfmToFullRef(reference))}`)
  return res.json()
}

export async function fetchStrongsEntry(id: string): Promise<StrongsResponse> {
  const res = await fetch(`/api/strongs?strongsnumber=${encodeURIComponent(id)}`)
  return res.json()
}

export async function fetchBookContext(book: string): Promise<BookContextResponse> {
  const res = await fetch(`${CHAT_API}/book_context/${encodeURIComponent(book)}`)
  return res.json()
}

export async function fetchGematria(value: number): Promise<GematriaResponse> {
  const res = await fetch(`/api/gematria?value=${value}`)
  return res.json()
}

export async function fetchEnglishSearch(query: string): Promise<EnglishResponse> {
  const res = await fetch(`/api/english?words=${encodeURIComponent(query)}`)
  return res.json()
}
