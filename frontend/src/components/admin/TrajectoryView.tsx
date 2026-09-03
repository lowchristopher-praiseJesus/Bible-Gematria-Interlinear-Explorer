// frontend/src/components/admin/TrajectoryView.tsx
import { useMemo, useState } from 'react'
import { Clock, Cpu, Hash, Route, Wrench } from 'lucide-react'
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

  // A turn that never called the model or a tool (a templated mode primer, a
  // deterministic verse lookup) has nothing to plot — its only step is an
  // instant `routing` decision. Show the route instead of dead-looking lanes.
  const didWork = trace.totals.toolCalls > 0 || trace.totals.llmCalls > 0
  const hasTimeline =
    didWork || trace.steps.some((s) => s.kind === 'llm' || s.kind === 'tool' || s.durationMs >= 1)

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="rounded-lg border border-admin-border bg-admin-surface p-3">
        <div className="flex flex-wrap gap-1.5">
          <Chip icon={Clock} label={formatDuration(trace.durationMs)} />
          <Chip icon={Wrench} label={`${trace.totals.toolCalls} tools`} />
          <Chip icon={Cpu} label={`${trace.totals.llmCalls} model`} />
          {trace.totals.llmTokens != null && (
            <Chip icon={Hash} label={`${trace.totals.llmTokens} tok`} />
          )}
        </div>
        {trace.outcome.route && (
          <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-admin-muted">
            <Route className="mt-px h-3 w-3 shrink-0 text-admin-subtle" aria-hidden="true" />
            <span className="font-[family-name:var(--font-admin-mono)]">{trace.outcome.route}</span>
          </p>
        )}

        {hasTimeline ? (
          <div className="mt-3 flex flex-col gap-1.5">
            {LANES.map((lane) => (
              <div key={lane.label} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[11px] font-medium text-admin-subtle">{lane.label}</span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-admin-raised">
                  {trace.steps
                    .filter((s) => lane.kinds.includes(s.kind))
                    .map((s) => (
                      <button
                        key={s.index}
                        onClick={() => setSelectedIndex(s.index)}
                        title={`${s.label} — ${formatDuration(s.durationMs)}`}
                        className={`absolute top-0 h-4 min-w-[3px] rounded transition-[box-shadow] ${
                          s.status === 'error'
                            ? 'bg-[var(--admin-danger)]'
                            : 'bg-admin-accent hover:brightness-110'
                        } ${
                          selectedIndex === s.index
                            ? 'z-10 ring-2 ring-admin-text ring-offset-1 ring-offset-admin-surface'
                            : ''
                        }`}
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
        ) : (
          <p className="mt-3 text-[11px] text-admin-subtle">
            Resolved without a model call or tools — nothing to plot on the timeline.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Step tree */}
        <ol className="flex flex-col gap-0.5 rounded-lg border border-admin-border bg-admin-surface p-2 text-sm">
          {systemPrompt != null && (
            <StepRow
              label="SYSTEM"
              detail={truncate(systemPrompt)}
              onClick={() => {
                const llm = trace.steps.find((s) => s.kind === 'llm')
                if (llm) setSelectedIndex(llm.index)
              }}
            />
          )}
          <StepRow label="USER" detail={truncate(userMessage)} />
          {trace.steps
            .filter((s) => s.kind === 'routing' || s.kind === 'context' || s.kind === 'tool')
            .map((s) => (
              <StepRow
                key={s.index}
                label={s.label}
                detail={`${s.kind} · ${formatDuration(s.durationMs)}${s.status === 'error' ? ' · error' : ''}`}
                active={selectedIndex === s.index}
                error={s.status === 'error'}
                onClick={() => setSelectedIndex(s.index)}
              />
            ))}
          <StepRow
            label="ASSISTANT"
            detail={truncate(assistantText)}
            onClick={() => {
              const llm = [...trace.steps].reverse().find((s) => s.kind === 'llm')
              if (llm) setSelectedIndex(llm.index)
            }}
          />
        </ol>

        {/* Detail drawer */}
        <div className="rounded-lg border border-admin-border bg-admin-surface p-3 text-xs">
          {selected == null ? (
            <p className="text-admin-subtle">
              {trace.steps.length === 0
                ? 'No steps were recorded for this turn.'
                : 'Select a step to inspect its request and response.'}
            </p>
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
                  <dt className="mb-1 text-admin-subtle">Request</dt>
                  <pre className="max-h-60 overflow-auto rounded bg-admin-raised p-2 font-[family-name:var(--font-admin-mono)] text-admin-text">
                    {prettyJson(selected.request)}
                  </pre>
                </div>
              )}
              {selected.response != null && (
                <div>
                  <dt className="mb-1 text-admin-subtle">Response</dt>
                  <pre className="max-h-60 overflow-auto rounded bg-admin-raised p-2 font-[family-name:var(--font-admin-mono)] text-admin-text">
                    {prettyJson(selected.response.preview)}
                  </pre>
                  {selected.response.bytesTotal > previewLength(selected.response.preview) && (
                    <p className="mt-1 text-admin-subtle">
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

function Chip({
  icon: Icon,
  label,
}: {
  icon: typeof Clock
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-admin-raised px-1.5 py-0.5 text-[11px] font-medium text-admin-muted">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
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
  error,
  onClick,
}: {
  label: string
  detail: string
  active?: boolean
  error?: boolean
  onClick?: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full rounded px-2 py-1.5 text-left transition-colors ${
          active ? 'bg-admin-accent-weak' : ''
        } ${onClick ? 'cursor-pointer hover:bg-admin-raised' : 'cursor-default'}`}
      >
        <span
          className={`font-[family-name:var(--font-admin-mono)] text-[11px] ${
            error ? 'text-[var(--admin-danger)]' : 'text-admin-subtle'
          }`}
        >
          {label}
        </span>
        <span className="ml-2 text-admin-text">{detail}</span>
      </button>
    </li>
  )
}

function Field({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-admin-subtle">{term}</dt>
      <dd className="min-w-0 break-words text-admin-text">{desc}</dd>
    </div>
  )
}
