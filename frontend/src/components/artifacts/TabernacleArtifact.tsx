import { useEffect, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import {
  emitViewerEvent, markViewerReady, parseViewerMessage, registerViewer, viewerSrc,
} from '@/lib/tabernacleBridge'
import type { TabernacleArtifactParams } from '@/types/session'

const LOAD_TIMEOUT_MS = 15000

// The iframe sits at one fixed place in the React tree for the artifact's
// lifetime. "Full screen" only swaps the classes of its ancestors (to a fixed
// full-viewport layer), so the element is never moved or remounted and its
// WebGL context and camera survive.
export function TabernacleArtifact({ spot }: TabernacleArtifactParams) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [fullscreen, setFullscreen] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches
  )
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const wasFullscreen = useRef(false)

  // Register once from the iframe's WindowProxy (stable across its own
  // navigations), not on `load`, so a ready that beats `load` isn't reset.
  useEffect(() => {
    if (!iframe) return
    registerViewer(iframe.contentWindow)
    return () => registerViewer(null)
  }, [iframe])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const ev = parseViewerMessage(e, iframe?.contentWindow ?? null)
      if (!ev) return
      if (ev.type === 'tabernacle:ready') {
        markViewerReady()
        setStatus('ready')
      }
      emitViewerEvent(ev)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [iframe])

  useEffect(() => {
    if (status !== 'loading') return
    const t = setTimeout(() => setStatus('failed'), LOAD_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [status])

  // Escape closes; focus goes to the close button, then back to the opener.
  useEffect(() => {
    if (fullscreen) {
      closeRef.current?.focus()
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false)
      window.addEventListener('keydown', onKey)
      wasFullscreen.current = true
      return () => window.removeEventListener('keydown', onKey)
    }
    if (wasFullscreen.current) {
      wasFullscreen.current = false
      openRef.current?.focus()
    }
  }, [fullscreen])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">The Tabernacle</h2>
        <button
          ref={openRef}
          onClick={() => setFullscreen(true)}
          aria-label="Full screen"
          title="Full screen"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div
        role={fullscreen ? 'dialog' : undefined}
        aria-modal={fullscreen ? true : undefined}
        aria-label={fullscreen ? 'The Tabernacle' : undefined}
        className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-[var(--color-surface)]' : 'flex flex-col'}
      >
        {fullscreen && (
          <div className="flex items-center justify-between border-b border-[var(--color-theme-border)] px-3 py-2">
            <span className="text-sm font-semibold">The Tabernacle</span>
            <button
              ref={closeRef}
              onClick={() => setFullscreen(false)}
              aria-label="Close full screen"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
        <div
          className={
            fullscreen
              ? 'relative min-h-0 flex-1 bg-[var(--color-surface-alt)]'
              : 'relative h-[420px] w-full overflow-hidden rounded-md border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)]'
          }
        >
          <iframe
            ref={setIframe}
            src={viewerSrc(spot)}
            title="The Tabernacle, 3D view"
            className="h-full w-full border-0"
            allow="fullscreen"
          />
          {status === 'loading' && (
            <div className="pointer-events-none absolute inset-0 flex animate-pulse items-center justify-center text-sm text-[var(--color-text-secondary)]">
              Loading the Tabernacle…
            </div>
          )}
          {status === 'failed' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-surface-alt)] text-sm text-[var(--color-text-secondary)]">
              <span>The 3D view couldn't load.</span>
              <a href="/tabernacle/" target="_blank" rel="noreferrer" className="underline">
                Open it in a new tab
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
