import { useEffect, useState } from 'react'
import { postChat } from '@/lib/chatApi'
import { listParables, listTopics, type ParableEntry, type TopicEntry } from '@/lib/modeData'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { ModeParams, SessionMessage, SessionMode } from '@/types/session'

interface Props {
  onSessionStarted: (sessionId: string) => void
}

type Screen = 'root' | 'reading_plan' | 'parable' | 'topic' | 'verse'

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function ModePickerScreen({ onSessionStarted }: Props) {
  const [screen, setScreen] = useState<Screen>('root')
  const [parables, setParables] = useState<ParableEntry[] | null>(null)
  const [parablesError, setParablesError] = useState<string | null>(null)
  const [topics, setTopics] = useState<TopicEntry[] | null>(null)
  const [topicsError, setTopicsError] = useState<string | null>(null)
  const [verseRef, setVerseRef] = useState('')
  const createSession = useSessionsStore((s) => s.createSession)
  const appendMessage = useSessionsStore((s) => s.appendMessage)

  // Fetching directly in the render body (the previous approach) double-fires
  // under StrictMode and has no way to surface a failed request other than
  // leaving the screen stuck on "Loading…" forever. Drive both fetches from
  // an effect instead, with explicit error state and a retry affordance.
  useEffect(() => {
    if (screen !== 'parable' || parables) return
    let cancelled = false
    listParables()
      .then((result) => {
        if (!cancelled) setParables(result)
      })
      .catch((err) => {
        if (!cancelled) setParablesError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [screen, parables])

  useEffect(() => {
    if (screen !== 'topic' || topics) return
    let cancelled = false
    listTopics()
      .then((result) => {
        if (!cancelled) setTopics(result)
      })
      .catch((err) => {
        if (!cancelled) setTopicsError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [screen, topics])

  async function startSession(mode: SessionMode, modeParams: ModeParams) {
    const session = createSession(mode, modeParams)
    try {
      const response = await postChat({ message: '', mode, mode_params: { ...modeParams } })
      const message: SessionMessage = {
        id: genId(),
        role: 'assistant',
        text: response.message,
        type: response.type,
        data: response.data ?? undefined,
        artifacts: response.artifacts,
        followUpQuestions: response.follow_up_questions,
      }
      appendMessage(session.id, message)
    } catch (err) {
      appendMessage(session.id, {
        id: genId(),
        role: 'assistant',
        text: 'Sorry, something went wrong: ' + errorMessage(err),
      })
    }
    onSessionStarted(session.id)
  }

  if (screen === 'reading_plan') {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold">Bible in a Year</h2>
        <button
          className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
          onClick={() => startSession('reading_plan', { plan: 'chronological', dayIndex: 0, completedDays: [] })}
        >
          Chronological
        </button>
        <button
          className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
          onClick={() => startSession('reading_plan', { plan: 'canonical', dayIndex: 0, completedDays: [] })}
        >
          Canonical (book order)
        </button>
      </div>
    )
  }

  if (screen === 'parable') {
    if (parablesError) {
      return (
        <div className="flex flex-col gap-2 p-6">
          <div className="text-sm text-red-600">Failed to load parables: {parablesError}</div>
          <button
            className="self-start text-xs px-3 py-1.5 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
            onClick={() => {
              setParablesError(null)
              setParables(null)
            }}
          >
            Retry
          </button>
        </div>
      )
    }
    if (!parables) {
      return <div className="p-6 text-[var(--color-text-secondary)]">Loading parables…</div>
    }
    return (
      <div className="flex flex-col gap-2 p-6 max-h-[70vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-2">Parable Study</h2>
        {parables.map((p) => (
          <button
            key={p.id}
            className="text-left px-4 py-2 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
            onClick={() => startSession('parable', { parableId: p.id })}
          >
            {p.name} <span className="text-[var(--color-text-secondary)] text-sm">({p.reference})</span>
          </button>
        ))}
      </div>
    )
  }

  if (screen === 'topic') {
    if (topicsError) {
      return (
        <div className="flex flex-col gap-2 p-6">
          <div className="text-sm text-red-600">Failed to load topics: {topicsError}</div>
          <button
            className="self-start text-xs px-3 py-1.5 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
            onClick={() => {
              setTopicsError(null)
              setTopics(null)
            }}
          >
            Retry
          </button>
        </div>
      )
    }
    if (!topics) {
      return <div className="p-6 text-[var(--color-text-secondary)]">Loading topics…</div>
    }
    return (
      <div className="flex flex-col gap-2 p-6 max-h-[70vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-2">Topical Study</h2>
        {topics.map((t) => (
          <button
            key={t.id}
            className="text-left px-4 py-2 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
            onClick={() => startSession('topic', { topicId: t.id })}
          >
            {t.name}
          </button>
        ))}
      </div>
    )
  }

  if (screen === 'verse') {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold">Verse of the Day</h2>
        <button
          className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
          onClick={() => startSession('verse', {})}
        >
          Surprise me
        </button>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (verseRef.trim()) startSession('verse', { reference: verseRef.trim() })
          }}
        >
          <input
            value={verseRef}
            onChange={(e) => setVerseRef(e.target.value)}
            placeholder="e.g. John 3:16"
            className="flex-1 border border-[var(--color-theme-border)] rounded px-3 py-2"
          />
          <button type="submit" className="px-4 py-2 rounded bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]">
            Go
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-semibold">Start a new session</h2>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => setScreen('reading_plan')}
      >
        Bible in a Year
      </button>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => setScreen('parable')}
      >
        Parable Study
      </button>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => setScreen('verse')}
      >
        Verse of the Day
      </button>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => setScreen('topic')}
      >
        Topical Study
      </button>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => startSession('freeform', {})}
      >
        Ask Anything
      </button>
    </div>
  )
}
