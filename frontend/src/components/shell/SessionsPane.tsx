import { useState } from 'react'
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  Sprout,
  StickyNote,
  X,
  type LucideIcon,
} from 'lucide-react'
import { MODE_LABELS, useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { describeSession } from '@/lib/sessionDescription'
import { filterSessions, splitHighlight } from '@/lib/sessionSearch'
import { noteLabel } from '@/lib/noteLabel'
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

const MODE_ICONS: Record<SessionMode, LucideIcon> = {
  reading_plan: CalendarDays,
  parable: Sprout,
  verse: Sparkles,
  topic: Search,
  freeform: MessageCircle,
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
  // Every category starts expanded; collapsing one just hides its rows —
  // nothing here needs to survive a reload, so plain component state is
  // enough. The search box is the same: transient, reset on reload.
  const [collapsed, setCollapsed] = useState<Partial<Record<SessionMode, boolean>>>({})
  const [query, setQuery] = useState('')

  const searching = query.trim().length > 0
  const filtered = filterSessions(Object.values(sessions), query)
  const grouped = groupByMode(filtered)

  function toggleMode(mode: SessionMode) {
    setCollapsed((prev) => ({ ...prev, [mode]: !prev[mode] }))
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[var(--color-theme-border)] flex flex-col gap-2">
        {/* On mobile the top bar's "+ New" is the new-chat entry point, so
            this button only shows on the desktop sidebar. */}
        <button
          onClick={onNewSession}
          className="w-full hidden lg:inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New session
        </button>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-secondary)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search conversations"
            placeholder="Search conversations"
            className="w-full rounded-md border border-[var(--color-theme-border)] bg-[var(--color-surface)] py-1.5 pl-8 pr-7 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
          />
          {searching && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {searching && filtered.length === 0 && (
          <p className="px-3 py-4 text-sm text-[var(--color-text-secondary)]">
            No conversations match “{query.trim()}”.
          </p>
        )}
        {MODE_ORDER.filter((mode) => grouped[mode]?.length).map((mode) => {
          // While searching, force sections open so matches aren't hidden
          // inside a group the user happened to have collapsed.
          const isCollapsed = !searching && !!collapsed[mode]
          return (
            <div key={mode}>
              <button
                type="button"
                onClick={() => toggleMode(mode)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center gap-1.5 px-3 pt-3 pb-1 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide hover:text-[var(--color-text-primary)] transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                {(() => {
                  const Icon = MODE_ICONS[mode]
                  return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                })()}
                <span className="truncate">{MODE_LABELS[mode]}</span>
                <span className="ml-auto normal-case font-normal text-[10px] text-[var(--color-text-secondary)]">
                  ({grouped[mode]!.length})
                </span>
              </button>
              {!isCollapsed &&
                grouped[mode]!.map((session) => (
                  <div key={session.id}>
                    <div
                      className={`group flex items-start justify-between gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                        session.id === activeSessionId ? 'bg-[var(--color-surface-alt)] font-medium' : 'hover:bg-[var(--color-surface-alt)]'
                      }`}
                      onClick={() => onSelectSession(session.id)}
                    >
                      <div className="min-w-0 flex flex-col">
                        <span className="truncate">
                          {searching
                            ? splitHighlight(describeSession(session), query).map((seg, i) =>
                                seg.hit ? (
                                  <mark
                                    key={i}
                                    className="rounded-sm bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]"
                                  >
                                    {seg.text}
                                  </mark>
                                ) : (
                                  <span key={i}>{seg.text}</span>
                                )
                              )
                            : describeSession(session)}
                        </span>
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
                        className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] opacity-40 transition-opacity hover:bg-[var(--color-surface-alt)] hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {session.notes.map((note) => (
                      <button
                        key={note.id}
                        title={noteLabel(note)}
                        onClick={() => {
                          if (session.id !== activeSessionId) onSelectSession(session.id)
                          useArtifactStore.getState().openNote(session.id, note.id)
                        }}
                        className="w-full flex flex-col items-start gap-0.5 pl-9 pr-3 py-1.5 text-left text-xs hover:bg-[var(--color-surface-alt)] transition-colors"
                      >
                        <span className="flex items-center gap-1.5 max-w-full">
                          <StickyNote className="h-3 w-3 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                          <span className="truncate">{noteLabel(note)}</span>
                        </span>
                        <span className="pl-[1.125rem] text-[10px] text-[var(--color-text-secondary)]">
                          {formatSessionTimestamp(note.createdAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
