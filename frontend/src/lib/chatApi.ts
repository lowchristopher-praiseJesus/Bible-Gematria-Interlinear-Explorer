import { usfmToFullRef } from './usfm'
import type {
  BookContextResponse,
  ChapterResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
} from '@/types/api'
import type { ArtifactLink, ModeParams, PhaseResult } from '@/types/session'
import type { Trace } from '@/types/trace'

const CHAT_API = '/api/bible-chat'

interface ChatPayload {
  message: string
  history?: { role: 'user' | 'assistant'; text: string }[]
  page_context?: string
  mode?: string
  mode_params?: ModeParams
  /** Voice mode's BYOK override: generate this turn's answer with the
   * caller's own OpenAI key instead of the server's default model. Only
   * `use_openai_llm` travels in the body — the key itself is sent
   * separately as the X-OpenAI-Key header by postChatStream() so it never
   * sits in a JSON payload a trace/log could capture. */
  use_openai_llm?: boolean
}

/**
 * Translate the camelCase ModeParams session model into the snake_case
 * keys the FastAPI backend expects on the wire
 * (dayIndex -> day_index, completedDays -> completed_days,
 *  parableId -> parable_id, seriesId -> series_id, conceptSlug -> concept_slug,
 *  rotationSeed -> rotation_seed, rotationCursor -> rotation_cursor,
 *  runDigest -> run_digest, scopeChapter -> scope_chapter,
 *  explainPhases -> explain_phases, characterId -> character_id,
 *  storyThemes -> story_themes, storyDigest -> story_digest, storySelectedThemeIds -> story_selected_theme_ids,
 *  storyAgeRange -> story_age_range, storySourceMessages -> source_messages).
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
      case 'rotationSeed':
        out.rotation_seed = value
        break
      case 'rotationCursor':
        out.rotation_cursor = value
        break
      case 'runDigest':
        out.run_digest = value
        break
      case 'scopeChapter':
        out.scope_chapter = value
        break
      case 'characterId':
        out.character_id = value
        break
      case 'surprise':
        out.surprise = value
        break
      case 'explainPhases':
        out.explain_phases = value
        break
      case 'storyThemes':
        out.story_themes = value
        break
      case 'storyDigest':
        out.story_digest = value
        break
      case 'storySelectedThemeIds':
        out.story_selected_theme_ids = value
        break
      case 'storyAgeRange':
        out.story_age_range = value
        break
      case 'storySourceMessages':
        out.source_messages = value
        break
      default:
        out[key] = value
    }
  }
  return out
}

export interface ChatApiResponse {
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

interface ChatStreamHandlers {
  /** Called with the accumulated answer text so far, each time the AI
   * fallback emits another token chunk. Never called at all for a turn
   * that's answered without an LLM generation step (a deterministic
   * match, a mode primer, Topical Study's wiki Q&A) — those arrive
   * complete in the resolved result, same as postChat(). */
  onChunk?: (text: string) => void
  /** Called once per completed phase of a Hermeneutics run, in order.
   * Never called for any other mode. */
  onPhase?: (phase: PhaseResult) => void
  /** Called once, before any phase, with the Hermeneutics run's resolved
   * passage reference. Never called for any other mode. */
  onPassage?: (reference: string) => void
}

/**
 * Same contract as postChat(), but reads `/chat/stream`'s SSE body instead
 * of waiting for one buffered JSON response. The backend emits a `stream`
 * event per token chunk (only while the AI fallback is actually
 * generating), then exactly one `final` event carrying the complete
 * ChatResponse-shaped payload, then a terminal `trace` event — see
 * chatbot/api.py's _stream_chat_response(). Streaming keeps bytes flowing
 * for the entire wait instead of one multi-minute silence, so no proxy or
 * browser idle-connection timeout can drop it mid-answer.
 */
export async function postChatStream(
  payload: ChatPayload,
  handlers: ChatStreamHandlers = {},
  /** Present only for a voice-mode turn with the OpenAI-LLM setting on;
   * sent as the X-OpenAI-Key header (never the JSON body) matching how
   * the voice-session handshake itself avoids logging the key. */
  openAiApiKey?: string
): Promise<ChatApiResponse> {
  const { mode_params, ...rest } = payload
  const res = await fetch(`${CHAT_API}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(payload.use_openai_llm && openAiApiKey ? { 'X-OpenAI-Key': openAiApiKey } : {}),
    },
    body: JSON.stringify({
      ...rest,
      ...(mode_params && { mode_params: toWireModeParams(mode_params) }),
    }),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`)
  }
  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('Streaming response has no readable body')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let result: ChatApiResponse | undefined
  let trace: Trace | undefined

  function handleFrame(frame: string) {
    if (!frame.startsWith('data: ')) return
    let event: Record<string, unknown>
    try {
      event = JSON.parse(frame.slice('data: '.length))
    } catch {
      return
    }
    if (event.type === 'stream') {
      handlers.onChunk?.(String(event.text ?? ''))
    } else if (event.type === 'phase') {
      handlers.onPhase?.(event.phase as PhaseResult)
    } else if (event.type === 'passage') {
      handlers.onPassage?.(String(event.reference ?? ''))
    } else if (event.type === 'final') {
      result = event.result as ChatApiResponse
    } else if (event.type === 'trace') {
      trace = event.trace as Trace
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) handleFrame(frame.trim())
  }
  if (buffer.trim()) handleFrame(buffer.trim())

  if (!result) {
    throw new Error('Stream ended without a response')
  }
  return trace ? { ...result, trace } : result
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

export interface DevotionalAudioResponse {
  audio_url: string
}

/**
 * Generate (or reuse a cached) Neural2 MP3 for a devotional's full text.
 * The backend's `audio_url` is relative to the chatbot service root (e.g.
 * '/devotional-audio/<hash>.mp3'); this resolves it against CHAT_API so
 * the result is directly usable as an <audio src>.
 */
export async function postDevotionalAudio(reference: string, text: string): Promise<DevotionalAudioResponse> {
  const res = await fetch(`${CHAT_API}/devotional/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference, text }),
  })
  const json = await parseJsonResponse<DevotionalAudioResponse>(res)
  return { audio_url: `${CHAT_API}${json.audio_url}` }
}

export async function fetchGematria(value: number): Promise<GematriaResponse> {
  const res = await fetch(`/api/gematria?value=${value}`)
  return parseJsonResponse<GematriaResponse>(res)
}

export async function fetchEnglishSearch(query: string): Promise<EnglishResponse> {
  const res = await fetch(`/api/english?words=${encodeURIComponent(query)}`)
  return parseJsonResponse<EnglishResponse>(res)
}

