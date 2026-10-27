import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2 } from 'lucide-react'
import {
  emitViewerEvent, markViewerReady, parseViewerMessage, registerViewer, viewerSrc,
} from '@/lib/tabernacleBridge'
import { TabernacleOverlay } from './TabernacleOverlay'
import type { TabernacleArtifactParams } from '@/types/session'

const LOAD_TIMEOUT_MS = 15000

export function TabernacleArtifact({ spot }: TabernacleArtifactParams) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [fullscreen, setFullscreen] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches
  )
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null)
  const [paneSlot, setPaneSlot] = useState<HTMLDivElement | null>(null)
  const [fullSlot, setFullSlot] = useState<HTMLDivElement | null>(null)
  // One persistent host element holds the iframe; it is re-parented between
  // the pane slot and the overlay slot so the document never has two viewers.
  const [host] = useState(() => {
    const el = document.createElement('div')
    el.className = 'h-full w-full'
    return el
  })

  useEffect(() => {
    const target = fullscreen && fullSlot ? fullSlot : paneSlot
    if (target && host.parentElement !== target) target.appendChild(host)
  }, [fullscreen, fullSlot, paneSlot, host])

  useEffect(() => () => host.remove(), [host])

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

  useEffect(() => () => registerViewer(null), [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">The Tabernacle</h2>
        <button
          onClick={() => setFullscreen(true)}
          aria-label="Full screen"
          title="Full screen"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div
        ref={setPaneSlot}
        className="relative h-[420px] w-full overflow-hidden rounded-md border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)]"
      >
        {status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 z-10 flex animate-pulse items-center justify-center text-sm text-[var(--color-text-secondary)]">
            The Tabernacle
          </div>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--color-surface-alt)] text-sm text-[var(--color-text-secondary)]">
            <span>The 3D view couldn't load.</span>
            <a href="/tabernacle/" target="_blank" rel="noreferrer" className="underline">
              Open it in a new tab
            </a>
          </div>
        )}
      </div>
      {createPortal(
        <iframe
          ref={setIframe}
          src={viewerSrc(spot)}
          title="The Tabernacle, 3D view"
          className="h-full w-full border-0"
          allow="fullscreen"
          onLoad={(e) => registerViewer(e.currentTarget.contentWindow)}
        />,
        host
      )}
      <TabernacleOverlay open={fullscreen} onClose={() => setFullscreen(false)} slotRef={setFullSlot} />
    </div>
  )
}
