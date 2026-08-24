import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModeParams, Session, SessionMessage, SessionMode } from '@/types/session'

interface SessionsState {
  sessions: Record<string, Session>
  activeSessionId: string | null
  createSession: (mode: SessionMode, modeParams: ModeParams) => Session
  setActiveSessionId: (id: string | null) => void
  appendMessage: (sessionId: string, message: SessionMessage) => void
  updateModeParams: (sessionId: string, patch: Partial<ModeParams>) => void
  deleteSession: (sessionId: string) => void
  listSessions: () => Session[]
}

const MODE_LABELS: Record<SessionMode, string> = {
  reading_plan: 'Bible in a Year',
  parable: 'Parable Study',
  verse: 'Verse of the Day',
  topic: 'Topical Study',
  freeform: 'Ask Anything',
}

function deriveTitle(mode: SessionMode, modeParams: ModeParams): string {
  if (mode === 'reading_plan') return `Bible in a Year — ${modeParams.plan === 'canonical' ? 'Canonical' : 'Chronological'}`
  if (mode === 'parable' && modeParams.parableId) return `Parable Study — ${modeParams.parableId.replace(/_/g, ' ')}`
  if (mode === 'topic' && modeParams.topicId) return `Topical Study — ${modeParams.topicId.replace(/_/g, ' ')}`
  return MODE_LABELS[mode]
}

let idCounter = 0
function genId(): string {
  return `session-${Date.now()}-${++idCounter}`
}

export const useSessionsStore = create<SessionsState>()(
  persist(
    (set, get) => ({
      sessions: {},
      activeSessionId: null,

      createSession: (mode, modeParams) => {
        const now = Date.now()
        const session: Session = {
          id: genId(),
          createdAt: now,
          updatedAt: now,
          mode,
          modeParams,
          title: deriveTitle(mode, modeParams),
          messages: [],
        }
        set((state) => ({
          sessions: { ...state.sessions, [session.id]: session },
          activeSessionId: session.id,
        }))
        return session
      },

      setActiveSessionId: (id) => set({ activeSessionId: id }),

      appendMessage: (sessionId, message) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                messages: [...existing.messages, message],
                updatedAt: Date.now(),
              },
            },
          }
        }),

      updateModeParams: (sessionId, patch) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                modeParams: { ...existing.modeParams, ...patch },
                updatedAt: Date.now(),
              },
            },
          }
        }),

      deleteSession: (sessionId) =>
        set((state) => {
          const { [sessionId]: _removed, ...rest } = state.sessions
          return {
            sessions: rest,
            activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
          }
        }),

      listSessions: () => Object.values(get().sessions).sort((a, b) => b.updatedAt - a.updatedAt),
    }),
    { name: 'bible-explorer-sessions' }
  )
)