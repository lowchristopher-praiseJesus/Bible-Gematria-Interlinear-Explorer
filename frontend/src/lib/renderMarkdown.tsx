import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown rendering for chat/primer text.
 *
 * Backend primers send **bold**, [text](url) links, and "> ..." blockquotes;
 * the AI fallback (NVIDIA NIM / Ollama) additionally emits GFM tables, ###
 * headings, --- rules, and -/1. lists. react-markdown + remark-gfm covers
 * all of it. Output is real DOM (no dangerouslySetInnerHTML), so ChatPane's
 * click delegation on `/explorer?reference=` anchors keeps working.
 *
 * The `.chat-md` wrapper scopes the element styling (tables, headings,
 * lists, hr, code) added in index.css — Tailwind's preflight resets those
 * to nothing otherwise.
 */
export function renderMarkdown(text: string): ReactNode {
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Keep the underline affordance the hand-rolled renderer had.
          // ChatPane intercepts clicks on Explorer links via event
          // delegation, so no onClick is needed here.
          a({ node: _node, ...props }) {
            return <a className="underline" {...props} />
          },
          // Wide tables scroll within their own box instead of stretching
          // the chat column.
          table({ node: _node, ...props }) {
            return (
              <div className="chat-md-table-wrap">
                <table {...props} />
              </div>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
