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

  function openListen() {
    // WebKit (mobile Safari and Chrome-on-iOS, both WKWebView under the
    // hood) only allows HTMLMediaElement.play() when it happens within a
    // short window of a real user gesture. The devotional's audio.play()
    // call happens later, after DevotionalListenOverlay's fetch to
    // /devotional/audio resolves - fast for an already-cached devotional,
    // but multiple seconds on a cache miss that has to run real TTS
    // synthesis, long enough for WebKit to no longer consider it
    // gesture-adjacent and silently reject it. Synchronously playing a
    // throwaway silent clip right here, inside the click itself, unlocks
    // audio playback for the rest of the page so that later, possibly
    // long-delayed, play() call succeeds too.
    try {
      const unlock = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAAAAAA=='
      )
      // play() can throw synchronously, reject, or (in some non-browser
      // environments, e.g. jsdom in tests) return undefined instead of a
      // Promise - the optional chain covers that last case.
      unlock.play()?.catch(() => {})
    } catch {
      // Audio construction itself can throw in exotic environments (tests,
      // certain webviews) - never let a priming attempt break the click.
    }
    setListenOpen(true)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{reference}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={openListen}
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
