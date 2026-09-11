import { useState } from 'react'
import { VerseBubble, type VerseBubbleData } from './VerseBubble'
import { VerseFullscreen, type VerseFullscreenVerse } from './VerseFullscreen'

interface Props {
  verses: VerseBubbleData[]
}

const DEFAULT_CODE_SUFFIX = '-KJV'

export function VerseGroupBubble({ verses }: Props) {
  const [fullscreen, setFullscreen] = useState(false)

  const fullscreenVerses: VerseFullscreenVerse[] = verses
    .filter((v): v is VerseBubbleData & { reference: string; translations: Record<string, string> } =>
      Boolean(v.reference && v.translations)
    )
    .map((v) => ({ reference: v.reference, translations: v.translations }))

  const codes = Array.from(new Set(fullscreenVerses.flatMap((v) => Object.keys(v.translations))))
  const initialTranslationCode = codes.find((c) => c.endsWith(DEFAULT_CODE_SUFFIX)) ?? codes[0]

  return (
    <div className="flex flex-col gap-2">
      {verses.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--color-text-secondary)]">{verses.length} verses</span>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label={`Compare ${verses.length} verses`}
            className="text-xs px-2 py-1 rounded border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
          >
            ⛶ Compare
          </button>
        </div>
      )}
      {verses.map((verse, i) => (
        <VerseBubble key={i} data={verse} />
      ))}
      {initialTranslationCode && (
        <VerseFullscreen
          verses={fullscreenVerses}
          initialTranslationCode={initialTranslationCode}
          open={fullscreen}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  )
}
