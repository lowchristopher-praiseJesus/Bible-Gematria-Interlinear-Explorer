import { usfmToFullRef } from './usfm'
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
} from '@/types/api'

const CHAT_API = '/api/bible-chat'

interface ChatPayload {
  message: string
  history?: { role: 'user' | 'assistant'; text: string }[]
  page_context?: string
  mode?: string
  mode_params?: Record<string, unknown>
}

interface ChatApiResponse {
  type: string
  message: string
  data?: Record<string, unknown> | null
  route?: string
  follow_up_questions?: string[]
  artifacts?: { type: string; label: string; params: Record<string, unknown> }[]
}

export async function postChat(payload: ChatPayload): Promise<ChatApiResponse> {
  const res = await fetch(`${CHAT_API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
