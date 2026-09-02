import type { ChatMessage } from '@/components/chatbot/types'
import type { Trace } from '@/types/trace'

export type SessionMode = 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform'

export interface ModeParams {
  plan?: 'chronological' | 'canonical'
  dayIndex?: number
  completedDays?: number[]
  parableId?: string
  seriesId?: string
  conceptSlug?: string
  reference?: string
}

export interface ArtifactLink {
  type: 'interlinear' | 'chapter' | 'strongs' | 'book_context' | 'gematria' | 'english_search'
  label: string
  params: Record<string, unknown>
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

export interface Session {
  id: string
  createdAt: number
  updatedAt: number
  mode: SessionMode
  modeParams: ModeParams
  title: string
  messages: SessionMessage[]
}