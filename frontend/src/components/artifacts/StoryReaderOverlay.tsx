import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, ArrowRight, ImageOff } from 'lucide-react'
import { streamStoryIllustrations } from '@/lib/chatApi'
import { canIllustrate, normalizeStory, storySignature } from '@/lib/storyArtifact'
import type { StoryArtifactParams, StoryCover, StoryPage } from '@/types/session'

export interface StoryReaderOverlayProps {
  artifact: StoryArtifactParams
  open: boolean
  onClose: () => void
}

const AGE_RANGE_LABELS: Record<string, string> = {
  '3-6': 'Ages 3-6',
  '7-8': 'Ages 7-8',
  '9-10': 'Ages 9-10',
}

export function StoryReaderOverlay({ artifact, open, onClose }: StoryReaderOverlayProps) {
  // `artifact` is a fresh object on every ArtifactPane re-render (it
  // spreads StoryArtifact's props), so everything below keys on the
  // story's *content* signature, never the object reference — otherwise
  // any unrelated parent re-render would reset the reader to the cover
  // and cancel/restart the illustration fetch.
  const signature = storySignature(artifact.title, normalizeStory(artifact))
  // Stable for as long as the content is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const story = useMemo(() => normalizeStory(artifact), [signature])
  const illustratable = canIllustrate(story)

  const [cover, setCover] = useState<StoryCover>(story.cover)
  const [pages, setPages] = useState<StoryPage[]>(story.pages)
  const [pageIndex, setPageIndex] = useState(0)
  const [failedIndexes, setFailedIndexes] = useState<Set<number>>(new Set())

  // Reset to the cover each time the reader opens, or when it is showing a
  // genuinely different story — adjusted during render (React's
  // recommended "reset state when a prop changes" pattern) rather than in
  // an effect, so there's no extra render showing stale state.
  const resetKey = open ? signature : null
  const [lastResetKey, setLastResetKey] = useState<string | null>(null)
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey)
    if (resetKey !== null) {
      setCover(story.cover)
      setPages(story.pages)
      setPageIndex(0)
      setFailedIndexes(new Set())
    }
  }

  useEffect(() => {
    if (!open || !illustratable) return
    const needsImages = !story.cover.image_url || story.pages.some((p) => !p.image_url)
    if (!needsImages) return

    let cancelled = false
    const resolved = new Set<number>()

    async function run() {
      try {
        for await (const item of streamStoryIllustrations({
          characters: story.characters,
          cover_scene: story.cover.scene,
          page_scenes: story.pages.map((p) => p.scene),
        })) {
          if (cancelled) return
          if (item.index === -1) {
            if (item.image_url) {
              const url = item.image_url
              resolved.add(-1)
              setCover((c) => ({ ...c, image_url: url }))
            } else {
              setFailedIndexes((prev) => new Set(prev).add(-1))
            }
            continue
          }
          if (item.image_url) {
            const url = item.image_url
            resolved.add(item.index)
            setPages((prev) => prev.map((p, i) => (i === item.index ? { ...p, image_url: url } : p)))
          } else {
            setFailedIndexes((prev) => new Set(prev).add(item.index))
          }
        }
      } catch {
        // A whole-request network failure or a malformed line mid-stream —
        // handled below exactly like a stream that ended early.
      }
      // A cancelled run (closed, or superseded by a different story) must
      // not touch state at all.
      if (cancelled) return
      // Anything the stream never delivered will never arrive: show it as
      // unavailable rather than leaving its spinner up forever.
      const missing: number[] = []
      if (!story.cover.image_url && !resolved.has(-1)) missing.push(-1)
      story.pages.forEach((p, i) => {
        if (!p.image_url && !resolved.has(i)) missing.push(i)
      })
      if (missing.length) {
        setFailedIndexes((prev) => {
          const next = new Set(prev)
          for (const i of missing) next.add(i)
          return next
        })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [open, story, illustratable])

  const totalPages = pages.length
  const onCover = pageIndex === 0
  const currentPage = onCover ? null : pages[pageIndex - 1]
  const currentImageUrl = onCover ? cover.image_url : (currentPage?.image_url ?? null)
  // A story with nothing to illustrate (a legacy, pre-illustration one) is
  // never fetched for, so its pages go straight to text-only.
  const currentFailed = !illustratable || failedIndexes.has(onCover ? -1 : pageIndex - 1)

  function goPrev() {
    setPageIndex((i) => Math.max(0, i - 1))
  }
  function goNext() {
    setPageIndex((i) => Math.min(totalPages, i + 1))
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, totalPages])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 story-reader-bg" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col items-center gap-4 p-6 focus:outline-none story-reader-bg"
        >
          <Dialog.Title className="text-sm font-semibold tracking-tight text-white/90">
            {artifact.title}
          </Dialog.Title>

          <div className="flex-1 min-h-0 w-full max-w-2xl flex flex-col items-center gap-4 overflow-y-auto">
            <div className="w-full aspect-[4/3] rounded-xl bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
              {currentImageUrl ? (
                <img src={currentImageUrl} alt="" className="w-full h-full object-cover" />
              ) : currentFailed ? (
                <div role="img" aria-label="Illustration unavailable" className="flex items-center justify-center">
                  <ImageOff className="h-8 w-8 text-white/50" aria-hidden="true" />
                </div>
              ) : (
                <div
                  role="status"
                  aria-label="Loading illustration"
                  className="h-8 w-8 rounded-full border-2 border-white/40 border-t-white animate-spin"
                />
              )}
            </div>

            {onCover ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/70">
                <span className="px-2 py-0.5 rounded-full border border-white/30">
                  {AGE_RANGE_LABELS[artifact.age_range] ?? artifact.age_range}
                </span>
                {(artifact.themes ?? []).map((theme) => (
                  <span key={theme} className="px-2 py-0.5 rounded-full border border-white/30">
                    {theme}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-white text-lg leading-relaxed whitespace-pre-wrap px-2">
                {currentPage?.text}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={goPrev}
              disabled={onCover}
              aria-label="Previous page"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white transition-opacity disabled:opacity-30 hover:bg-white/30"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="text-xs text-white/70">{onCover ? 'Cover' : `${pageIndex} / ${totalPages}`}</span>
            <button
              type="button"
              onClick={goNext}
              disabled={pageIndex >= totalPages}
              aria-label="Next page"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white transition-opacity disabled:opacity-30 hover:bg-white/30"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

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
