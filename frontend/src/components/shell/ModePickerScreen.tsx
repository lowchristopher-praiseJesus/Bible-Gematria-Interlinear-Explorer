import { useState } from 'react'
import { postChat } from '@/lib/chatApi'
import { listParables, listStudyWikis } from '@/lib/modeData'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useReadingPlanStore } from '@/store/useReadingPlanStore'
import type { MessageChoice, ModeParams, SessionMessage, SessionMode } from '@/types/session'

interface Props {
  onSessionStarted: (sessionId: string) => void
}

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const STARTER_BUBBLE =
  'flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-full border border-[var(--color-theme-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)] transition-colors'

export function ModePickerScreen({ onSessionStarted }: Props) {
  const [askInput, setAskInput] = useState('')
  const [asking, setAsking] = useState(false)
  const createSession = useSessionsStore((s) => s.createSession)
  const appendMessage = useSessionsStore((s) => s.appendMessage)
  const updateMessage = useSessionsStore((s) => s.updateMessage)
  const readingPlanProgress = useReadingPlanStore((s) => s.progress)

  // A starter that already knows what it needs (no sub-choice) starts the
  // session and fetches its first real response immediately.
  async function startSession(mode: SessionMode, userLabel: string, modeParams: ModeParams) {
    const session = createSession(mode, modeParams)
    appendMessage(session.id, { id: genId(), role: 'user', text: userLabel })
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

  // A starter whose sub-choice is fixed and known up front (Bible in a
  // Year, Verse of the Day) — posts the choices as clickable pills inside
  // the assistant's reply instead of a separate picker screen.
  function startWithChoices(mode: SessionMode, userLabel: string, promptText: string, choices: MessageChoice[]) {
    const session = createSession(mode, {})
    appendMessage(session.id, { id: genId(), role: 'user', text: userLabel })
    appendMessage(session.id, { id: genId(), role: 'assistant', text: promptText, choicesStatus: 'ready', choices })
    onSessionStarted(session.id)
  }

  // A starter whose choices have to be fetched (Parable Study, Topical
  // Study) — posts a loading prompt immediately, then fills the pills in
  // once the list arrives (or shows a retryable error).
  async function startWithFetchedChoices(
    mode: SessionMode,
    userLabel: string,
    promptText: string,
    fetchChoices: () => Promise<MessageChoice[]>
  ) {
    const session = createSession(mode, {})
    appendMessage(session.id, { id: genId(), role: 'user', text: userLabel })
    const promptId = genId()
    appendMessage(session.id, { id: promptId, role: 'assistant', text: promptText, choicesStatus: 'loading' })
    onSessionStarted(session.id)
    try {
      const choices = await fetchChoices()
      updateMessage(session.id, promptId, { choicesStatus: 'ready', choices })
    } catch (err) {
      updateMessage(session.id, promptId, { choicesStatus: 'error', choicesError: errorMessage(err) })
    }
  }

  async function askDirectly(text: string) {
    const trimmed = text.trim()
    if (!trimmed || asking) return
    setAsking(true)
    const session = createSession('freeform', {})
    appendMessage(session.id, { id: genId(), role: 'user', text: trimmed })
    try {
      const response = await postChat({ message: trimmed, mode: 'freeform', mode_params: {} })
      appendMessage(session.id, {
        id: genId(),
        role: 'assistant',
        text: response.message,
        type: response.type,
        data: response.data ?? undefined,
        artifacts: response.artifacts,
        followUpQuestions: response.follow_up_questions,
      })
    } catch (err) {
      appendMessage(session.id, {
        id: genId(),
        role: 'assistant',
        text: 'Sorry, something went wrong: ' + errorMessage(err),
      })
    } finally {
      setAsking(false)
    }
    setAskInput('')
    onSessionStarted(session.id)
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-10 overflow-y-auto">
      <div className="w-full max-w-lg flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-4xl" aria-hidden="true">
            📖
          </span>
          <h1 className="text-xl font-semibold">Bible Explorer</h1>
          <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
            Ask about a verse, a word, or a theme — or start a guided study below.
          </p>
        </div>

        <form
          className="w-full flex items-center gap-2 rounded-2xl border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-4 py-3 shadow-sm focus-within:border-[var(--color-theme-accent)] transition-colors"
          onSubmit={(e) => {
            e.preventDefault()
            askDirectly(askInput)
          }}
        >
          <input
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            placeholder="Ask about a verse, word, or theme…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button
            type="submit"
            aria-label="Ask"
            disabled={asking || !askInput.trim()}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-40"
          >
            {asking ? '…' : '➤'}
          </button>
        </form>

        <div className="flex flex-wrap justify-center gap-2">
          <button
            className={STARTER_BUBBLE}
            onClick={() =>
              // Once the user has picked a plan (and possibly made
              // progress through it) before, skip straight back into it —
              // same plan, next unread day — instead of asking again and
              // restarting at day 1 every time.
              readingPlanProgress
                ? startSession('reading_plan', '📅 Bible in a Year', { ...readingPlanProgress })
                : startWithChoices(
                    'reading_plan',
                    '📅 Bible in a Year',
                    'Would you like to read chronologically (the order events happened) or in canonical order (book order)?',
                    [
                      { label: 'Chronological', modeParams: { plan: 'chronological', dayIndex: 0, completedDays: [] } },
                      { label: 'Canonical (book order)', modeParams: { plan: 'canonical', dayIndex: 0, completedDays: [] } },
                    ]
                  )
            }
          >
            <span aria-hidden="true">📅</span> Bible in a Year
          </button>
          <button
            className={STARTER_BUBBLE}
            onClick={() =>
              startWithFetchedChoices(
                'parable',
                '🌿 Parable Study',
                'Here are some parables to explore — which would you like to read?',
                async () => {
                  const parables = await listParables()
                  return parables.map((p) => ({ label: `${p.name} (${p.reference})`, modeParams: { parableId: p.id } }))
                }
              )
            }
          >
            <span aria-hidden="true">🌿</span> Parable Study
          </button>
          <button
            className={STARTER_BUBBLE}
            onClick={() =>
              startWithChoices(
                'verse',
                '✨ Verse of the Day',
                'Want a random verse? Or type a reference below — e.g. John 3:16 or 1 Th 4:16.',
                [{ label: 'Surprise me', modeParams: {} }]
              )
            }
          >
            <span aria-hidden="true">✨</span> Verse of the Day
          </button>
          <button
            className={STARTER_BUBBLE}
            onClick={() =>
              startWithFetchedChoices(
                'topic',
                '🔎 Topical Study',
                'Which series would you like to study?',
                async () => {
                  const series = await listStudyWikis()
                  return series.map((s) => ({ label: `${s.title} — ${s.speaker}`, modeParams: { seriesId: s.id } }))
                }
              )
            }
          >
            <span aria-hidden="true">🔎</span> Topical Study
          </button>
          <button className={STARTER_BUBBLE} onClick={() => startSession('freeform', '💬 Ask Anything', {})}>
            <span aria-hidden="true">💬</span> Ask Anything
          </button>
        </div>
      </div>
    </div>
  )
}
