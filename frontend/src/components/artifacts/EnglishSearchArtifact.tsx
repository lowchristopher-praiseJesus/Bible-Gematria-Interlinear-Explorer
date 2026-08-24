import type { EnglishResponse } from '@/types/api'

interface Props {
  data: EnglishResponse
}

export function EnglishSearchArtifact({ data }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummary}</div>
      {data.results.map((r, i) => (
        <div key={i} className="text-sm">
          <span className="font-medium">{r.ref}</span>: {r.text}
        </div>
      ))}
    </div>
  )
}
