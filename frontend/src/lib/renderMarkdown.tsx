import type { ReactNode } from 'react'

/**
 * Minimal markdown-to-JSX rendering for chat/primer text. Backend primers
 * only ever send **bold** spans and blank-line paragraph breaks, so this
 * intentionally does not pull in a full markdown library — just the two
 * constructs actually used.
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
  return paragraphs.map((paragraph, i) => (
    <p key={i} className={i > 0 ? 'mt-2' : undefined}>
      {renderInline(paragraph, `p${i}`)}
    </p>
  ))
}
