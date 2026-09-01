import { useMemo, useState } from 'react'
import { fetchChapter } from '@/lib/chatApi'
import { decodeHtmlEntities } from '@/lib/decodeHtmlEntities'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { ChapterResponse } from '@/types/api'
import type { ArtifactLink } from '@/types/session'

interface Props {
  link: ArtifactLink
}

type Status = 'idle' | 'loading' | 'ready' | 'error'

function translationLabel(code: string): string {
  const abbr = code.split('-')[1] ?? code
  return abbr.toUpperCase()
}

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

export function ChapterReadingBubble({ link }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  // Tracks the background fetch that fills in every other translation
  // after the fast KJV-only paint — independent of `status` so it never
  // re-triggers the loading view the reader is already past.
  const [backgroundStatus, setBackgroundStatus] = useState<Status>('idle')
  const [data, setData] = useState<ChapterResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [translation, setTranslation] = useState<string | null>(null)
  const openArtifact = useArtifactStore((s) => s.openArtifact)

  async function toggle() {
    setExpanded((prev) => !prev)
    if (status !== 'idle') return
    setStatus('loading')
    const reference = link.params.reference as string
    let fastResult: ChapterResponse
    try {
      fastResult = await fetchChapter(reference, { fast: true })
      setData(fastResult)
      const codes = collectTranslationCodes(fastResult)
      setTranslation(codes.find((c) => c.endsWith('-KJV')) ?? codes[0] ?? null)
      setStatus('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
      return
    }

    // The reader already has the KJV text to read — keep fetching every
    // other translation in the background instead of making them wait.
    setBackgroundStatus('loading')
    try {
      const fullResult = await fetchChapter(reference)
      setData((prev) => mergeChapterResponses(prev ?? fastResult, fullResult))
      setBackgroundStatus('ready')
    } catch {
      // The KJV text already on screen is still perfectly usable; a failed
      // background fetch just means no other translations show up.
      setBackgroundStatus('error')
    }
  }

  const label = link.label.replace(/\s*▸\s*$/, '')
  const passageLabel = label.replace(/^Read\s+/, '')
  const translationCodes = useMemo(() => (data ? collectTranslationCodes(data) : []), [data])

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="text-xs px-2 py-1 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface)]"
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {label}
      </button>

      {expanded && (
        <div className="mt-2 border border-[var(--color-theme-border)] rounded-lg p-2 max-w-md">
          {status === 'loading' && (
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
                {translationCodes.length > 0 && translation && (
                  <select
                    value={translation}
                    onChange={(e) => setTranslation(e.target.value)}
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
                      className="shrink-0 text-[var(--color-theme-accent)] hover:underline text-xs font-mono"
                    >
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
