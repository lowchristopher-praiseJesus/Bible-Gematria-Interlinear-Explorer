import { useState } from 'react'
import { VerseRangeContent } from './VerseRangeContent'
import type { ArtifactLink } from '@/types/session'

interface Props {
  link: ArtifactLink
}

/** The collapsible "Read X ▸" pill a reading-plan/parable message posts.
 * Expanding it mounts VerseRangeContent, which does the actual fetch and
 * rendering — the same component Deep Study's always-open passage box
 * uses, so the two read identically. */
export function ChapterReadingBubble({ link }: Props) {
  const [expanded, setExpanded] = useState(false)
  const label = link.label.replace(/\s*▸\s*$/, '')
  const passageLabel = label.replace(/^Read\s+/, '')
  const reference = link.params.reference as string

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="text-xs px-2 py-1 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface)]"
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {label}
      </button>

      {expanded && (
        <div className="mt-2">
          <VerseRangeContent reference={reference} label={passageLabel} />
        </div>
      )}
    </div>
  )
}
