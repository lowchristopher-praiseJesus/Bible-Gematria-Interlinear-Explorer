import type { MouseEvent } from 'react'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { StrongsResponse } from '@/types/api'

interface Props {
  data: StrongsResponse
}

// The Strong's definition text comes straight from Complete.db and still
// carries the cross-reference links it was authored with for the old
// Flask app, e.g. `<a href="/strongs?strongsnumber=H1717">H1717</a>` —
// this SPA doesn't serve that route, so left alone the link would send
// the browser to a dead page instead of opening the referenced entry.
const STRONGS_HREF_RE = /^\/strongs\?strongsnumber=([A-Za-z0-9]+)/

export function StrongsArtifact({ data }: Props) {
  const { definition, verses, resultSummary } = data
  const openArtifact = useArtifactStore((s) => s.openArtifact)

  function handleDefinitionClick(e: MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    const match = href?.match(STRONGS_HREF_RE)
    if (!match) return
    e.preventDefault()
    const number = match[1].toUpperCase()
    openArtifact({ type: 'strongs', label: `${number} ▸`, params: { id: number } })
  }

  if (!definition) {
    return <div className="text-sm text-[var(--color-text-secondary)] italic">{resultSummary}</div>
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold">{definition.strongsNumber}</div>
      <div className="text-lg">{definition.root}</div>
      <div className="text-xs text-[var(--color-text-secondary)]">{definition.transliteration1} — {definition.partOfSpeech}</div>
      <div className="text-sm font-medium">{definition.meaning}</div>
      <div
        className="text-sm"
        onClick={handleDefinitionClick}
        dangerouslySetInnerHTML={{ __html: definition.strongsDefinition }}
      />
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
