import type { GematriaResponse } from '@/types/api'

interface Props {
  data: GematriaResponse
}

export function GematriaArtifact({ data }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">Gematria Results</div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummaryWords}</div>
        <div className="flex flex-col gap-1 mt-1">
          {data.wordResults.map((w, i) => (
            <div key={i} className="text-xs flex items-center gap-2">
              <span className="font-mono">{w.strongsNumber}</span>
              <span>{w.ref}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummaryVerses}</div>
        <div className="flex flex-col gap-1 mt-1">
          {data.verseResults.map((v, i) => (
            <div key={i} className="text-xs">{v.ref}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
