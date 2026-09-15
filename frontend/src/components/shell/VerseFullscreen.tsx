import { useEffect, useRef, useState, type MouseEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { decodeHtmlEntities } from '@/lib/decodeHtmlEntities'
import { translationLabel } from '@/lib/translationLabel'
import { fetchInterlinear, fetchStrongsEntry } from '@/lib/chatApi'
import {
  useVerseFontScaleStore,
  MIN_VERSE_FONT_SCALE,
  MAX_VERSE_FONT_SCALE,
} from '@/store/useVerseFontScaleStore'
import type { ExplorerResponse, StrongsResponse } from '@/types/api'

// Same cross-reference rewrite StrongsArtifact does for the old Flask
// `/strongs?strongsnumber=` links embedded in definition text — this
// popover has its own nav (setStrongsCode) instead of the shared
// artifact store, since it renders inside a fullscreen dialog that sits
// above the main artifact pane.
const STRONGS_HREF_RE = /^\/strongs\?strongsnumber=([A-Za-z0-9]+)/

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
  onStrongsClick,
}: {
  status: LoadStatus
  data: ExplorerResponse | null
  scale: number
  showHeading: boolean
  reference: string
  onStrongsClick: (code: string) => void
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
            <button
              type="button"
              onClick={() => onStrongsClick(w.strongsNumber)}
              className="font-mono px-1 rounded bg-[var(--color-surface-alt)] hover:underline"
            >
              {w.strongsNumber}
            </button>
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
  onStrongsClick,
}: {
  verses: VerseFullscreenVerse[]
  scale: number
  dataByRef: Record<string, ExplorerResponse>
  errorByRef: Record<string, boolean>
  onStrongsClick: (code: string) => void
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
              onStrongsClick={onStrongsClick}
            />
          </div>
        )
      })}
    </div>
  )
}

function StrongsPopover({
  code,
  status,
  data,
  onNavigate,
  onClose,
}: {
  code: string
  status: LoadStatus
  data: StrongsResponse | null
  onNavigate: (code: string) => void
  onClose: () => void
}) {
  function handleDefinitionClick(e: MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    const match = href?.match(STRONGS_HREF_RE)
    if (!match) return
    e.preventDefault()
    onNavigate(match[1].toUpperCase())
  }

  return (
    <div className="absolute inset-x-3 bottom-3 z-10 max-h-[45%] overflow-y-auto rounded-lg border border-[var(--color-theme-border)] bg-[var(--color-surface)] p-3 shadow-lg md:inset-x-auto md:right-3 md:w-96">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold">{code}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Strong's definition"
          className="text-xs px-2 py-0.5 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        >
          ✕
        </button>
      </div>
      {status === 'loading' && (
        <p className="text-xs text-[var(--color-text-secondary)] italic">Loading…</p>
      )}
      {status === 'error' && (
        <p className="text-xs text-[var(--color-text-secondary)] italic">Could not load {code}.</p>
      )}
      {status === 'ready' && data && !data.definition && (
        <p className="text-xs text-[var(--color-text-secondary)] italic">{data.resultSummary}</p>
      )}
      {status === 'ready' && data?.definition && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="text-lg">{data.definition.root}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            {data.definition.transliteration1} — {data.definition.partOfSpeech}
          </div>
          <div className="font-medium">{data.definition.meaning}</div>
          <div onClick={handleDefinitionClick} dangerouslySetInnerHTML={{ __html: data.definition.strongsDefinition }} />
        </div>
      )}
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
  const [strongsCode, setStrongsCode] = useState<string | null>(null)
  const [strongsData, setStrongsData] = useState<Record<string, StrongsResponse>>({})
  const [strongsErrors, setStrongsErrors] = useState<Record<string, boolean>>({})
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

  useEffect(() => {
    if (!strongsCode || strongsData[strongsCode] || strongsErrors[strongsCode]) return
    fetchStrongsEntry(strongsCode)
      .then((d) => setStrongsData((prev) => ({ ...prev, [strongsCode]: d })))
      .catch(() => setStrongsErrors((prev) => ({ ...prev, [strongsCode]: true })))
  }, [strongsCode, strongsData, strongsErrors])

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
                  <OriginalLanguagePane
                    verses={verses}
                    scale={scale}
                    dataByRef={origData}
                    errorByRef={origErrors}
                    onStrongsClick={setStrongsCode}
                  />
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

          {strongsCode && (
            <StrongsPopover
              code={strongsCode}
              status={strongsErrors[strongsCode] ? 'error' : strongsData[strongsCode] ? 'ready' : 'loading'}
              data={strongsData[strongsCode] ?? null}
              onNavigate={setStrongsCode}
              onClose={() => setStrongsCode(null)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
