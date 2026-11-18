import { useEffect, useRef, useState } from 'react'
import { Check, Circle, Loader2, MessageCircleQuestion, Play } from 'lucide-react'
import { emitAsk, emitTrackComplete } from '@/lib/apologeticsEvents'
import { listApologeticsTracks } from '@/lib/modeData'
import { createPlayer, type ShortPlayer } from '@/lib/youtubePlayer'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { ApologeticsShort, ApologeticsTrack, ApologeticsTrackArtifactParams, ModeParams } from '@/types/session'

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-full border border-[var(--color-theme-border)] px-3 py-1.5 text-sm transition-colors hover:border-[var(--color-theme-accent)] hover:bg-[var(--color-surface-alt)] disabled:cursor-not-allowed disabled:opacity-50'
const CHIP =
  'rounded-full border border-[var(--color-theme-border)] px-2 py-0.5 text-xs hover:border-[var(--color-theme-accent)] hover:bg-[var(--color-surface-alt)]'

/** Defend the Faith: one track's playlist — a YouTube player for the
 * selected short, its actions and further reading, and the track's shorts
 * with progress. Progress is saved in the shown session's modeParams (the
 * `?session=` URL param, as TabernacleArtifact reads it). */
export function ApologeticsTrackArtifact({ trackId }: ApologeticsTrackArtifactParams) {
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get('session'))
  const session = useSessionsStore((s) => (sessionId ? s.sessions[sessionId] : undefined))
  const updateModeParams = useSessionsStore((s) => s.updateModeParams)
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const [tracks, setTracks] = useState<ApologeticsTrack[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // Without an apologetics session (e.g. opened from elsewhere), progress is local only.
  const [localParams, setLocalParams] = useState<ModeParams>({})
  const ownSession = session?.mode === 'apologetics' ? session : undefined
  const modeParams = ownSession ? ownSession.modeParams : localParams

  useEffect(() => {
    let cancelled = false
    listApologeticsTracks().then(
      (t) => !cancelled && setTracks(t),
      () => !cancelled && setLoadFailed(true)
    )
    return () => {
      cancelled = true
    }
  }, [])

  const track = tracks?.find((t) => t.id === trackId)
  const uploaded = track?.shorts.filter((s) => s.youtube_id) ?? []
  const watched = (modeParams.watchedShorts ?? []).filter((n) => uploaded.some((s) => s.number === n))
  const current =
    uploaded.find((s) => s.number === modeParams.currentShort) ??
    uploaded.find((s) => !watched.includes(s.number)) ??
    uploaded[0]

  function patch(p: Partial<ModeParams>) {
    if (ownSession) updateModeParams(ownSession.id, p)
    else setLocalParams((prev) => ({ ...prev, ...p }))
  }

  // --- player -------------------------------------------------------------
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<ShortPlayer | null>(null)
  const shownIdRef = useRef<string | null>(null)
  const [errorFor, setErrorFor] = useState<number | null>(null)
  // The player could not be created at all (API or iframe blocked): every
  // short gets the "Watch on YouTube" fallback, not just the first.
  const [playerUnavailable, setPlayerUnavailable] = useState(false)
  const unmountedRef = useRef(false)
  const currentId = current?.youtube_id ?? null
  const currentNumber = current?.number ?? null
  // Callbacks registered with the player read the latest render through this.
  const latest = useRef<{ markWatched: (n: number) => void; currentNumber: number | null; currentId: string | null }>({
    markWatched: () => {},
    currentNumber,
    currentId,
  })

  // Show `id` in a ready player. The selection changes only when the user
  // picks a row, so the new short plays.
  function show(player: ShortPlayer, id: string) {
    if (shownIdRef.current === id) return
    player.load(id)
    shownIdRef.current = id
  }

  useEffect(() => {
    if (!currentId || !hostRef.current) return
    if (playerRef.current) {
      show(playerRef.current, currentId)
      return
    }
    if (shownIdRef.current) return // creation already in flight
    shownIdRef.current = currentId
    createPlayer(hostRef.current, currentId, {
      // 90% actually played, or the end: the short counts as watched.
      watched: () => {
        const n = latest.current.currentNumber
        if (n !== null) latest.current.markWatched(n)
      },
      error: () => setErrorFor(latest.current.currentNumber),
    }).then(
      (p) => {
        if (unmountedRef.current) {
          p.destroy()
          return
        }
        playerRef.current = p
        // The user may have picked another short while it was loading.
        if (latest.current.currentId) show(p, latest.current.currentId)
      },
      () => {
        if (!unmountedRef.current) setPlayerUnavailable(true)
      }
    )
  }, [currentId, currentNumber])

  useEffect(() => {
    // Reset on (re)mount: StrictMode runs this cleanup once in development.
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      playerRef.current?.destroy()
    }
  }, [])

  // --- actions ------------------------------------------------------------
  function markWatched(n: number) {
    if (watched.includes(n)) return
    const nowWatched = [...watched, n]
    // Stay on the short just watched, so "Ask about this" is right there;
    // the user moves on by picking the next short in the list.
    patch({ watchedShorts: nowWatched, currentShort: n })
    if (track && sessionId && nowWatched.length === uploaded.length) {
      emitTrackComplete({ sessionId, trackTitle: track.title })
    }
  }
  useEffect(() => {
    latest.current = { markWatched, currentNumber, currentId }
  })

  function select(s: ApologeticsShort) {
    patch({ currentShort: s.number })
  }

  // --- render -------------------------------------------------------------
  if (loadFailed) return <p className="p-4 text-sm">Couldn't load this track — please try again later.</p>
  if (!tracks) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-[var(--color-text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    )
  }
  if (!track || !current) return <p className="p-4 text-sm">This track is no longer available.</p>

  const isWatched = watched.includes(current.number)
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{track.title}</h2>
        <span className="shrink-0 text-sm text-[var(--color-text-secondary)]">{`${watched.length} / ${uploaded.length}`}</span>
      </div>

      <div className="relative mx-auto aspect-[9/16] h-[min(42vh,400px)] max-w-full shrink-0 overflow-hidden rounded-lg bg-black">
        <div className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full">
          <div ref={hostRef} />
        </div>
        {(playerUnavailable || errorFor === current.number) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90 p-4 text-center text-sm text-white">
            <p>This short can't play here.</p>
            <a
              href={`https://www.youtube.com/shorts/${current.youtube_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Watch on YouTube
            </a>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{current.title}</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className={BUTTON}
            disabled={!isWatched}
            title={isWatched ? undefined : 'Watch the short first'}
            onClick={() => sessionId && emitAsk({ sessionId, shortNumber: current.number, title: current.title })}
          >
            <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
            Ask about this
          </button>
          {!isWatched && (
            <button className={BUTTON} onClick={() => markWatched(current.number)}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Mark watched
            </button>
          )}
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-[var(--color-theme-border)] border-t border-[var(--color-theme-border)]">
        {track.shorts.map((s) => {
          const done = watched.includes(s.number)
          const here = s.number === current.number
          const icon = done ? (
            <Check className="h-4 w-4 shrink-0 text-[var(--color-theme-accent)]" aria-label="watched" />
          ) : here ? (
            <Play className="h-4 w-4 shrink-0" aria-label="selected" />
          ) : (
            <Circle className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          )
          const body = (
            <>
              {icon}
              <img src={s.thumbnail} alt="" className="h-8 w-[18px] shrink-0 rounded object-cover" loading="lazy" />
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
            </>
          )
          return (
            <li key={s.number}>
              {s.youtube_id ? (
                <button
                  className={`flex w-full items-center gap-2 px-1 py-1.5 text-left text-sm hover:bg-[var(--color-surface-alt)] ${here ? 'font-semibold' : ''}`}
                  aria-current={here ? 'true' : undefined}
                  onClick={() => select(s)}
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-center gap-2 px-1 py-1.5 text-sm opacity-50">
                  {body}
                  <span className="shrink-0 text-xs">Coming soon</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {current.further_reading.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--color-theme-border)] pt-2 text-xs text-[var(--color-text-secondary)]">
          <span>Further reading:</span>
          {current.further_reading.some((item) => item.refs.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {current.further_reading.flatMap((item, i) =>
                item.refs.map((ref, j) => (
                  <button
                    key={`${i}-${j}`}
                    className={CHIP}
                    onClick={() => void openArtifact({ type: 'interlinear', label: `${ref} ▸`, params: { reference: ref } })}
                  >
                    {item.refs.length > 1 ? `${item.text} (${j + 1})` : item.text}
                  </button>
                ))
              )}
            </div>
          )}
          {current.further_reading.some((item) => item.refs.length === 0) && (
            <ul className="list-disc space-y-0.5 pl-4">
              {current.further_reading.map((item, i) => (item.refs.length === 0 ? <li key={i}>{item.text}</li> : null))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
