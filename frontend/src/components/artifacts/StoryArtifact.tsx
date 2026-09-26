import { useState } from 'react'
import { BookOpen, Check, Copy } from 'lucide-react'
import { renderMarkdown } from '@/lib/renderMarkdown'
import { normalizeStory } from '@/lib/storyArtifact'
import { StoryReaderOverlay } from './StoryReaderOverlay'
import type { StoryArtifactParams } from '@/types/session'

const AGE_RANGE_LABELS: Record<string, string> = {
  '3-6': 'Ages 3-6',
  '7-8': 'Ages 7-8',
  '9-10': 'Ages 9-10',
}

export function StoryArtifact(props: StoryArtifactParams) {
  const { title, themes, age_range, word_count } = props
  // Defensive against legacy (pre-illustration) story artifacts still in
  // persisted session history / old share snapshots, which have a single
  // `text` field and no `pages` — see normalizeStory.
  const { pages } = normalizeStory(props)
  const [copied, setCopied] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)

  async function copy() {
    try {
      const tags = [AGE_RANGE_LABELS[age_range] ?? age_range, ...(themes ?? [])].join(' · ')
      const text = [title, tags, ...pages.map((p) => p.text)].join('\n\n')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied by the browser; nothing useful to
      // do beyond leaving the copy affordance unconfirmed.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          {pages.length > 0 && (
            <button
              onClick={() => setReaderOpen(true)}
              aria-label="Read full screen"
              title="Read full screen"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            onClick={copy}
            aria-label="Copy story"
            title="Copy"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-green)]" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
        <span className="px-2 py-0.5 rounded-full border border-[var(--color-theme-border)]">
          {AGE_RANGE_LABELS[age_range] ?? age_range}
        </span>
        {(themes ?? []).map((theme) => (
          <span key={theme} className="px-2 py-0.5 rounded-full border border-[var(--color-theme-border)]">
            {theme}
          </span>
        ))}
      </div>
      <div className="text-sm leading-relaxed max-w-prose">{renderMarkdown(pages[0]?.text ?? '')}</div>
      <p className="text-xs text-[var(--color-text-secondary)]">{word_count} words</p>
      {pages.length > 0 && (
        <StoryReaderOverlay artifact={props} open={readerOpen} onClose={() => setReaderOpen(false)} />
      )}
    </div>
  )
}
