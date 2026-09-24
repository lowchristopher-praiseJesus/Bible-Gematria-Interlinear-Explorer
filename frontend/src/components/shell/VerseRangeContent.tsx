import { useEffect, useMemo, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { fetchChapter } from '@/lib/chatApi'
import { decodeHtmlEntities } from '@/lib/decodeHtmlEntities'
import { pickDefaultTranslationCode, translationLabel } from '@/lib/translationLabel'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useTranslationSettingsStore } from '@/store/useTranslationSettingsStore'
import { VerseFullscreen, type VerseFullscreenVerse } from './VerseFullscreen'
import type { ChapterResponse } from '@/types/api'

type Status = 'idle' | 'loading' | 'ready' | 'error'

function collectTranslationCodes(data: ChapterResponse): string[] {
  const codes = new Set<string>()
  for (const verse of data.verses) {
    for (const code of Object.keys(verse.translations)) codes.add(code)
  }
  return Array.from(codes)
}

/** Merges a full multi-translation fetch onto the already-displayed fast
 * (KJV-only) data — adding every other translation without disturbing the
 * text the reader already has on screen, in case the two sources differ
 * slightly in wording for the same translation code. */
function mergeChapterResponses(fast: ChapterResponse, full: ChapterResponse): ChapterResponse {
  const fullByVerse = new Map(full.verses.map((v) => [v.versenumber, v]))
  return {
    ...full,
    verses: fast.verses.map((v) => {
      const fullVerse = fullByVerse.get(v.versenumber)
      return fullVerse ? { ...fullVerse, translations: { ...fullVerse.translations, ...v.translations } } : v
    }),
  }
}

interface Props {
  /** A chapter, single verse, or verse-range reference — whatever
   * fetchChapter()/the `/passage` endpoint accepts (e.g. "JOB 1",
   * "JHN 3:16", "Luke 15:11-32"). */
  reference: string
  /** Shown in the header in place of the reference itself. Defaults to
   * `reference`. */
  label?: string
}

/**
 * The verse-range reading UI shared by every mode that shows Bible text
 * inline (Reading Plan / Parable Study chapters via ChapterReadingBubble,
 * and Deep Study's passage box): a translation switcher, a maximize
 * (fullscreen compare) button, and each verse's number linking to its
 * interlinear view. Fetches on mount — a caller that wants to defer the
 * fetch (ChapterReadingBubble's collapsed pill) does so by not mounting
 * this until it's ready to load.
 */
export function VerseRangeContent({ reference, label }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  // Tracks the background fetch that fills in every other translation
  // after the fast KJV-only paint — independent of `status` so it never
  // re-triggers the loading view the reader is already past.
  const [backgroundStatus, setBackgroundStatus] = useState<Status>('idle')
  const [data, setData] = useState<ChapterResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // null means "no manual pick yet" — the displayed translation is then
  // derived from the user's default-translation setting below, so it
  // upgrades on its own once the background fetch adds more translations
  // (the fast paint is KJV-only) without needing an effect to sync it.
  const [manualTranslation, setManualTranslation] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const preferredAbbr = useTranslationSettingsStore((s) => s.defaultTranslationAbbr)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setBackgroundStatus('idle')
    setData(null)
    setError(null)
    setManualTranslation(null)

    async function load() {
      let fastResult: ChapterResponse
      try {
        fastResult = await fetchChapter(reference, { fast: true })
        if (cancelled) return
        setData(fastResult)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
        return
      }

      // The reader already has the KJV text to read — keep fetching every
      // other translation in the background instead of making them wait.
      setBackgroundStatus('loading')
      try {
        const fullResult = await fetchChapter(reference)
        if (cancelled) return
        setData((prev) => mergeChapterResponses(prev ?? fastResult, fullResult))
        setBackgroundStatus('ready')
      } catch {
        // The KJV text already on screen is still perfectly usable; a
        // failed background fetch just means no other translations show up.
        if (cancelled) return
        setBackgroundStatus('error')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [reference])

  const passageLabel = label ?? reference
  const translationCodes = useMemo(() => (data ? collectTranslationCodes(data) : []), [data])
  const translation =
    manualTranslation && translationCodes.includes(manualTranslation)
      ? manualTranslation
      : translationCodes.length > 0
        ? pickDefaultTranslationCode(translationCodes, preferredAbbr)
        : null

  const fullscreenVerses: VerseFullscreenVerse[] = useMemo(
    () => (data ? data.verses.map((v) => ({ reference: v.ref, translations: v.translations })) : []),
    [data]
  )

  return (
    <div className="border border-[var(--color-theme-border)] rounded-lg p-2 max-w-md">
      {(status === 'idle' || status === 'loading') && (
        <div className="text-xs text-[var(--color-text-secondary)]">Loading…</div>
      )}
      {status === 'error' && <div className="text-xs text-red-600">{error}</div>}
      {status === 'ready' && data && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-xs">{passageLabel}</span>
            {backgroundStatus === 'loading' && (
              <span className="text-[10px] text-[var(--color-text-secondary)]">More translations loading…</span>
            )}
            <div className="flex items-center gap-1.5">
              {translationCodes.length > 0 && translation && (
                <select
                  value={translation}
                  onChange={(e) => setManualTranslation(e.target.value)}
                  aria-label="Translation"
                  className="text-xs border border-[var(--color-theme-border)] rounded px-1.5 py-0.5 bg-[var(--color-surface)]"
                >
                  {translationCodes.map((code) => (
                    <option key={code} value={code}>
                      {translationLabel(code)}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                aria-label={`Compare all verses in ${passageLabel}`}
                className="text-xs px-1.5 py-0.5 rounded border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
              >
                ⛶
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto text-sm">
            {data.verses.map((verse) => (
              <div key={verse.versenumber} className="flex items-baseline gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    openArtifact({
                      type: 'interlinear',
                      label: `${verse.ref} ▸`,
                      params: { versenumber: verse.versenumber },
                    })
                  }
                  aria-label={`Open ${verse.ref} in the original language`}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[var(--color-theme-accent)]/30 bg-[var(--color-theme-accent)]/10 px-1.5 py-0.5 leading-none text-[var(--color-theme-accent)] hover:bg-[var(--color-theme-accent)]/20 text-xs font-mono"
                >
                  <BookOpen className="h-2.5 w-2.5" aria-hidden="true" />
                  {verse.vnum}
                </button>
                <span>
                  {translation && verse.translations[translation]
                    ? decodeHtmlEntities(verse.translations[translation])
                    : <span className="italic text-[var(--color-text-secondary)]">(translation unavailable)</span>}
                </span>
              </div>
            ))}
          </div>
          {translation && (
            <VerseFullscreen
              verses={fullscreenVerses}
              initialTranslationCode={translation}
              open={fullscreen}
              onClose={() => setFullscreen(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}
