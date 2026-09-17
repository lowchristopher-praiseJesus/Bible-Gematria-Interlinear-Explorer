import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Pause, Play } from 'lucide-react'
import { postDevotionalAudio } from '@/lib/chatApi'

export interface DevotionalListenOverlayProps {
  reference: string
  text: string
  open: boolean
  onClose: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

export function DevotionalListenOverlay({ reference, text, open, onClose }: DevotionalListenOverlayProps) {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus('loading')
    setAudioUrl(null)
    setIsPlaying(false)
    postDevotionalAudio(reference, text)
      .then((res) => {
        if (cancelled) return
        setAudioUrl(res.audio_url)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, reference, text])

  function stopScrollSync() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  function tick() {
    const audio = audioRef.current
    const container = textRef.current
    if (audio && container && audio.duration > 0) {
      const ratio = audio.currentTime / audio.duration
      const maxScroll = container.scrollHeight - container.clientHeight
      container.scrollTop = ratio * maxScroll
    }
    if (audio && !audio.paused) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  // React state (isPlaying) is the source of truth for which action to
  // take, not audio.paused — keeps this correct even where the DOM
  // property lags (or, in tests, isn't really implemented).
  function handleTogglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      stopScrollSync()
    } else {
      audio.play()
      setIsPlaying(true)
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  function handleEnded() {
    setIsPlaying(false)
    stopScrollSync()
  }

  // Autoplay once the audio is ready, so the user doesn't have to press
  // Play after clicking Listen. play() is called after an async fetch
  // resolves — outside the click's original call stack — so a browser's
  // autoplay policy can still block it; if so, leave isPlaying false and
  // let the user start it manually instead of failing silently.
  useEffect(() => {
    if (status !== 'ready' || !audioUrl) return
    const audio = audioRef.current
    if (!audio) return
    audio
      .play()
      .then(() => {
        setIsPlaying(true)
        rafRef.current = requestAnimationFrame(tick)
      })
      .catch(() => {})
  }, [status, audioUrl])

  function handleDone() {
    audioRef.current?.pause()
    setIsPlaying(false)
    stopScrollSync()
    onClose()
  }

  useEffect(() => stopScrollSync, [])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) handleDone() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 devotional-listen-bg" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col items-center gap-4 p-8 focus:outline-none devotional-listen-bg"
        >
          <Dialog.Title className="text-sm font-semibold tracking-tight text-white/90">
            {reference}
          </Dialog.Title>

          {status === 'loading' && (
            <div className="flex-1 flex items-center justify-center text-white/80 text-sm">
              Preparing audio…
            </div>
          )}

          {status === 'error' && (
            <div className="flex-1 flex items-center justify-center text-white/90 text-sm">
              Audio unavailable — try again later.
            </div>
          )}

          {status === 'ready' && audioUrl && (
            <>
              <audio ref={audioRef} src={audioUrl} preload="auto" onEnded={handleEnded} />
              <div
                ref={textRef}
                className="flex-1 w-full max-w-2xl overflow-y-auto text-white text-lg leading-relaxed whitespace-pre-wrap px-4"
              >
                {text}
              </div>
              <button
                type="button"
                onClick={handleTogglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Play className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            </>
          )}

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Done"
              className="text-xs px-3 py-1.5 rounded border border-white/30 text-white/90 hover:bg-white/10"
            >
              Done
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
