// postMessage bridge between the chat UI and the same-origin 3D tabernacle
// viewer iframe (/tabernacle/). Module-level state: there is only ever one
// live viewer window.

export const SPOT_IDS: readonly string[] = [
  'boards', 'table', 'menorah', 'incense', 'ark', 'laver', 'altar', 'gate', 'door', 'veil',
]

export type ViewerEvent =
  | { type: 'tabernacle:ready' }
  | { type: 'tabernacle:spot'; spot: string }
  | { type: 'tabernacle:ask'; spot: string }
  | { type: 'tabernacle:ref'; ref: string }

export type GotoTarget = { spot: string } | { station: number }

/** iframe src for the viewer; an unknown spot yields no hash. */
export function viewerSrc(spot: string | null): string {
  const base = '/tabernacle/?embed=1'
  return spot && SPOT_IDS.includes(spot) ? `${base}#spot=${spot}` : base
}

/** Validate a window `message` event as coming from our viewer. */
export function parseViewerMessage(e: MessageEvent, viewer: Window | null): ViewerEvent | null {
  if (e.origin !== window.location.origin) return null
  if (!viewer || e.source !== viewer) return null
  const d = e.data as { type?: unknown; spot?: unknown; ref?: unknown } | null
  if (!d || typeof d !== 'object') return null
  switch (d.type) {
    case 'tabernacle:ready':
      return { type: 'tabernacle:ready' }
    case 'tabernacle:spot':
    case 'tabernacle:ask':
      if (typeof d.spot !== 'string' || !SPOT_IDS.includes(d.spot)) return null
      return { type: d.type, spot: d.spot }
    case 'tabernacle:ref':
      if (typeof d.ref !== 'string' || !d.ref) return null
      return { type: 'tabernacle:ref', ref: d.ref }
    default:
      return null
  }
}

let viewer: Window | null = null
let ready = false
let pending: GotoTarget | null = null
const listeners = new Set<(e: ViewerEvent) => void>()

function post(t: GotoTarget) {
  viewer?.postMessage({ type: 'tabernacle:goto', ...t }, window.location.origin)
}

/** Register the (possibly re-mounted) viewer window; it is not ready until it says so. */
export function registerViewer(win: Window | null): void {
  viewer = win
  ready = false
  if (!win) pending = null
}

export function markViewerReady(): void {
  ready = true
  if (pending) {
    const t = pending
    pending = null
    post(t)
  }
}

/** Send the camera to a spot/station; held until ready (latest wins). */
export function sendGoto(t: GotoTarget): void {
  if (!viewer) return
  if (!ready) {
    pending = t
    return
  }
  post(t)
}

export function onViewerEvent(fn: (e: ViewerEvent) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function emitViewerEvent(e: ViewerEvent): void {
  listeners.forEach((fn) => fn(e))
}

/** "Exodus 30:18–19" -> "Exodus 30:18"; "Exodus 25:31, 37" -> "Exodus 25:31". */
export function firstVerse(ref: string): string {
  return ref.split(/[–—-]|,/)[0].trim()
}

let labelsPromise: Promise<Record<string, string>> | null = null

/** Spot id -> display label, fetched once. A failure resolves to {} and is not cached. */
export function loadSpotLabels(): Promise<Record<string, string>> {
  if (!labelsPromise) {
    const p = fetch('/tabernacle/data/spots.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Record<string, { label?: string }>) => {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(d)) if (v && typeof v.label === 'string') out[k] = v.label
        return out
      })
      .catch(() => {
        if (labelsPromise === p) labelsPromise = null
        return {} as Record<string, string>
      })
    labelsPromise = p
  }
  return labelsPromise
}

/** Test hook: forget the cached labels. */
export function resetSpotLabels(): void {
  labelsPromise = null
}
