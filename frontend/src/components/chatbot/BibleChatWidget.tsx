import React, { useCallback, useEffect, useRef, useState } from 'react'
import './BibleChatWidget.css'
import type { BibleChatWidgetProps, ChatMessage } from './types'
import { submitReport } from '@/lib/feedbackApi'
import type { Session } from '@/types/session'

let idCounter = 0
function genId() {
  return `msg-${++idCounter}`
}

export function BibleChatWidget({
  apiUrl,
  theme = 'light',
  position = 'bottom-right',
  title = 'Bible Study Chat',
  welcomeMessage = 'Ask me about any Bible verse, commentary, or Strong\'s word.',
}: BibleChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(position === 'inline')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [reportNote, setReportNote] = useState<'idle' | 'sent' | 'error'>('idle')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isOpen])

  const sendMessage = useCallback(
    async (text: string, useStream = false) => {
      if (!text.trim()) return
      const userMsg: ChatMessage = { id: genId(), role: 'user', text }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
      setLoading(true)

      if (useStream) {
        try {
          const response = await fetch(`${apiUrl}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text }),
          })
          const reader = response.body?.getReader()
          const decoder = new TextDecoder()
          if (!reader) return

          const assistantId = genId()
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: 'assistant', text: '', isStreaming: true },
          ])

          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const json = line.slice(6)
              try {
                const event = JSON.parse(json)
                if (event.type === 'stream' && event.text) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, text: event.text }
                        : m
                    )
                  )
                } else if (event.type === 'final') {
                  const result = event.result ?? {}
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? {
                            ...m,
                            text: result.message || '',
                            type: result.type,
                            data: result.data,
                            route: result.route,
                            isStreaming: false,
                          }
                        : m
                    )
                  )
                } else if (event.type === 'trace') {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, trace: event.trace } : m
                    )
                  )
                }
              } catch {
                // ignore malformed events
              }
            }
          }
        } catch (e) {
          setMessages((prev) => [
            ...prev,
            {
              id: genId(),
              role: 'assistant',
              text: 'Sorry, something went wrong. Please try again.',
            },
          ])
        } finally {
          setLoading(false)
        }
        return
      }

      // Non-streaming
      try {
        const response = await fetch(`${apiUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        })
        const data = await response.json()
        const assistantMsg: ChatMessage = {
          id: genId(),
          role: 'assistant',
          text: data.message || '',
          type: data.type,
          data: data.data,
          route: data.route,
          trace: data.trace,
        }
        setMessages((prev) => [...prev, assistantMsg])
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            text: 'Sorry, something went wrong. Please try again.',
          },
        ])
      } finally {
        setLoading(false)
      }
    },
    [apiUrl]
  )

  const reportIssue = useCallback(async () => {
    const description = (
      typeof prompt === 'function' ? prompt('Describe the problem with this chat:') : ''
    )?.trim()
    if (!description) return
    const now = Date.now()
    const syntheticSession: Session = {
      id: 'widget',
      createdAt: now,
      updatedAt: now,
      mode: 'freeform',
      modeParams: {},
      title,
      messages: messages as Session['messages'],
      notes: [],
    }
    try {
      await submitReport(syntheticSession, { category: 'other', description })
      setReportNote('sent')
    } catch {
      setReportNote('error')
    }
    setTimeout(() => setReportNote('idle'), 2000)
  }, [messages, title])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input, false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as any)
    }
  }

  const widgetClass = `bible-chat-widget bible-chat-${theme} bible-chat-${position}`

  if (!isOpen) {
    return (
      <button
        className={`bible-chat-fab ${position}`}
        onClick={() => setIsOpen(true)}
        aria-label="Open Bible Chat"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    )
  }

  return (
    <div className={widgetClass}>
      <div className="bible-chat-header">
        <span className="bible-chat-title">{title}</span>
        <button
          type="button"
          onClick={reportIssue}
          aria-label="Report an issue"
          className="bcw-report"
        >
          {reportNote === 'sent'
            ? 'Sent ✓'
            : reportNote === 'error'
              ? 'Failed'
              : 'Report an issue'}
        </button>
        <button
          className="bible-chat-close"
          onClick={() => setIsOpen(false)}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="bible-chat-messages">
        {messages.length === 0 && (
          <div className="bible-chat-welcome">{welcomeMessage}</div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`bible-chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}
          >
            <div className="bible-chat-bubble">
              {msg.type === 'verse' && msg.data?.translations ? (
                <VerseCard data={msg.data} />
              ) : msg.type === 'study' && msg.data?.verses ? (
                <StudyCard data={msg.data} />
              ) : msg.type === 'strongs' && msg.data?.words ? (
                <StrongsCard data={msg.data} />
              ) : (
                <div className="bible-chat-text">{msg.text}</div>
              )}
              {msg.isStreaming && (
                <span className="bible-chat-cursor">▌</span>
              )}
              {msg.role === 'assistant' && msg.route && !msg.isStreaming && (
                <div className="bible-chat-route">
                  <span className="bible-chat-route-label">Route</span>
                  {msg.route}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="bible-chat-message assistant">
            <div className="bible-chat-bubble">
              <div className="bible-chat-loading">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="bible-chat-input" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a verse..."
          rows={1}
        />
        <button type="submit" disabled={loading || !input.trim()} aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components for special message types
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, string> = {
  historical_setting: 'Historical Setting',
  cultural_background: 'Cultural Background',
  author_and_audience: 'Author & Audience',
  literary_context: 'Literary Context',
  genre_and_style: 'Genre & Style',
  language_and_translation: 'Language & Translation',
  theological_themes: 'Theological Themes',
  immediate_purpose: 'Immediate Purpose',
}

function VerseCard({ data }: { data: any }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const translations = data.translations as Record<string, string>
  const keys = Object.keys(translations)
  const activeKey = selected || keys[0]
  const ctx = data.book_context

  return (
    <div className="bible-chat-verse-card">
      <div className="verse-ref">{data.reference}</div>
      <div className="verse-text">{translations[activeKey]}</div>
      <div className="verse-versions">
        {keys.slice(0, 8).map((k) => (
          <button
            key={k}
            className={k === activeKey ? 'active' : ''}
            onClick={() => setSelected(k)}
          >
            {k}
          </button>
        ))}
      </div>
      {ctx && (
        <div className="book-context">
          <button
            className="book-context-toggle"
            onClick={() => setContextOpen((o) => !o)}
          >
            {contextOpen ? '▾' : '▸'} {ctx.book_name} — Book Context
          </button>
          {contextOpen && (
            <dl className="book-context-sections">
              {Object.entries(ctx.sections as Record<string, string | null>)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="book-context-row">
                    <dt>{SECTION_LABELS[k] ?? k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      )}
    </div>
  )
}

function StudyCard({ data }: { data: any }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const verses = data.verses || []

  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="bible-chat-study-card">
      {verses.map((v: any) => {
        const key = v.reference || v.display_reference
        const isOpen = expanded[key]
        return (
          <div key={key} className="study-verse">
            <button className="study-header" onClick={() => toggle(key)}>
              <span>{v.display_reference}</span>
              <span>{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <div className="study-body">
                {v.commentary ? (
                  <pre>{JSON.stringify(v.commentary, null, 2).slice(0, 1200)}</pre>
                ) : (
                  <div className="study-empty">{v.note || 'No commentary available.'}</div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StrongsCard({ data }: { data: any }) {
  const words = data.words as Record<string, any>
  return (
    <div className="bible-chat-strongs-card">
      {Object.entries(words).map(([num, entry]) => (
        <div key={num} className="strongs-entry">
          <div className="strongs-number">{num}</div>
          <div className="strongs-lemma">{entry.lemma}</div>
          <div className="strongs-trans">{entry.transliteration}</div>
          <div className="strongs-def">{entry.definition}</div>
        </div>
      ))}
    </div>
  )
}
