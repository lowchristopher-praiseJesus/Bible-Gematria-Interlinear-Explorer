import { useState } from 'react'
import { MODE_LABELS, useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { describeSession } from '@/lib/sessionDescription'
import { formatSessionTimestamp } from '@/lib/formatTimestamp'
import type { Session, SessionMode } from '@/types/session'

interface Props {
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
}

// Fixed order (matching the mode picker) rather than sorting sections by
// recency — the point is a stable place to find "all my Parable Study
// chats", not a shuffling list of headers.
const MODE_ORDER: SessionMode[] = ['reading_plan', 'parable', 'verse', 'topic', 'freeform']

const MODE_ICONS: Record<SessionMode, string> = {
  reading_plan: '📅',
  parable: '🌿',
  verse: '✨',
  topic: '🔎',
  freeform: '💬',
}

function groupByMode(sessions: Session[]): Partial<Record<SessionMode, Session[]>> {
  const groups: Partial<Record<SessionMode, Session[]>> = {}
  for (const session of sessions) {
    ;(groups[session.mode] ??= []).push(session)
  }
  for (const group of Object.values(groups)) {
    group?.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  return groups
}

export function SessionsPane({ activeSessionId, onSelectSession, onNewSession }: Props) {
  const sessions = useSessionsStore((s) => s.sessions)
  const deleteSession = useSessionsStore((s) => s.deleteSession)
  const grouped = groupByMode(Object.values(sessions))
  // Every category starts expanded; collapsing one just hides its rows —
  // nothing here needs to survive a reload, so plain component state is
  // enough.
  const [collapsed, setCollapsed] = useState<Partial<Record<SessionMode, boolean>>>({})

  function toggleMode(mode: SessionMode) {
    setCollapsed((prev) => ({ ...prev, [mode]: !prev[mode] }))
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[var(--color-theme-border)]">
        <button
          onClick={onNewSession}
          className="w-full text-sm px-3 py-2 rounded bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]"
        >
          + New session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {MODE_ORDER.filter((mode) => grouped[mode]?.length).map((mode) => {
          const isCollapsed = !!collapsed[mode]
          return (
            <div key={mode}>
              <button
                type="button"
                onClick={() => toggleMode(mode)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center gap-1 px-3 pt-3 pb-1 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide hover:text-[var(--color-text-primary)]"
              >
                <span aria-hidden="true" className="text-[10px] shrink-0">{isCollapsed ? '▸' : '▾'}</span>{' '}
                <span aria-hidden="true">{MODE_ICONS[mode]}</span> <span className="truncate">{MODE_LABELS[mode]}</span>
                <span className="ml-auto normal-case font-normal text-[10px] text-[var(--color-text-secondary)]">
                  ({grouped[mode]!.length})
                </span>
              </button>
              {!isCollapsed &&
                grouped[mode]!.map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-start justify-between gap-2 px-3 py-2 cursor-pointer text-sm ${
                      session.id === activeSessionId ? 'bg-[var(--color-surface-alt)] font-medium' : 'hover:bg-[var(--color-surface-alt)]'
                    }`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="min-w-0 flex flex-col">
                      <span className="truncate">{describeSession(session)}</span>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {formatSessionTimestamp(session.createdAt)}
                      </span>
                    </div>
                    <button
                      aria-label="Delete session"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(session.id)
                        if (session.id === activeSessionId) {
                          useArtifactStore.getState().close()
                        }
                      }}
                      className="text-[var(--color-text-secondary)] hover:text-red-600 shrink-0"
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
