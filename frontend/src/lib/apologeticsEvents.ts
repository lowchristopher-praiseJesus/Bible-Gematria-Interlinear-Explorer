// Defend the Faith: the playlist panel (an artifact) and ChatPane live in
// different trees, so the panel announces "ask about this short" and "track
// finished" here and ChatPane, which owns sending messages, listens.

export interface AskEvent {
  sessionId: string
  shortNumber: number
  /** The short's YouTube title — how the question names it. */
  title: string
}

export interface TrackCompleteEvent {
  sessionId: string
  trackTitle: string
}

const askListeners = new Set<(e: AskEvent) => void>()
const completeListeners = new Set<(e: TrackCompleteEvent) => void>()

export function emitAsk(e: AskEvent): void {
  askListeners.forEach((fn) => fn(e))
}

export function onAsk(fn: (e: AskEvent) => void): () => void {
  askListeners.add(fn)
  return () => askListeners.delete(fn)
}

export function emitTrackComplete(e: TrackCompleteEvent): void {
  completeListeners.forEach((fn) => fn(e))
}

export function onTrackComplete(fn: (e: TrackCompleteEvent) => void): () => void {
  completeListeners.add(fn)
  return () => completeListeners.delete(fn)
}
