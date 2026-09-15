import type { ChatMessage } from '@/components/chatbot/types'
import type { Trace } from '@/types/trace'

export type SessionMode = 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform' | 'devotional' | 'socratic'

export interface ModeParams {
  plan?: 'chronological' | 'canonical'
  dayIndex?: number
  completedDays?: number[]
  parableId?: string
  seriesId?: string
  conceptSlug?: string
  reference?: string
  /** Devotional mode: whose verse — one the user typed (a reference or a
   * theme), or one the system/LLM picks. */
  source?: 'user' | 'system'
  /** Devotional mode: set once a devotional has been delivered, so later
   * messages in the session route as ordinary chat instead of
   * regenerating. */
  delivered?: boolean
  /** Devotional "Pick one for me": the (seed, cursor) slot this session's
   *  rotation pick used. Persisted so a retry after an errored turn reuses
   *  the same slot instead of skipping a verse. */
  rotationSeed?: number
  rotationCursor?: number
}

export interface ArtifactLink {
  type: 'interlinear' | 'chapter' | 'strongs' | 'book_context' | 'gematria' | 'english_search' | 'devotional'
  label: string
  params: Record<string, unknown>
}

/** Params for a `devotional`-type ArtifactLink — the finished devotional
 * text travels inline (no fetch when the pane opens it). */
export interface DevotionalArtifactParams {
  reference: string
  text: string
}

/** One clickable option in a "choice" prompt — e.g. Chronological vs
 * Canonical for a reading plan, or a specific parable/topic. Picking one
 * merges `modeParams` into the session and finalizes it via the primer. */
export interface MessageChoice {
  label: string
  modeParams: ModeParams
}

export interface SessionMessage extends ChatMessage {
  artifacts?: ArtifactLink[]
  trace?: Trace
  /** Present on an assistant message that's asking the user to pick a
   * sub-option before the session can proceed (e.g. which reading plan). */
  choicesStatus?: 'loading' | 'ready' | 'error'
  choices?: MessageChoice[]
  choicesError?: string
  /** Label of the choice the user picked, once resolved — kept so the
   * pills can be re-rendered as answered instead of disappearing. */
  resolvedChoiceLabel?: string
}

export interface Note {
  id: string
  createdAt: number
  updatedAt: number
  /** Optional title, shown in note lists in place of the derived label. */
  title?: string
  /** Rich text content as sanitized HTML (produced by the Tiptap editor).
   * Older notes predate rich text and hold plain text here — Tiptap
   * renders plain text as a single paragraph, so both forms display fine. */
  body: string
}

export interface ImportedMeta {
  /** The share token this session was imported from. */
  token: string
  /** When the import happened (epoch ms). */
  importedAt: number
  /** Server `shared_at` timestamp for the original share, if known. */
  sharedAt?: string
}

export interface Session {
  id: string
  createdAt: number
  updatedAt: number
  mode: SessionMode
  modeParams: ModeParams
  title: string
  messages: SessionMessage[]
  notes: Note[]
  /** Present only on a session brought in via a share link. Its `mode`
   * stays the original mode; this marker is what the sidebar groups on. */
  imported?: ImportedMeta
}

/** The payload carried by a share link: a session reduced to what the
 * recipient needs to re-create it locally. Built by `shareApi.createShare`,
 * stored server-side, returned by `shareApi.fetchShare`. */
export interface SharePayload {
  mode: SessionMode
  modeParams: ModeParams
  title: string
  messages: SessionMessage[]
  notes: Note[]
}