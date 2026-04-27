// src/components/chatbot/ChatSidebar.tsx
import { useCallback, useRef, useEffect, useState } from 'react'
import { useChatContext } from '@/context/ChatContext'
import type { ChatMessage } from './types'

const API_URL = '/api/bible-chat'

let idCounter = 0
function genId() {
  return `msg-${++idCounter}`
}

export function ChatSidebar() {
  const { isOpen, toggle, messages, setMessages } = useChatContext()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isOpen])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return
      const userMsg: ChatMessage = { id: genId(), role: 'user', text }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
      setLoading(true)

      try {
        const res = await fetch(`${API_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        })
        const data = await res.json()
        const assistantMsg: ChatMessage = {
          id: genId(),
          role: 'assistant',
          text: data.message || '',
          type: data.type,
          data: data.data,
        }
        setMessages((prev) => [...prev, assistantMsg])
      } catch {
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
    [setMessages]
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div
      className={`flex flex-col border-l border-gray-200 bg-white shrink-0 transition-[width] duration-300 overflow-hidden ${
        isOpen ? 'w-[360px]' : 'w-0'
      }`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0 min-w-[360px]"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        <span className="text-white font-semibold text-sm">Bible Study Chat</span>
        <button
          onClick={toggle}
          className="text-white hover:text-gray-300 text-xl leading-none"
          aria-label="Close chat"
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-w-[360px]">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8">
            Ask me about any verse, commentary, or Greek/Hebrew word.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[90%] px-3 py-2 rounded-2xl text-sm ${
                msg.role === 'user'
                  ? 'text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-900 rounded-bl-sm'
              }`}
              style={msg.role === 'user' ? { backgroundColor: '#1e3a5f' } : {}}
            >
              {msg.type === 'verse' && msg.data?.translations ? (
                <VerseCard data={msg.data} />
              ) : msg.type === 'study' && msg.data?.verses ? (
                <StudyCard data={msg.data} />
              ) : msg.type === 'strongs' && msg.data?.words ? (
                <StrongsCard data={msg.data} />
              ) : (
                <div className="whitespace-pre-wrap">{msg.text}</div>
              )}
              {msg.isStreaming && <span className="animate-pulse">▌</span>}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2">
              <LoadingDots />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 p-3 border-t border-gray-200 shrink-0 min-w-[360px]"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a verse..."
          rows={1}
          className="flex-1 resize-none border border-gray-300 rounded-full px-3 py-2 text-sm outline-none focus:border-yellow-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Send"
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components (own copies — BibleChatWidget.tsx must stay untouched)
// ---------------------------------------------------------------------------

function LoadingDots() {
  return (
    <div className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </div>
  )
}

function VerseCard({ data }: { data: any }) {
  const [selected, setSelected] = useState<string | null>(null)
  const translations = data.translations as Record<string, string>
  const keys = Object.keys(translations)
  const activeKey = selected || keys[0]

  return (
    <div>
      <div className="font-semibold text-xs mb-1" style={{ color: '#c9a227' }}>
        {data.reference}
      </div>
      <div className="italic mb-2 leading-relaxed">{translations[activeKey]}</div>
      <div className="flex flex-wrap gap-1">
        {keys.slice(0, 8).map((k) => (
          <button
            key={k}
            onClick={() => setSelected(k)}
            className={`text-xs px-2 py-0.5 rounded-full border ${
              k === activeKey ? 'text-gray-900 border-yellow-500' : 'border-gray-300 text-gray-600'
            }`}
            style={k === activeKey ? { backgroundColor: '#c9a227' } : {}}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}

function StudyCard({ data }: { data: any }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const verses = data.verses || []

  return (
    <div className="flex flex-col gap-1">
      {verses.map((v: any) => {
        const key = v.reference || v.display_reference
        return (
          <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              className="w-full flex justify-between items-center px-3 py-2 text-xs font-semibold bg-gray-50 text-left"
              onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
            >
              <span>{v.display_reference}</span>
              <span>{expanded[key] ? '−' : '+'}</span>
            </button>
            {expanded[key] && (
              <div className="px-3 py-2 text-xs">
                {v.commentary ? (
                  <pre className="whitespace-pre-wrap">
                    {JSON.stringify(v.commentary, null, 2).slice(0, 1200)}
                  </pre>
                ) : (
                  <span className="text-gray-400 italic">
                    {v.note || 'No commentary available.'}
                  </span>
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
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(data.words as Record<string, any>).map(([num, entry]) => (
        <div key={num} className="p-2 border border-gray-200 rounded-lg bg-gray-50">
          <div className="font-bold text-xs" style={{ color: '#c9a227' }}>
            {num}
          </div>
          <div className="font-semibold">{entry.lemma}</div>
          <div className="text-xs text-gray-500 italic">{entry.transliteration}</div>
          <div className="text-xs mt-1">{entry.definition}</div>
        </div>
      ))}
    </div>
  )
}
