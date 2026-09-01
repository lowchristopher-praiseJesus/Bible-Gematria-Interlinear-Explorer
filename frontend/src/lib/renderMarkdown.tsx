import type { ReactNode } from 'react'

/**
 * Minimal markdown-to-JSX rendering for chat/primer text. Backend primers
 * mostly send **bold** spans and blank-line paragraph breaks; the AI
 * fallback (Ollama) can also quote verse text as a "> ..." blockquote, so
 * that's handled too. This intentionally does not pull in a full markdown
 * library — just the constructs actually used.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((part) => part.length > 0)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>
  })
}

export function renderMarkdown(text: string): ReactNode {
  const paragraphs = text.split(/\n\n+/)
  return paragraphs.map((paragraph, i) => {
    if (paragraph.startsWith('> ') || paragraph.startsWith('>\n')) {
      const quoted = paragraph
        .split('\n')
        .map((line) => line.replace(/^>\s?/, ''))
        .join('\n')
      return (
        <blockquote
          key={i}
          className={`border-l-2 border-[var(--color-theme-border)] pl-3 italic ${i > 0 ? 'mt-2' : ''}`}
        >
          {renderInline(quoted, `bq${i}`)}
        </blockquote>
      )
    }
    return (
      <p key={i} className={i > 0 ? 'mt-2' : undefined}>
        {renderInline(paragraph, `p${i}`)}
      </p>
    )
  })
}
