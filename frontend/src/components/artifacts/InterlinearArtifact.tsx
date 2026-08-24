import { useState } from 'react'
import type { ExplorerResponse } from '@/types/api'

interface Props {
  data: ExplorerResponse
}

export function InterlinearArtifact({ data }: Props) {
  const [tab, setTab] = useState<'text' | 'manuscript'>('text')
  const { verse, kjvWords, originalWords } = data

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">{verse.ref}</div>
      <div className="flex gap-1 border-b border-[var(--color-theme-border)]">
        <button
          onClick={() => setTab('text')}
          className={`text-xs px-3 py-1.5 ${tab === 'text' ? 'border-b-2 border-[var(--color-theme-accent)] font-medium' : 'text-[var(--color-text-secondary)]'}`}
        >
          Text
        </button>
        <button
          onClick={() => setTab('manuscript')}
          className={`text-xs px-3 py-1.5 ${tab === 'manuscript' ? 'border-b-2 border-[var(--color-theme-accent)] font-medium' : 'text-[var(--color-text-secondary)]'}`}
        >
          Manuscript
        </button>
      </div>

      {tab === 'text' && (
        <div className="flex flex-col gap-3">
          <div
            className="text-lg leading-loose"
            style={{
              fontFamily: verse.language === 'Hebrew' ? 'TaameyFrank, serif' : 'inherit',
              direction: verse.language === 'Hebrew' ? 'rtl' : 'ltr',
            }}
            dangerouslySetInnerHTML={{ __html: verse.originalText }}
          />
          <div className="flex flex-col gap-1">
            {kjvWords.map((w, i) => (
              <div key={i} className="flex items-baseline gap-2 text-xs border-b border-[var(--color-theme-border)] pb-1">
                <span className="font-mono px-1 rounded bg-[var(--color-surface-alt)]">{w.strongsNumber}</span>
                <span
                  dangerouslySetInnerHTML={{
                    __html: w.kjvText.replace(/<st SN="[^"]*">/g, '').replace(/<\/st>/g, ''),
                  }}
                />
              </div>
            ))}
          </div>
          {originalWords.length === 0 && kjvWords.length === 0 && (
            <div className="text-xs text-[var(--color-text-secondary)] italic">No word-level data for this verse.</div>
          )}
        </div>
      )}

      {tab === 'manuscript' && (
        <div className="flex flex-col gap-2">
          {verse.lcFiles.length === 0 ? (
            <div className="text-xs text-[var(--color-text-secondary)] italic">No manuscript images for this verse.</div>
          ) : (
            verse.lcFiles.map((f, i) => (
              <img key={i} src={`/LC_/${f}`} alt={`Leningrad Codex page ${i + 1} for ${verse.ref}`} className="rounded border border-[var(--color-theme-border)]" />
            ))
          )}
        </div>
      )}
    </div>
  )
}
