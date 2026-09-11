import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { decodeHtmlEntities } from '@/lib/decodeHtmlEntities'
import { fetchInterlinear } from '@/lib/chatApi'
import {
  useVerseFontScaleStore,
  MIN_VERSE_FONT_SCALE,
  MAX_VERSE_FONT_SCALE,
} from '@/store/useVerseFontScaleStore'
import type { ExplorerResponse } from '@/types/api'

export interface VerseFullscreenVerse {
  reference: string
  translations: Record<string, string>
}

export interface VerseFullscreenProps {
  verses: VerseFullscreenVerse[]
  initialTranslationCode: string
  open: boolean
  onClose: () => void
}

const ORIGINAL_LANGUAGE = '__original-language__'
const MAX_EXTRA_PANES = 2

type LoadStatus = 'loading' | 'ready' | 'error'

// Base sizes (rem) the panes render at when the font scale is 1.
const BASE_TRANSLATION_REM = 0.875
const BASE_ORIGINAL_TEXT_REM = 1.125
const BASE_WORD_ROW_REM = 0.75
const BASE_REF_LABEL_REM = 0.7

function rem(base: number, scale: number): string {
  return `${base * scale}rem`
}

function translationLabel(code: string): string {
  const abbr = code.split('-')[1] ?? code
  return abbr.toUpperCase()
}

function stripStrongsTags(html: string): string {
  return html.replace(/<st SN="[^"]*">/g, '').replace(/<\/st>/g, '')
}

function collectCodes(verses: VerseFullscreenVerse[]): string[] {
  const codes = new Set<string>()
  for (const verse of verses) {
    for (const code of Object.keys(verse.translations)) codes.add(code)
  }
  return Array.from(codes)
}

function findTopVerseIndex(container: HTMLElement): number {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-verse-idx]'))
  const containerTop = container.getBoundingClientRect().top
  let index = 0
  for (const row of rows) {
    const relativeTop = row.getBoundingClientRect().top - containerTop
    if (relativeTop > 1) break
    index = Number(row.dataset.verseIdx)
  }
  return index
}

function scrollPaneToVerseIndex(container: HTMLElement, index: number) {
  const row = container.querySelector<HTMLElement>(`[data-verse-idx="${index}"]`)
  if (!row) return
  container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top
}

function dialogTitle(verses: VerseFullscreenVerse[]): string {
  if (verses.length === 0) return 'Verse'
  if (verses.length === 1) return verses[0].reference || 'Verse'
  const first = verses[0].reference
  const last = verses[verses.length - 1].reference
  return `${verses.length} verses (${first} – ${last})`
}

function TranslationPane({
  verses,
  code,
  scale,
}: {
  verses: VerseFullscreenVerse[]
  code: string
  scale: number
}) {
  if (verses.length === 1) {
    return (
      <p style={{ fontSize: rem(BASE_TRANSLATION_REM, scale) }}>
        {decodeHtmlEntities(verses[0].translations[code] ?? '')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {verses.map((verse, i) => (
        <p key={verse.reference} data-verse-idx={i} style={{ fontSize: rem(BASE_TRANSLATION_REM, scale) }}>
          <span
            className="font-semibold mr-1.5 text-[var(--color-theme-accent)]"
            style={{ fontSize: rem(BASE_REF_LABEL_REM, scale) }}
          >
            {verse.reference}
          </span>
          {decodeHtmlEntities(verse.translations[code] ?? '')}
        </p>
      ))}
    </div>
  )
}

function OriginalLanguageBlock({
  status,
  data,
  scale,
  showHeading,
  reference,
}: {
  status: LoadStatus
  data: ExplorerResponse | null
  scale: number
  showHeading: boolean
  reference: string
}) {
  if (status === 'loading') {
    return <p className="text-xs text-[var(--color-text-secondary)] italic">Loading original language…</p>
  }
  if (status === 'error' || !data) {
    return (
      <p className="text-xs text-[var(--color-text-secondary)] italic">
        Could not load the original language for {showHeading ? reference : 'this verse'}.
      </p>
    )
  }
  const { verse, kjvWords } = data
  return (
    <div className="flex flex-col gap-3">
      {showHeading && (
        <div
          className="font-semibold text-[var(--color-theme-accent)]"
          style={{ fontSize: rem(BASE_REF_LABEL_REM, scale) }}
        >
          {reference}
        </div>
      )}
      <div
        className="leading-loose"
        style={{
          fontSize: rem(BASE_ORIGINAL_TEXT_REM, scale),
          fontFamily: verse.language === 'Hebrew' ? 'TaameyFrank, serif' : 'inherit',
          direction: verse.language === 'Hebrew' ? 'rtl' : 'ltr',
        }}
        dangerouslySetInnerHTML={{ __html: verse.originalText }}
      />
      <div className="flex flex-col gap-1" style={{ fontSize: rem(BASE_WORD_ROW_REM, scale) }}>
        {kjvWords.map((w, i) => (
          <div key={i} className="flex items-baseline gap-2 border-b border-[var(--color-theme-border)] pb-1">
            <span className="font-mono px-1 rounded bg-[var(--color-surface-alt)]">{w.strongsNumber}</span>
            <span dangerouslySetInnerHTML={{ __html: stripStrongsTags(w.kjvText) }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function OriginalLanguagePane({
  verses,
  scale,
  dataByRef,
  errorByRef,
}: {
  verses: VerseFullscreenVerse[]
  scale: number
  dataByRef: Record<string, ExplorerResponse>
  errorByRef: Record<string, boolean>
}) {
  const showHeading = verses.length > 1
  return (
    <div className="flex flex-col gap-4">
      {verses.map((verse, i) => {
        const status: LoadStatus = errorByRef[verse.reference]
          ? 'error'
          : dataByRef[verse.reference]
            ? 'ready'
            : 'loading'
        return (
          <div key={verse.reference} data-verse-idx={i}>
            <OriginalLanguageBlock
              status={status}
              data={dataByRef[verse.reference] ?? null}
              scale={scale}
              showHeading={showHeading}
              reference={verse.reference}
            />
          </div>
        )
      })}
    </div>
  )
}

export function VerseFullscreen({
  verses,
  initialTranslationCode,
  open,
  onClose,
}: VerseFullscreenProps) {
  const codes = collectCodes(verses)
  const [extraPanes, setExtraPanes] = useState<string[]>([ORIGINAL_LANGUAGE])
  const [origData, setOrigData] = useState<Record<string, ExplorerResponse>>({})
  const [origErrors, setOrigErrors] = useState<Record<string, boolean>>({})
  const fetchedRefs = useRef<Set<string>>(new Set())
  const [syncScroll, setSyncScroll] = useState(true)
  const paneEls = useRef<Record<number, HTMLElement | null>>({})
  const isSyncingRef = useRef(false)

  const scale = useVerseFontScaleStore((s) => s.scale)
  const increaseFont = useVerseFontScaleStore((s) => s.increase)
  const decreaseFont = useVerseFontScaleStore((s) => s.decrease)

  const needsOriginal = extraPanes.includes(ORIGINAL_LANGUAGE)

  useEffect(() => {
    if (!needsOriginal) return
    for (const verse of verses) {
      const ref = verse.reference
      if (!ref || fetchedRefs.current.has(ref)) continue
      fetchedRefs.current.add(ref)
      fetchInterlinear(ref)
        .then((d) => setOrigData((prev) => ({ ...prev, [ref]: d })))
        .catch(() => setOrigErrors((prev) => ({ ...prev, [ref]: true })))
    }
  }, [needsOriginal, verses])

  function setPane(index: number, value: string) {
    setExtraPanes((panes) => panes.map((p, i) => (i === index ? value : p)))
  }

  function addPane() {
    setExtraPanes((panes) => {
      if (panes.length >= MAX_EXTRA_PANES) return panes
      const used = new Set([...panes])
      const nextCode = codes.find((c) => c !== initialTranslationCode && !used.has(c))
      return [...panes, nextCode ?? ORIGINAL_LANGUAGE]
    })
  }

  function removePane(index: number) {
    setExtraPanes((panes) => panes.filter((_, i) => i !== index))
  }

  function syncPanesTo(sourceIndex: number) {
    if (!syncScroll || isSyncingRef.current || verses.length <= 1) return
    const source = paneEls.current[sourceIndex]
    if (!source) return
    const targetIndex = findTopVerseIndex(source)
    isSyncingRef.current = true
    for (const [key, el] of Object.entries(paneEls.current)) {
      if (!el || Number(key) === sourceIndex) continue
      scrollPaneToVerseIndex(el, targetIndex)
    }
    requestAnimationFrame(() => {
      isSyncingRef.current = false
    })
  }

  useEffect(() => {
    if (syncScroll) syncPanesTo(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncScroll])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col gap-3 bg-[var(--color-surface)] p-4 focus:outline-none"
        >
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="text-sm font-semibold tracking-tight">
              {dialogTitle(verses)}
            </Dialog.Title>
            <div className="flex items-center gap-2">
              {verses.length > 1 && (
                <label className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] select-none">
                  <input
                    type="checkbox"
                    checked={syncScroll}
                    onChange={(e) => setSyncScroll(e.target.checked)}
                    aria-label="Sync scroll across panes"
                  />
                  Sync scroll
                </label>
              )}
              <div className="flex items-center rounded border border-[var(--color-theme-border)] overflow-hidden">
                <button
                  type="button"
                  onClick={decreaseFont}
                  disabled={scale <= MIN_VERSE_FONT_SCALE}
                  aria-label="Decrease font size"
                  className="text-xs px-2 py-1 hover:bg-[var(--color-surface-alt)] disabled:opacity-40"
                >
                  A−
                </button>
                <button
                  type="button"
                  onClick={increaseFont}
                  disabled={scale >= MAX_VERSE_FONT_SCALE}
                  aria-label="Increase font size"
                  className="text-xs px-2 py-1 border-l border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)] disabled:opacity-40"
                >
                  A+
                </button>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Exit fullscreen"
                  className="text-xs px-2 py-1 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
                >
                  ✕ Exit fullscreen
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 overflow-y-auto md:overflow-hidden">
            <section
              ref={(el) => { paneEls.current[0] = el }}
              onScroll={() => syncPanesTo(0)}
              role="group"
              aria-label="Original view"
              className="flex-1 min-w-0 border border-[var(--color-theme-border)] rounded-lg p-3 overflow-y-auto"
            >
              <div className="text-xs font-semibold mb-2">{translationLabel(initialTranslationCode)}</div>
              <TranslationPane verses={verses} code={initialTranslationCode} scale={scale} />
            </section>

            {extraPanes.map((content, i) => (
              <section
                key={i}
                ref={(el) => { paneEls.current[i + 1] = el }}
                onScroll={() => syncPanesTo(i + 1)}
                role="group"
                aria-label={`Comparison pane ${i + 1}`}
                className="flex-1 min-w-0 border border-[var(--color-theme-border)] rounded-lg p-3 overflow-y-auto"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <select
                    value={content}
                    onChange={(e) => setPane(i, e.target.value)}
                    aria-label={`Pane ${i + 1} content`}
                    className="text-xs border border-[var(--color-theme-border)] rounded px-1.5 py-0.5 bg-[var(--color-surface)]"
                  >
                    <option value={ORIGINAL_LANGUAGE}>Original language</option>
                    {codes.map((code) => (
                      <option key={code} value={code}>
                        {translationLabel(code)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removePane(i)}
                    aria-label={`Remove pane ${i + 1}`}
                    className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-1"
                  >
                    ✕
                  </button>
                </div>
                {content === ORIGINAL_LANGUAGE ? (
                  <OriginalLanguagePane verses={verses} scale={scale} dataByRef={origData} errorByRef={origErrors} />
                ) : (
                  <TranslationPane verses={verses} code={content} scale={scale} />
                )}
              </section>
            ))}

            {extraPanes.length < MAX_EXTRA_PANES && (
              <button
                type="button"
                onClick={addPane}
                className="self-start text-xs px-2 py-1 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
              >
                + Add pane
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
