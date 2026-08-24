import type { StrongsResponse } from '@/types/api'

interface Props {
  data: StrongsResponse
}

export function StrongsArtifact({ data }: Props) {
  const { definition, verses, resultSummary } = data
  if (!definition) {
    return <div className="text-sm text-[var(--color-text-secondary)] italic">{resultSummary}</div>
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold">{definition.strongsNumber}</div>
      <div className="text-lg">{definition.root}</div>
      <div className="text-xs text-[var(--color-text-secondary)]">{definition.transliteration1} — {definition.partOfSpeech}</div>
      <div className="text-sm font-medium">{definition.meaning}</div>
      <div className="text-sm" dangerouslySetInnerHTML={{ __html: definition.strongsDefinition }} />
      <div className="text-xs text-[var(--color-text-secondary)]">{resultSummary}</div>
      <div className="flex flex-col gap-1 mt-2">
        {verses.map((group) => (
          <div key={group.book} className="text-xs">
            <span className="font-medium">{group.book}</span>: {group.refs.map((r) => r.ref).join(', ')}
          </div>
        ))}
      </div>
    </div>
  )
}
