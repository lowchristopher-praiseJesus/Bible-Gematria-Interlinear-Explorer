import { useState } from 'react'
import { decodeHtmlEntities } from '@/lib/decodeHtmlEntities'
import { useArtifactStore } from '@/store/useArtifactStore'

export interface VerseBubbleData {
  reference?: string
  translations?: Record<string, string>
}

interface Props {
  data: VerseBubbleData
}

function translationLabel(code: string): string {
  const abbr = code.split('-')[1] ?? code
  return abbr.toUpperCase()
}

export function VerseBubble({ data }: Props) {
  const translations = data.translations ?? {}
  const codes = Object.keys(translations)
  const defaultCode = codes.find((c) => c.endsWith('-KJV')) ?? codes[0]
  const [selected, setSelected] = useState(defaultCode)
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
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5 text-sm">
        {reference && (
          <button
            type="button"
            onClick={() => openArtifact({ type: 'interlinear', label: `${reference} ▸`, params: { reference } })}
            aria-label={`Open ${reference} in the original language`}
            className="shrink-0 text-[var(--color-theme-accent)] hover:underline text-xs font-mono"
          >
            {vnum ?? '▸'}
          </button>
        )}
        <span>{decodeHtmlEntities(translations[activeCode])}</span>
      </div>
    </div>
  )
}
