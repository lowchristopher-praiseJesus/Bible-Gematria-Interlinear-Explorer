import type { ChatMessage } from '@/components/chatbot/types'

export type SessionMode = 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform'

export interface ModeParams {
  plan?: 'chronological' | 'canonical'
  dayIndex?: number
  completedDays?: number[]
  parableId?: string
  topicId?: string
  reference?: string
}

export interface ArtifactLink {
  type: 'interlinear' | 'strongs' | 'book_context' | 'gematria' | 'english_search'
  label: string
  params: Record<string, unknown>
}

export interface SessionMessage extends ChatMessage {
  artifacts?: ArtifactLink[]
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