// frontend/src/components/admin/TrajectoryView.tsx
import { useMemo, useState } from 'react'
import type { Trace, TraceStep } from '@/types/trace'

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

interface TrajectoryViewProps {
  trace: Trace
  userMessage: string
  assistantText: string
}

const LANES: { label: string; kinds: TraceStep['kind'][] }[] = [
  { label: 'Input', kinds: ['routing', 'context'] },
  { label: 'Model', kinds: ['llm'] },
  { label: 'Tools', kinds: ['tool'] },
]

function pct(n: number): string {
  return `${Math.max(0, Math.min(100, n))}%`
}

function prettyJson(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function TrajectoryView({ trace, userMessage, assistantText }: TrajectoryViewProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const systemPrompt = useMemo(() => {
    const llm = trace.steps.find((s) => s.kind === 'llm')
    const req = llm?.request as { system?: string } | null
    return req?.system ?? null
  }, [trace.steps])

  const span = trace.durationMs || 1
  const selected = selectedIndex == null ? null : trace.steps.find((s) => s.index === selectedIndex) ?? null

  return (
    <div className="flex flex-col gap-4">
      {/* Timeline */}
      <div className="rounded-lg border border-[var(--color-theme-border)] p-3">
        <div className="mb-2 text-xs text-[var(--color-text-secondary)]">
          Duration {formatDuration(trace.durationMs)} · {trace.totals.toolCalls} tool calls ·{' '}
          {trace.totals.llmCalls} model calls
          {trace.totals.llmTokens != null ? ` · ${trace.totals.llmTokens} tok` : ''}
        </div>
        <div className="flex flex-col gap-1.5">
          {LANES.map((lane) => (
            <div key={lane.label} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[11px] text-[var(--color-text-secondary)]">{lane.label}</span>
              <div className="relative h-4 flex-1 rounded bg-[var(--color-surface-alt)]">
                {trace.steps
                  .filter((s) => lane.kinds.includes(s.kind))
                  .map((s) => (
                    <button
                      key={s.index}
                      onClick={() => setSelectedIndex(s.index)}
                      title={`${s.label} — ${formatDuration(s.durationMs)}`}
                      className={`absolute top-0 h-4 rounded ${
                        s.status === 'error' ? 'bg-red-500' : 'bg-[var(--color-theme-accent)]'
                      } ${selectedIndex === s.index ? 'ring-2 ring-offset-1' : ''}`}
                      style={{
                        left: pct(((s.startedAt - trace.startedAt) / span) * 100),
                        width: pct(Math.max(1, (s.durationMs / span) * 100)),
                      }}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Step tree */}
        <ol className="flex flex-col gap-1 rounded-lg border border-[var(--color-theme-border)] p-2 text-sm">
          {systemPrompt != null && (
            <StepRow label="SYSTEM" detail={truncate(systemPrompt)} onClick={() => {
              const llm = trace.steps.find((s) => s.kind === 'llm')
              if (llm) setSelectedIndex(llm.index)
            }} />
          )}
          <StepRow label="USER" detail={truncate(userMessage)} />
          {trace.steps
            .filter((s) => s.kind === 'context' || s.kind === 'tool')
            .map((s) => (
              <StepRow
                key={s.index}
                label={s.label}
                detail={`${s.kind} · ${formatDuration(s.durationMs)}${s.status === 'error' ? ' · error' : ''}`}
                active={selectedIndex === s.index}
                onClick={() => setSelectedIndex(s.index)}
              />
            ))}
          <StepRow label="ASSISTANT" detail={truncate(assistantText)} onClick={() => {
            const llm = [...trace.steps].reverse().find((s) => s.kind === 'llm')
            if (llm) setSelectedIndex(llm.index)
          }} />
        </ol>

        {/* Detail drawer */}
        <div className="rounded-lg border border-[var(--color-theme-border)] p-3 text-xs">
          {selected == null ? (
            <p className="text-[var(--color-text-secondary)]">Select a step to inspect it.</p>
          ) : (
            <dl className="flex flex-col gap-2">
              <Field term="Source" desc={selected.label} />
              <Field term="Status" desc={selected.status} />
              <Field
                term="Tokens"
                desc={
                  selected.tokens
                    ? `${selected.tokens.prompt} prompt / ${selected.tokens.completion} completion / ${selected.tokens.total} total`
                    : '—'
                }
              />
              <Field
                term="Request Timing"
                desc={`${formatDuration(selected.durationMs)} · ${new Date(selected.startedAt).toISOString()} → ${new Date(
                  selected.endedAt,
                ).toISOString()}`}
              />
              {selected.error && <Field term="Error" desc={selected.error} />}
              {selected.request != null && (
                <div>
                  <dt className="text-[var(--color-text-secondary)]">Request</dt>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-[var(--color-surface-alt)] p-2">
                    {prettyJson(selected.request)}
                  </pre>
                </div>
              )}
              {selected.response != null && (
                <div>
                  <dt className="text-[var(--color-text-secondary)]">Response</dt>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-[var(--color-surface-alt)] p-2">
                    {prettyJson(selected.response.preview)}
                  </pre>
                  {selected.response.bytesTotal > previewLength(selected.response.preview) && (
                    <p className="mt-1 text-[var(--color-text-secondary)]">
                      truncated — {selected.response.bytesTotal} bytes total
                    </p>
                  )}
                </div>
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}

function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function previewLength(value: unknown): number {
  try {
    return typeof value === 'string'
      ? new TextEncoder().encode(value).length
      : new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

function StepRow({
  label,
  detail,
  active,
  onClick,
}: {
  label: string
  detail: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full rounded px-2 py-1 text-left ${active ? 'bg-[var(--color-surface-alt)]' : ''} ${
          onClick ? 'hover:bg-[var(--color-surface-alt)]' : 'cursor-default'
        }`}
      >
        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">{label}</span>
        <span className="ml-2">{detail}</span>
      </button>
    </li>
  )
}

function Field({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-[var(--color-text-secondary)]">{term}</dt>
      <dd className="min-w-0 break-words">{desc}</dd>
    </div>
  )
}
