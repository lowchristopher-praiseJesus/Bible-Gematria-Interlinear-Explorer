import { ArrowLeft } from 'lucide-react'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { Session } from '@/types/session'

interface Props {
  onPick: (session: Session) => void
  onBack: () => void
}

/**
 * Lists past conversations eligible to be turned into a story: at least
 * one message, and not itself a Tell a Story session (a story session has
 * nothing further to derive themes from).
 */
export function SessionPickerScreen({ onPick, onBack }: Props) {
  const listSessions = useSessionsStore((s) => s.listSessions)
  const sessions = listSessions().filter((s) => s.mode !== 'story' && s.messages.length > 0)

  return (
    <div className="h-full flex flex-col items-center px-6 py-8 overflow-y-auto">
      <div className="w-full max-w-lg flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-theme-accent)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
          </button>
          <h1 className="text-lg font-semibold">Choose a Conversation</h1>
        </div>

        {sessions.length === 0 && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            You don't have any conversations yet to turn into a story — start one first.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className="text-left rounded-xl border border-[var(--color-theme-border)] bg-[var(--color-surface)] px-4 py-2.5 hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)] transition-colors"
            >
              <span className="block text-sm font-medium">{s.title}</span>
              <span className="block text-xs text-[var(--color-text-secondary)]">
                {s.messages.length} message{s.messages.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
