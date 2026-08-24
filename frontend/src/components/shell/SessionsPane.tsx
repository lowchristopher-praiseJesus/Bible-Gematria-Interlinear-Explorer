import { useSessionsStore } from '@/store/useSessionsStore'

interface Props {
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
}

export function SessionsPane({ activeSessionId, onSelectSession, onNewSession }: Props) {
  const listSessions = useSessionsStore((s) => s.listSessions)
  const deleteSession = useSessionsStore((s) => s.deleteSession)
  const sessions = listSessions()

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
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`flex items-center justify-between px-3 py-2 cursor-pointer text-sm ${
              session.id === activeSessionId ? 'bg-[var(--color-surface-alt)] font-medium' : 'hover:bg-[var(--color-surface-alt)]'
            }`}
            onClick={() => onSelectSession(session.id)}
          >
            <span className="truncate">{session.title}</span>
            <button
              aria-label="Delete session"
              onClick={(e) => {
                e.stopPropagation()
                deleteSession(session.id)
              }}
              className="text-[var(--color-text-secondary)] hover:text-red-600 shrink-0 ml-2"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
