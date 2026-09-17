import { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Loader2, X } from 'lucide-react'
import { renderMarkdown } from '@/lib/renderMarkdown'
import type { PhaseResult } from '@/types/session'

function StatusIcon({ status }: { status: PhaseResult['status'] }) {
  if (status === 'running') {
    return <Loader2 aria-label="In progress" className="h-3.5 w-3.5 animate-spin text-[var(--color-text-secondary)]" />
  }
  if (status === 'error') {
    return <X aria-label="Could not be completed" className="h-3.5 w-3.5 text-[var(--color-danger)]" />
  }
  return <Check aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-green)]" />
}

function Phase({ phase }: { phase: PhaseResult }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-[var(--color-theme-border)]">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-medium hover:bg-[var(--color-surface-alt)]"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
        <span className="text-[var(--color-text-secondary)]">Phase {phase.index}</span>
        <span className="flex-1 truncate">{phase.title}</span>
        <StatusIcon status={phase.status} />
      </button>
      {open && (
        <div className="border-t border-[var(--color-theme-border)] px-2.5 py-2 text-sm leading-relaxed">
          {renderMarkdown(phase.markdown)}
          {!!phase.citations?.length && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {phase.citations.map((c, i) => (
                <li key={`${i}-${c.reference}`} className="text-xs">
                  <span className="font-semibold">{c.reference}</span>{' '}
                  <span className="text-[var(--color-text-secondary)]">{c.text}</span>
                </li>
              ))}
            </ul>
          )}
          {!!phase.verdicts?.length && (
            <ul className="mt-2 flex flex-col gap-1">
              {phase.verdicts.map((v, i) => (
                <li key={`${i}-${v.test}`} className="text-xs">
                  <span className="font-semibold capitalize">{v.test} Test</span>:{' '}
                  <span className={v.passed ? 'text-[var(--color-green)]' : 'text-[var(--color-danger)]'}>
                    {v.passed ? 'PASSED' : 'FAILED'}
                  </span>
                  {v.reason ? ` — ${v.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function PhaseList({ phases }: { phases: PhaseResult[] }) {
  if (!phases.length) return null
  const failed = phases.flatMap((p) => p.verdicts ?? []).filter((v) => !v.passed)
  return (
    <div className="flex flex-col gap-1.5">
      {phases.map((phase) =>
        // Index 0 is the "reading that as X" notice a described passage
        // gets — a line to read, not a phase to open.
        phase.index === 0 ? (
          <div key={phase.index} className="text-xs text-[var(--color-text-secondary)]">
            {renderMarkdown(phase.markdown)}
          </div>
        ) : (
          <Phase key={phase.index} phase={phase} />
        )
      )}
      {failed.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-md bg-[var(--color-surface-alt)] px-2.5 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-gold)]" aria-hidden="true" />
          <span>
            {failed.map((v, i) => (
              <span key={`${i}-${v.test}`} className="block">
                <span className="font-semibold capitalize">{v.test} Test</span> failed
                {v.reason ? `: ${v.reason}` : ''}. Weigh this before accepting the reading.
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  )
}
