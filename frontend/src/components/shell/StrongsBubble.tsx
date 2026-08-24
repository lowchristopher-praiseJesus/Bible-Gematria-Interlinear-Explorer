interface StrongsWordEntry {
  lemma?: string
  transliteration?: string
  definition?: string
}

interface Props {
  data: {
    words?: Record<string, StrongsWordEntry>
  }
}

export function StrongsBubble({ data }: Props) {
  const words = data.words ?? {}
  const entries = Object.entries(words)

  if (entries.length === 0) return null

  return (
    <div className="mt-1 flex flex-col gap-2 text-sm">
      {entries.map(([number, entry]) => (
        <div key={number} className="border-l-2 border-[var(--color-theme-border)] pl-2">
          <div className="text-xs font-semibold">
            {number}
            {entry.transliteration && <span className="font-normal italic"> — {entry.transliteration}</span>}
          </div>
          {entry.lemma && <div className="text-base">{entry.lemma.split('\n\n')[0]}</div>}
          {entry.definition && <div className="text-xs text-[var(--color-text-secondary)]">{entry.definition}</div>}
        </div>
      ))}
    </div>
  )
}
