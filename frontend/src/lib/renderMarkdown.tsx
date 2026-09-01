import type { ReactNode } from 'react'

/**
 * Minimal markdown-to-JSX rendering for chat/primer text. Backend primers
 * mostly send **bold** spans and blank-line paragraph breaks; the AI
 * fallback (Ollama) can also quote verse text as a "> ..." blockquote, so
 * that's handled too. This intentionally does not pull in a full markdown
 * library — just the constructs actually used.
 */
// Bold spans and [text](url) links are the only inline constructs this
// renderer supports; the links arrive from the backend (wiki_qa runs
// resolve_scripture_refs over LLM answers) pointing at the Explorer, and
// ChatPane intercepts clicks on them to open the interlinear artifact.
const INLINE_MARK_RE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_MARK_RE).filter((part) => part.length > 0)
  // Render inner content through renderInline only when it actually contains
  // another marker, so plain bold/link text keeps its original DOM shape.
  const renderInner = (inner: string, innerKey: string): ReactNode =>
    inner.split(INLINE_MARK_RE).length > 1 ? renderInline(inner, innerKey) : inner
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      // Recurse: wiki_qa bolds scripture refs and then links them, so bold
      // spans routinely contain [ref](url) markdown — render it, don't show
      // the raw syntax. Terminates because bold content matches [^*]+ and
      // so can never itself start a bold span.
      return <strong key={`${keyPrefix}-${i}`}>{renderInner(part.slice(2, -2), `${keyPrefix}-${i}`)}</strong>
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      // Render the link text too, so [**ref**](url) shows bold, not asterisks.
      return (
        <a key={`${keyPrefix}-${i}`} href={linkMatch[2]} className="underline">
          {renderInner(linkMatch[1], `${keyPrefix}-${i}`)}
        </a>
      )
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
