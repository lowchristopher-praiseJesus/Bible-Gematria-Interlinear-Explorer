import type { GematriaResponse } from '@/types/api'

const MAX_RENDERED_RESULTS = 200

interface Props {
  data: GematriaResponse
}

export function GematriaArtifact({ data }: Props) {
  const wordResults = data.wordResults.slice(0, MAX_RENDERED_RESULTS)
  const verseResults = data.verseResults.slice(0, MAX_RENDERED_RESULTS)
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">Gematria Results</div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummaryWords}</div>
        <div className="flex flex-col gap-1 mt-1">
          {wordResults.map((w, i) => (
            <div key={i} className="text-xs flex items-center gap-2">
              <span className="font-mono">{w.strongsNumber}</span>
              <span>{w.ref}</span>
            </div>
          ))}
        </div>
        {data.wordResults.length > MAX_RENDERED_RESULTS && (
          <div className="text-xs text-[var(--color-text-secondary)] mt-1">
            Showing {MAX_RENDERED_RESULTS} of {data.wordResults.length}
          </div>
        )}
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummaryVerses}</div>
        <div className="flex flex-col gap-1 mt-1">
          {verseResults.map((v, i) => (
            <div key={i} className="text-xs">{v.ref}</div>
          ))}
        </div>
        {data.verseResults.length > MAX_RENDERED_RESULTS && (
          <div className="text-xs text-[var(--color-text-secondary)] mt-1">
            Showing {MAX_RENDERED_RESULTS} of {data.verseResults.length}
          </div>
        )}
      </div>
    </div>
  )
}
