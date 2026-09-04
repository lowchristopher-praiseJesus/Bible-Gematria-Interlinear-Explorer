import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ModeParams, Note, Session, SessionMessage, SessionMode } from '@/types/session'

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
  addNote: (sessionId: string, body: string) => Note | null
  updateNote: (sessionId: string, noteId: string, body: string) => void
  deleteNote: (sessionId: string, noteId: string) => void
}

export const MAX_NOTES_PER_SESSION = 5

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

let noteIdCounter = 0
function genNoteId(): string {
  return `note-${Date.now()}-${++noteIdCounter}`
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

function isValidNote(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.body === 'string'
}

function sanitizeNotes(notes: unknown): Note[] {
  if (!Array.isArray(notes)) return []
  const out: Note[] = []
  for (const value of notes) {
    if (!isValidNote(value)) continue
    const candidate = value as Record<string, unknown>
    out.push({
      id: candidate.id as string,
      body: candidate.body as string,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
    })
    if (out.length === MAX_NOTES_PER_SESSION) break
  }
  return out
}

function sanitizeSessions(sessions: unknown): Record<string, Session> {
  if (!sessions || typeof sessions !== 'object') return {}
  const out: Record<string, Session> = {}
  for (const [id, value] of Object.entries(sessions as Record<string, unknown>)) {
    if (isValidSession(value)) {
      const raw = value as Session & { notes?: unknown }
      out[id] = { ...raw, notes: sanitizeNotes(raw.notes) }
    }
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

type PersistedSessions = Pick<SessionsState, 'sessions' | 'activeSessionId'>

/**
 * `trace` is a per-turn diagnostic blob: every step can carry up to 16 KB
 * of request preview plus 16 KB of response preview (see _MAX_PREVIEW_BYTES
 * in chatbot/trace.py), and there are several steps per turn. It's kept in
 * memory so "Report an issue" can attach the current session's traces, but
 * persisting it on every message in every session is what pushes the store
 * past the localStorage quota. Strip it from the persisted copy only.
 */
function stripPersistHeavyFields(message: SessionMessage): SessionMessage {
  if (!message.trace) return message
  const copy = { ...message }
  delete copy.trace
  return copy
}

function partializeSessions(state: SessionsState): PersistedSessions {
  return {
    activeSessionId: state.activeSessionId,
    sessions: Object.fromEntries(
      Object.entries(state.sessions).map(([id, session]) => [
        id,
        { ...session, messages: session.messages.map(stripPersistHeavyFields) },
      ])
    ),
  }
}

/**
 * localStorage.setItem throws a QuotaExceededError once the serialized store
 * outgrows the browser's storage budget (~5 MB; tighter on mobile Safari).
 * zustand's persist middleware calls setItem with no try/catch, so that
 * throw propagates straight out of appendMessage and surfaces in the chat
 * as "Sorry, something went wrong: The quota has been exceeded." (the
 * sendMessage catch in ChatPane). Guard the write so a full quota instead
 * degrades by evicting the least-recently-updated sessions from the
 * persisted copy — the live in-memory store is untouched until reload.
 */
function isQuotaExceeded(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014)
  )
}

interface PersistEnvelope {
  state?: { sessions?: Record<string, Session>; activeSessionId?: unknown }
  version?: number
}

function setItemWithQuotaGuard(name: string, value: string): void {
  try {
    localStorage.setItem(name, value)
    return
  } catch (err) {
    if (!isQuotaExceeded(err)) throw err
  }

  let envelope: PersistEnvelope
  try {
    envelope = JSON.parse(value) as PersistEnvelope
  } catch {
    console.warn('[sessions] storage quota exceeded; persisted blob unparseable, skipping write')
    return
  }
  const sessions = envelope.state?.sessions
  if (!sessions || Object.keys(sessions).length === 0) {
    console.warn('[sessions] storage quota exceeded; nothing to evict, skipping write')
    return
  }

  // Oldest-updated first, so the conversation in front of the user is the
  // last thing to be dropped.
  const evictionOrder = Object.values(sessions).sort(
    (a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0)
  )
  let evicted = 0
  for (const victim of evictionOrder) {
    delete sessions[victim.id]
    evicted++
    if (envelope.state && envelope.state.activeSessionId === victim.id) {
      envelope.state.activeSessionId = null
    }
    try {
      localStorage.setItem(name, JSON.stringify(envelope))
      console.warn(
        `[sessions] storage quota exceeded; evicted ${evicted} old session(s) from local history`
      )
      return
    } catch (err) {
      if (!isQuotaExceeded(err)) throw err
    }
  }
  console.warn('[sessions] storage quota exceeded; even an empty history did not fit, skipping write')
}

const guardedSessionStorage = createJSONStorage<PersistedSessions>(() => ({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => setItemWithQuotaGuard(key, value),
  removeItem: (key) => localStorage.removeItem(key),
}))

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
          notes: [],
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

      addNote: (sessionId, body) => {
        const existing = get().sessions[sessionId]
        if (!existing || existing.notes.length >= MAX_NOTES_PER_SESSION) return null
        const now = Date.now()
        const note: Note = { id: genNoteId(), createdAt: now, updatedAt: now, body }
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: { ...existing, notes: [...existing.notes, note] },
          },
        }))
        return note
      },

      updateNote: (sessionId, noteId, body) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                notes: existing.notes.map((n) =>
                  n.id === noteId ? { ...n, body, updatedAt: Date.now() } : n
                ),
              },
            },
          }
        }),

      deleteNote: (sessionId, noteId) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...existing, notes: existing.notes.filter((n) => n.id !== noteId) },
            },
          }
        }),
    }),
    {
      name: 'bible-explorer-sessions',
      version: 3,
      storage: guardedSessionStorage,
      // Keep `trace` blobs out of localStorage (they're the bulk of the
      // store's growth); they stay in memory for the current session.
      partialize: partializeSessions,
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