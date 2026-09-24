import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { decodeHtmlEntities } from '@/lib/decodeHtmlEntities'
import { pickDefaultTranslationCode, translationLabel } from '@/lib/translationLabel'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useTranslationSettingsStore } from '@/store/useTranslationSettingsStore'
import { VerseFullscreen } from './VerseFullscreen'

export interface VerseBubbleData {
  reference?: string
  translations?: Record<string, string>
}

interface Props {
  data: VerseBubbleData
}

export function VerseBubble({ data }: Props) {
  const translations = data.translations ?? {}
  const codes = Object.keys(translations)
  const preferredAbbr = useTranslationSettingsStore((s) => s.defaultTranslationAbbr)
  const defaultCode = pickDefaultTranslationCode(codes, preferredAbbr)
  const [selected, setSelected] = useState(defaultCode)
  const [fullscreen, setFullscreen] = useState(false)
  const openArtifact = useArtifactStore((s) => s.openArtifact)

  if (codes.length === 0) return null

  const activeCode = translations[selected] !== undefined ? selected : defaultCode
  const reference = data.reference
  // The reference is a full "BOOK C:V" string (e.g. "JHN 3:16") — the verse
  // number alone is the trailing digits, matching the small clickable
  // number ChapterReadingBubble uses for the same purpose.
  const vnum = reference?.match(/:(\d+)$/)?.[1]

  return (
    <div className="mt-1 border border-[var(--color-theme-border)] rounded-lg p-2 max-w-md">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-xs">{reference}</span>
        <div className="flex items-center gap-1.5">
          {codes.length > 1 && (
            <select
              value={activeCode}
              onChange={(e) => setSelected(e.target.value)}
              aria-label="Translation"
              className="text-xs border border-[var(--color-theme-border)] rounded px-1.5 py-0.5 bg-[var(--color-surface)]"
            >
              {codes.map((code) => (
                <option key={code} value={code}>
                  {translationLabel(code)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label="Maximize verse"
            className="text-xs px-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            ⛶
          </button>
        </div>
      </div>
      <VerseFullscreen
        verses={[{ reference: reference ?? '', translations }]}
        initialTranslationCode={activeCode}
        open={fullscreen}
        onClose={() => setFullscreen(false)}
      />
      <div className="mt-1.5 flex items-baseline gap-1.5 text-sm">
        {reference && (
          <button
            type="button"
            onClick={() => openArtifact({ type: 'interlinear', label: `${reference} ▸`, params: { reference } })}
            aria-label={`Open ${reference} in the original language`}
            className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[var(--color-theme-accent)]/30 bg-[var(--color-theme-accent)]/10 px-1.5 py-0.5 leading-none text-[var(--color-theme-accent)] hover:bg-[var(--color-theme-accent)]/20 text-xs font-mono"
          >
            <BookOpen className="h-2.5 w-2.5" aria-hidden="true" />
            {vnum ?? '▸'}
          </button>
        )}
        <span>{decodeHtmlEntities(translations[activeCode])}</span>
      </div>
    </div>
  )
}
