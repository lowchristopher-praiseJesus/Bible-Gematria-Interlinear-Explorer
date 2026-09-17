import type { ChatMessage } from '@/components/chatbot/types'
import type { Trace } from '@/types/trace'

export type SessionMode = 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform' | 'devotional' | 'socratic' | 'hermeneutics'

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
  /** Hermeneutics mode: the compact digest of a completed run. Its presence
   * is what makes a later turn a follow-up rather than a fresh run. */
  runDigest?: string
  /** Hermeneutics mode: the chapter a "which part?" narrowing reply asked
   * the user to pick from, kept for one turn so "verses 1-5" resolves
   * against it. */
  scopeChapter?: string
  surprise?: boolean
}

export interface ArtifactLink {
  type: 'interlinear' | 'chapter' | 'strongs' | 'book_context' | 'gematria' | 'english_search' | 'devotional' | 'hermeneutics_report'
  label: string
  params: Record<string, unknown>
}

/** Params for a `devotional`-type ArtifactLink — the finished devotional
 * text travels inline (no fetch when the pane opens it). */
export interface DevotionalArtifactParams {
  reference: string
  text: string
}

/** One completed phase of a Hermeneutics run, delivered by the `phase`
 * SSE event and stored on the assistant message so a reload — or a share —
 * shows the finished run. */
export interface PhaseResult {
  /** 1-8 for a real phase. 0 is the "reading that as X" notice shown when
   * the passage was resolved from a description; it renders as a plain
   * line and never appears in the report. */
  index: number
  title: string
  status: 'running' | 'done' | 'error'
  markdown: string
  /** Phase 1 only: the passage's primary addressee ('jew' | 'gentile' |
   * 'church'), or null when the model omitted its marker line. */
  audience?: string | null
  /** Phase 3 only: who is speaking ('god' | 'prophet' | 'human' |
   * 'adversary'), or null when the marker line was omitted. */
  speaker?: string | null
  /** Phase 4 only: witnesses that resolved and were fetched. */
  citations?: { reference: string; text: string; verified: boolean }[]
  /** Phase 8 only: the three validation-test verdicts. */
  verdicts?: { test: string; passed: boolean; reason?: string }[]
}

/** Params for a `hermeneutics_report` ArtifactLink — the whole report
 * travels inline (no fetch when the pane opens it), as the devotional does. */
export interface HermeneuticsArtifactParams {
  reference: string
  phases: PhaseResult[]
  summary: string
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
  phases?: PhaseResult[]
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