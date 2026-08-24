import { useCallback, useState } from 'react'
import { postChat } from '@/lib/chatApi'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { ArtifactLink, SessionMessage } from '@/types/session'

interface Props {
  sessionId: string
}

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

export function ChatPane({ sessionId }: Props) {
  const session = useSessionsStore((s) => s.sessions[sessionId])
  const appendMessage = useSessionsStore((s) => s.appendMessage)
  const updateModeParams = useSessionsStore((s) => s.updateModeParams)
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

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
          text: 'Sorry, something went wrong: ' + (err instanceof Error ? err.message : String(err)),
        })
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, appendMessage]
  )

  const markDayComplete = useCallback(() => {
    if (!session) return
    const dayIndex = session.modeParams.dayIndex ?? 0
    const completedDays = [...(session.modeParams.completedDays ?? []), dayIndex]
    updateModeParams(sessionId, { dayIndex: dayIndex + 1, completedDays })
  }, [session, sessionId, updateModeParams])

  if (!session) return null

  const lastMessage = session.messages[session.messages.length - 1]
  const showMarkComplete = session.mode === 'reading_plan' && !!lastMessage

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {session.messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] rounded-br-sm'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text-primary)] rounded-bl-sm'
              }`}
            >
              {msg.text}
              {msg.artifacts && msg.artifacts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.artifacts.map((link: ArtifactLink, i: number) => (
                    <button
                      key={i}
                      onClick={() => openArtifact(link)}
                      className="text-xs px-2 py-1 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface)]"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {showMarkComplete && (
          <button
            onClick={markDayComplete}
            className="self-start text-xs px-3 py-1.5 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]"
          >
            Mark day complete
          </button>
        )}
      </div>
      <form
        className="flex gap-2 p-3 border-t border-[var(--color-theme-border)]"
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a verse..."
          className="flex-1 border border-[var(--color-theme-border)] rounded-full px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}
