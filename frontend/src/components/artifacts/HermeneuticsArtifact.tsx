import { renderMarkdown } from '@/lib/renderMarkdown'
import type { HermeneuticsArtifactParams } from '@/types/session'

export function HermeneuticsArtifact({ reference, phases, summary }: HermeneuticsArtifactParams) {
  return (
    <div className="flex flex-col gap-4 max-w-prose">
      <h2 className="text-sm font-semibold">{reference}</h2>
      {phases.map((phase) => (
        <section key={phase.index} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Phase {phase.index} · {phase.title}
          </h3>
          <div className="text-sm leading-relaxed">{renderMarkdown(phase.markdown)}</div>
          {!!phase.citations?.length && (
            <ul className="flex flex-col gap-1">
              {phase.citations.map((c, i) => (
                <li key={`${i}-${c.reference}`} className="text-xs">
                  <span className="font-semibold">{c.reference}</span>{' '}
                  <span className="text-[var(--color-text-secondary)]">{c.text}</span>
                </li>
              ))}
            </ul>
          )}
          {!!phase.verdicts?.length && (
            <ul className="flex flex-col gap-0.5">
              {phase.verdicts.map((v, i) => (
                <li key={`${i}-${v.test}`} className="text-xs">
                  <span className="font-semibold capitalize">{v.test} Test</span>:{' '}
                  {v.passed ? 'PASSED' : 'FAILED'}
                  {v.reason ? ` — ${v.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <section className="flex flex-col gap-1.5 border-t border-[var(--color-theme-border)] pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Final Verified Interpretation
        </h3>
        <div className="text-sm leading-relaxed">{renderMarkdown(summary)}</div>
      </section>
    </div>
  )
}
