import type { EnglishResponse } from '@/types/api'

const MAX_RENDERED_RESULTS = 200

interface Props {
  data: EnglishResponse
}

export function EnglishSearchArtifact({ data }: Props) {
  const results = data.results.slice(0, MAX_RENDERED_RESULTS)
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummary}</div>
      {results.map((r, i) => (
        <div key={i} className="text-sm">
          <span className="font-medium">{r.ref}</span>: {r.text}
        </div>
      ))}
      {data.results.length > MAX_RENDERED_RESULTS && (
        <div className="text-xs text-[var(--color-text-secondary)]">
          Showing {MAX_RENDERED_RESULTS} of {data.results.length}
        </div>
      )}
    </div>
  )
}
