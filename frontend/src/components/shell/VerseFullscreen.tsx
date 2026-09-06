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

export interface VerseFullscreenProps {
  reference?: string
  translations: Record<string, string>
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

function OriginalLanguagePane({
  status,
  data,
  scale,
}: {
  status: LoadStatus
  data: ExplorerResponse | null
  scale: number
}) {
  if (status === 'loading') {
    return <p className="text-xs text-[var(--color-text-secondary)] italic">Loading original language…</p>
  }
  if (status === 'error' || !data) {
    return <p className="text-xs text-[var(--color-text-secondary)] italic">Could not load the original language for this verse.</p>
  }
  const { verse, kjvWords } = data
  return (
    <div className="flex flex-col gap-3">
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

export function VerseFullscreen({
  reference,
  translations,
  initialTranslationCode,
  open,
  onClose,
}: VerseFullscreenProps) {
  const codes = Object.keys(translations)
  const [extraPanes, setExtraPanes] = useState<string[]>([ORIGINAL_LANGUAGE])
  const [origData, setOrigData] = useState<ExplorerResponse | null>(null)
  const [origError, setOrigError] = useState(false)
  const fetchStarted = useRef(false)

  const scale = useVerseFontScaleStore((s) => s.scale)
  const increaseFont = useVerseFontScaleStore((s) => s.increase)
  const decreaseFont = useVerseFontScaleStore((s) => s.decrease)

  const needsOriginal = extraPanes.includes(ORIGINAL_LANGUAGE)
  const origStatus: LoadStatus = origError ? 'error' : origData ? 'ready' : 'loading'

  useEffect(() => {
    if (!needsOriginal || fetchStarted.current || !reference) return
    fetchStarted.current = true
    fetchInterlinear(reference)
      .then((d) => setOrigData(d))
      .catch(() => setOrigError(true))
  }, [needsOriginal, reference])

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
              {reference ?? 'Verse'}
            </Dialog.Title>
            <div className="flex items-center gap-2">
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
              role="group"
              aria-label="Original view"
              className="flex-1 min-w-0 border border-[var(--color-theme-border)] rounded-lg p-3 overflow-y-auto"
            >
              <div className="text-xs font-semibold mb-2">{translationLabel(initialTranslationCode)}</div>
              <p style={{ fontSize: rem(BASE_TRANSLATION_REM, scale) }}>
                {decodeHtmlEntities(translations[initialTranslationCode])}
              </p>
            </section>

            {extraPanes.map((content, i) => (
              <section
                key={i}
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
                  <OriginalLanguagePane status={origStatus} data={origData} scale={scale} />
                ) : (
                  <p style={{ fontSize: rem(BASE_TRANSLATION_REM, scale) }}>
                    {decodeHtmlEntities(translations[content] ?? '')}
                  </p>
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
