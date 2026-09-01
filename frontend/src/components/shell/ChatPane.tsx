import { useCallback, useEffect, useRef, useState } from 'react'
import { postChat } from '@/lib/chatApi'
import { listParables, listStudyWikis } from '@/lib/modeData'
import { renderMarkdown } from '@/lib/renderMarkdown'
import { useArtifactStore } from '@/store/useArtifactStore'
import { MODE_LABELS, useSessionsStore } from '@/store/useSessionsStore'
import { useReadingPlanStore } from '@/store/useReadingPlanStore'
import { VerseBubble, type VerseBubbleData } from './VerseBubble'
import { StrongsBubble } from './StrongsBubble'
import { ChapterReadingBubble } from './ChapterReadingBubble'
import type { ArtifactLink, MessageChoice, SessionMessage } from '@/types/session'

interface Props {
  sessionId: string
}

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const ARTIFACT_PILL =
  'text-xs px-2 py-1 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]'

interface ArtifactGroup {
  primary: ArtifactLink
  bookContext?: ArtifactLink
}

/** Pairs each primary artifact (a "Read X" link) with its "book_context"
 * link, if one immediately follows it — the backend always emits a
 * book_context link right after the reference it belongs to (see
 * _reading_artifacts() in chatbot/router.py), so adjacency in the array is
 * what ties the two together. Without this, splitting artifacts into flat
 * "all pills" / "all chapter links" rows (the previous approach) scatters
 * a reference's own book-context pill away from its reading link whenever
 * a message mixes single-verse and passage-range references, like Topical
 * Study's seed list. */
function groupArtifacts(artifacts: ArtifactLink[]): ArtifactGroup[] {
  const groups: ArtifactGroup[] = []
  for (const link of artifacts) {
    const last = groups[groups.length - 1]
    // Only pair a book_context onto a real reading link, never onto
    // another book_context — a message with several boxed verses (e.g. the
    // AI fallback citing more than one) can emit several book_context
    // pills back to back with nothing else between them, and without this
    // check the second would wrongly swallow into the first's group.
    if (link.type === 'book_context' && last && last.primary.type !== 'book_context' && !last.bookContext) {
      last.bookContext = link
    } else {
      groups.push({ primary: link })
    }
  }
  return groups
}

type Feedback = 'up' | 'down'

export function ChatPane({ sessionId }: Props) {
  const session = useSessionsStore((s) => s.sessions[sessionId])
  const appendMessage = useSessionsStore((s) => s.appendMessage)
  const updateMessage = useSessionsStore((s) => s.updateMessage)
  const updateModeParams = useSessionsStore((s) => s.updateModeParams)
  const truncateMessagesFrom = useSessionsStore((s) => s.truncateMessagesFrom)
  const setReadingPlanProgress = useReadingPlanStore((s) => s.setProgress)
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [markingComplete, setMarkingComplete] = useState(false)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [resolvingChoiceId, setResolvingChoiceId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Partial<Record<string, Feedback>>>({})
  const bottomRef = useRef<HTMLDivElement>(null)

  // Keep the latest message in view as the conversation grows — a new
  // message, a choice prompt resolving, or its options finishing a fetch
  // all change the messages array and should pull the view down to it.
  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [session?.messages])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !session) return
      const history = session.messages.slice(-6).map((m) => ({ role: m.role, text: m.text }))
      const userMessage: SessionMessage = { id: genId(), role: 'user', text }
      appendMessage(sessionId, userMessage)
      setInput('')
      setLoading(true)
      try {
        const response = await postChat({
          message: text,
          history,
          mode: session.mode,
          mode_params: { ...session.modeParams },
        })
        appendMessage(sessionId, {
          id: genId(),
          role: 'assistant',
          text: response.message,
          type: response.type,
          data: response.data ?? undefined,
          artifacts: response.artifacts,
          followUpQuestions: response.follow_up_questions,
        })
      } catch (err) {
        appendMessage(sessionId, {
          id: genId(),
          role: 'assistant',
          text: 'Sorry, something went wrong: ' + errorMessage(err),
        })
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, appendMessage]
  )

  // Re-asks the user message that produced this response, discarding the
  // old response first so the regenerated one takes its place rather than
  // stacking below it.
  const regenerate = useCallback(
    async (assistantMessageId: string) => {
      if (!session || regeneratingId) return
      const idx = session.messages.findIndex((m) => m.id === assistantMessageId)
      const userMessage = idx > 0 ? session.messages[idx - 1] : undefined
      if (!userMessage || userMessage.role !== 'user') return
      const history = session.messages.slice(0, idx - 1).slice(-6).map((m) => ({ role: m.role, text: m.text }))
      setRegeneratingId(assistantMessageId)
      truncateMessagesFrom(sessionId, assistantMessageId)
      try {
        const response = await postChat({
          message: userMessage.text,
          history,
          mode: session.mode,
          mode_params: { ...session.modeParams },
        })
        appendMessage(sessionId, {
          id: genId(),
          role: 'assistant',
          text: response.message,
          type: response.type,
          data: response.data ?? undefined,
          artifacts: response.artifacts,
          followUpQuestions: response.follow_up_questions,
        })
      } catch (err) {
        appendMessage(sessionId, {
          id: genId(),
          role: 'assistant',
          text: 'Sorry, something went wrong: ' + errorMessage(err),
        })
      } finally {
        setRegeneratingId(null)
      }
    },
    [session, sessionId, regeneratingId, truncateMessagesFrom, appendMessage]
  )

  // Finalizes a "which option?" prompt: merges the picked modeParams into
  // the session, marks the prompt as answered so its pills render disabled
  // instead of vanishing, then fetches the real primer response for it.
  const resolveChoice = useCallback(
    async (promptMessageId: string, choice: MessageChoice) => {
      if (!session || resolvingChoiceId) return
      const nextModeParams = { ...session.modeParams, ...choice.modeParams }
      setResolvingChoiceId(promptMessageId)
      updateMessage(sessionId, promptMessageId, { resolvedChoiceLabel: choice.label })
      updateModeParams(sessionId, choice.modeParams)
      // Remember the plan choice (Chronological/Canonical) across sessions
      // so reopening "Bible in a Year" later doesn't ask again.
      if (session.mode === 'reading_plan' && choice.modeParams.plan) {
        setReadingPlanProgress({
          plan: choice.modeParams.plan,
          dayIndex: choice.modeParams.dayIndex ?? nextModeParams.dayIndex ?? 0,
          completedDays: choice.modeParams.completedDays ?? nextModeParams.completedDays ?? [],
        })
      }
      try {
        const response = await postChat({ message: '', mode: session.mode, mode_params: nextModeParams })
        // Topical Study's series step responds with a list of concepts to
        // pick from next, not a finished answer — render it as a new
        // choices prompt (like the series list itself) instead of plain text.
        const concepts = (response.data as { concepts?: { slug: string; title: string }[] } | undefined)?.concepts
        if (session.mode === 'topic' && concepts) {
          appendMessage(sessionId, {
            id: genId(),
            role: 'assistant',
            text: response.message,
            choicesStatus: 'ready',
            choices: concepts.map((c) => ({ label: c.title, modeParams: { conceptSlug: c.slug } })),
          })
        } else {
          appendMessage(sessionId, {
            id: genId(),
            role: 'assistant',
            text: response.message,
            type: response.type,
            data: response.data ?? undefined,
            artifacts: response.artifacts,
            followUpQuestions: response.follow_up_questions,
          })
        }
      } catch (err) {
        appendMessage(sessionId, {
          id: genId(),
          role: 'assistant',
          text: 'Sorry, something went wrong: ' + errorMessage(err),
        })
      } finally {
        setResolvingChoiceId(null)
      }
    },
    [session, sessionId, resolvingChoiceId, updateMessage, updateModeParams, appendMessage, setReadingPlanProgress]
  )

  // Only Parable Study and Topical Study fetch their choices, so only
  // those two know how to reload after a failed fetch.
  const retryChoices = useCallback(
    async (promptMessageId: string) => {
      if (!session) return
      updateMessage(sessionId, promptMessageId, { choicesStatus: 'loading', choicesError: undefined })
      try {
        const choices: MessageChoice[] =
          session.mode === 'parable'
            ? (await listParables()).map((p) => ({ label: `${p.name} (${p.reference})`, modeParams: { parableId: p.id } }))
            : (await listStudyWikis()).map((s) => ({ label: `${s.title} — ${s.speaker}`, modeParams: { seriesId: s.id } }))
        updateMessage(sessionId, promptMessageId, { choicesStatus: 'ready', choices })
      } catch (err) {
        updateMessage(sessionId, promptMessageId, { choicesStatus: 'error', choicesError: errorMessage(err) })
      }
    },
    [session, sessionId, updateMessage]
  )

  async function copyMessage(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    } catch {
      // Clipboard access can be denied by the browser; there's nothing
      // useful to do beyond leaving the copy affordance unconfirmed.
    }
  }

  function rateMessage(id: string, rating: Feedback) {
    setFeedback((prev) => ({ ...prev, [id]: prev[id] === rating ? undefined : rating }))
  }

  const markDayComplete = useCallback(async () => {
    if (!session) return
    const dayIndex = session.modeParams.dayIndex ?? 0
    const completedDays = [...(session.modeParams.completedDays ?? []), dayIndex]
    const nextModeParams = { ...session.modeParams, dayIndex: dayIndex + 1, completedDays }
    updateModeParams(sessionId, { dayIndex: dayIndex + 1, completedDays })
    // Mirror the advance into cross-session progress so the next time the
    // user opens "Bible in a Year" (a fresh session), it picks up on the
    // next unread day instead of restarting at this one.
    if (session.modeParams.plan) {
      setReadingPlanProgress({ plan: session.modeParams.plan, dayIndex: dayIndex + 1, completedDays })
    }
    setMarkingComplete(true)
    try {
      const response = await postChat({ message: '', mode: session.mode, mode_params: nextModeParams })
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: response.message,
        type: response.type,
        data: response.data ?? undefined,
        artifacts: response.artifacts,
        followUpQuestions: response.follow_up_questions,
      })
    } catch (err) {
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: 'Sorry, something went wrong: ' + errorMessage(err),
      })
    } finally {
      setMarkingComplete(false)
    }
  }, [session, sessionId, updateModeParams, appendMessage, setReadingPlanProgress])

  if (!session) return null

  const lastMessage = session.messages[session.messages.length - 1]
  // Only once a plan has actually been picked (the choice prompt resolved)
  // is there a day loaded to mark complete.
  const showMarkComplete = session.mode === 'reading_plan' && !!session.modeParams.plan && !!lastMessage
  const lastAssistantId = [...session.messages].reverse().find((m) => m.role === 'assistant')?.id

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--color-theme-border)]">
        <h2 className="text-sm font-semibold truncate min-w-0">{session.title}</h2>
        <span className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)]">
          {MODE_LABELS[session.mode]}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {session.messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'user' ? (
              <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]">
                {msg.text}
              </div>
            ) : (
              <div className="max-w-[85%] flex flex-col gap-1.5">
                <div className="text-sm whitespace-pre-wrap text-[var(--color-text-primary)]">
                  {renderMarkdown(msg.text)}
                  {msg.type === 'verse' && msg.data && <VerseBubble data={msg.data} />}
                  {msg.type === 'verses' && Array.isArray(msg.data?.verses) && (
                    <div className="flex flex-col gap-2">
                      {msg.data.verses.map((verse: VerseBubbleData, i: number) => (
                        <VerseBubble key={i} data={verse} />
                      ))}
                    </div>
                  )}
                  {msg.type === 'strongs' && msg.data && <StrongsBubble data={msg.data} />}
                  {msg.artifacts && msg.artifacts.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {groupArtifacts(msg.artifacts).map((group, i) =>
                        group.primary.type === 'chapter' ? (
                          <div key={i} className="flex flex-wrap items-center gap-1.5">
                            <ChapterReadingBubble link={group.primary} />
                            {group.bookContext && (
                              <button onClick={() => openArtifact(group.bookContext!)} className={ARTIFACT_PILL}>
                                {group.bookContext.label}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div key={i} className="flex flex-wrap gap-1.5">
                            <button onClick={() => openArtifact(group.primary)} className={ARTIFACT_PILL}>
                              {group.primary.label}
                            </button>
                            {group.bookContext && (
                              <button onClick={() => openArtifact(group.bookContext!)} className={ARTIFACT_PILL}>
                                {group.bookContext.label}
                              </button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  )}
                  {msg.choicesStatus === 'loading' && (
                    <div className="mt-2 text-xs text-[var(--color-text-secondary)]">Loading options…</div>
                  )}
                  {msg.choicesStatus === 'error' && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-red-600">{msg.choicesError}</span>
                      <button
                        onClick={() => retryChoices(msg.id)}
                        className="text-xs px-2 py-1 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {msg.choicesStatus === 'ready' && msg.choices && msg.choices.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {msg.choices.map((choice, i) => {
                        const answered = !!msg.resolvedChoiceLabel
                        const selected = msg.resolvedChoiceLabel === choice.label
                        return (
                          <button
                            key={i}
                            onClick={() => resolveChoice(msg.id, choice)}
                            disabled={answered || resolvingChoiceId === msg.id}
                            className={`text-sm px-3.5 py-2 rounded-full border transition-colors ${
                              selected
                                ? 'border-[var(--color-theme-accent)] bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]'
                                : 'border-[var(--color-theme-border)] bg-[var(--color-surface)]'
                            } ${answered && !selected ? 'opacity-40' : ''} ${
                              !answered ? 'hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)]' : ''
                            }`}
                          >
                            {choice.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {!msg.choicesStatus && (
                  <div className="flex items-center gap-0.5 text-[var(--color-text-secondary)]">
                    <button
                      onClick={() => copyMessage(msg.id, msg.text)}
                      aria-label="Copy response"
                      title="Copy"
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] text-xs"
                    >
                      {copiedId === msg.id ? '✓' : '📋'}
                    </button>
                    <button
                      onClick={() => rateMessage(msg.id, 'up')}
                      aria-label="Good response"
                      title="Good response"
                      className={`w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-alt)] text-xs ${
                        feedback[msg.id] === 'up' ? 'text-[var(--color-theme-accent)]' : 'hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      👍
                    </button>
                    <button
                      onClick={() => rateMessage(msg.id, 'down')}
                      aria-label="Poor response"
                      title="Poor response"
                      className={`w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-alt)] text-xs ${
                        feedback[msg.id] === 'down' ? 'text-[var(--color-theme-accent)]' : 'hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      👎
                    </button>
                    {msg.id === lastAssistantId && (
                      <button
                        onClick={() => regenerate(msg.id)}
                        disabled={regeneratingId === msg.id}
                        aria-label="Regenerate response"
                        title="Regenerate"
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] text-xs disabled:opacity-50"
                      >
                        {regeneratingId === msg.id ? '…' : '🔁'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {showMarkComplete && (
          <button
            onClick={markDayComplete}
            disabled={markingComplete}
            className="self-start text-xs px-3 py-1.5 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-50"
          >
            {markingComplete ? 'Marking complete…' : 'Mark day complete'}
          </button>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-center gap-2 m-3 rounded-2xl border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-4 py-3 shadow-sm focus-within:border-[var(--color-theme-accent)] transition-colors"
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a verse..."
          className="flex-1 bg-transparent outline-none text-sm"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={loading || !input.trim()}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-40"
        >
          {loading ? '…' : '➤'}
        </button>
      </form>
    </div>
  )
}
