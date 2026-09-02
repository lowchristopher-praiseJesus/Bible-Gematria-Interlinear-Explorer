import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModeParams, Session, SessionMessage, SessionMode } from '@/types/session'

interface SessionsState {
  sessions: Record<string, Session>
  activeSessionId: string | null
  createSession: (mode: SessionMode, modeParams: ModeParams) => Session
  setActiveSessionId: (id: string | null) => void
  appendMessage: (sessionId: string, message: SessionMessage) => void
  updateMessage: (sessionId: string, messageId: string, patch: Partial<SessionMessage>) => void
  updateModeParams: (sessionId: string, patch: Partial<ModeParams>) => void
  deleteSession: (sessionId: string) => void
  /** Wipes every chat, across every mode — the "clear all history" action
   * in Settings. Unlike `deleteSession`, there's no single id to target. */
  clearAllSessions: () => void
  listSessions: () => Session[]
  /** Drops the message at `fromMessageId` and everything after it — used to
   * discard a response before regenerating it. */
  truncateMessagesFrom: (sessionId: string, fromMessageId: string) => void
}

export const MODE_LABELS: Record<SessionMode, string> = {
  reading_plan: 'Bible in a Year',
  parable: 'Parable Study',
  verse: 'Verse of the Day',
  topic: 'Topical Study',
  freeform: 'Ask Anything',
}

function deriveTitle(mode: SessionMode, modeParams: ModeParams): string {
  if (mode === 'reading_plan') return `Bible in a Year — ${modeParams.plan === 'canonical' ? 'Canonical' : 'Chronological'}`
  if (mode === 'parable' && modeParams.parableId) return `Parable Study — ${modeParams.parableId.replace(/_/g, ' ')}`
  if (mode === 'topic' && modeParams.conceptSlug) return `Topical Study — ${modeParams.conceptSlug.replace(/-/g, ' ')}`
  return MODE_LABELS[mode]
}

let idCounter = 0
function genId(): string {
  return `session-${Date.now()}-${++idCounter}`
}

interface PersistedSessionsShape {
  sessions?: unknown
  activeSessionId?: unknown
}

/**
 * A persisted session is only usable if it has the fields the rest of
 * the app assumes are always present. Anything else (an old shape, a
 * hand-edited localStorage blob, a partially-written entry from a
 * crashed tab) gets dropped rather than crashing ChatPane on render.
 */
function isValidSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.mode === 'string' &&
    Array.isArray(candidate.messages)
  )
}

function sanitizeSessions(sessions: unknown): Record<string, Session> {
  if (!sessions || typeof sessions !== 'object') return {}
  const out: Record<string, Session> = {}
  for (const [id, value] of Object.entries(sessions as Record<string, unknown>)) {
    if (isValidSession(value)) out[id] = value
  }
  return out
}

function sanitizePersistedState(
  persistedState: unknown
): Pick<SessionsState, 'sessions' | 'activeSessionId'> {
  const state = (persistedState ?? {}) as PersistedSessionsShape
  const sessions = sanitizeSessions(state.sessions)
  const activeSessionId =
    typeof state.activeSessionId === 'string' && sessions[state.activeSessionId]
      ? state.activeSessionId
      : null
  return { sessions, activeSessionId }
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

      updateMessage: (sessionId, messageId, patch) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                messages: existing.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
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

      clearAllSessions: () => set({ sessions: {}, activeSessionId: null }),

      listSessions: () => Object.values(get().sessions).sort((a, b) => b.updatedAt - a.updatedAt),

      truncateMessagesFrom: (sessionId, fromMessageId) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          const idx = existing.messages.findIndex((m) => m.id === fromMessageId)
          if (idx === -1) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...existing, messages: existing.messages.slice(0, idx) },
            },
          }
        }),
    }),
    {
      name: 'bible-explorer-sessions',
      version: 2,
      // `migrate` only runs when the persisted version differs from the
      // one above, so it alone can't catch corruption written under the
      // current version (the actual incident this defends against: a
      // response bug wrote `text: undefined`, which JSON.stringify then
      // silently dropped on the next persist). `merge` runs on every
      // hydration regardless of version, so sanitize there too.
      migrate: (persistedState) => sanitizePersistedState(persistedState) as SessionsState,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedState(persistedState),
      }),
    }
  )
)