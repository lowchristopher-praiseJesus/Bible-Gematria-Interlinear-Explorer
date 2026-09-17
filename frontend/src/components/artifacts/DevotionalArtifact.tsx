import { useState } from 'react'
import { Check, Copy, Headphones } from 'lucide-react'
import { renderMarkdown } from '@/lib/renderMarkdown'
import { DevotionalListenOverlay } from './DevotionalListenOverlay'
import type { DevotionalArtifactParams } from '@/types/session'

export function DevotionalArtifact({ reference, text }: DevotionalArtifactParams) {
  const [copied, setCopied] = useState(false)
  const [listenOpen, setListenOpen] = useState(false)

  async function copy() {
    try {
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
        <h2 className="text-sm font-semibold">{reference}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setListenOpen(true)}
            aria-label="Listen to devotional"
            title="Listen"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
          >
            <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={copy}
            aria-label="Copy devotional"
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
      <div className="text-sm leading-relaxed max-w-prose">{renderMarkdown(text)}</div>
      <DevotionalListenOverlay
        reference={reference}
        text={text}
        open={listenOpen}
        onClose={() => setListenOpen(false)}
      />
    </div>
  )
}
