import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, Trash2, User } from 'lucide-react'
import { getReport, updateReport, deleteReport, type ReportDetail } from '@/lib/adminApi'
import { relativeTime } from '@/lib/relativeTime'
import { statusTone } from '@/lib/reportBadges'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Select,
  Skeleton,
} from '@/components/ui'
import { TrajectoryView } from './TrajectoryView'

interface AdminReportViewProps {
  id: string
  onBack: () => void
  onDeleted?: () => void
}

const STATUSES = ['new', 'triaged', 'resolved']
const prettify = (s: string) => s.replace(/_/g, ' ')

export function AdminReportView({ id, onBack, onDeleted }: AdminReportViewProps) {
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('new')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setReport(null)
    getReport(id)
      .then((r) => {
        if (cancelled) return
        setReport(r)
        setStatus(r.status)
        setNotes(r.admin_notes ?? '')
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [id])

  const dirty = useMemo(
    () => !!report && (status !== report.status || notes !== (report.admin_notes ?? '')),
    [report, status, notes],
  )

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateReport(id, { status, admin_notes: notes })
      setReport(updated)
      setStatus(updated.status)
      setNotes(updated.admin_notes ?? '')
    } catch (e) {
      setSaveError((e as Error).message)
      if (report) {
        setStatus(report.status)
        setNotes(report.admin_notes ?? '')
      }
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    setSaveError(null)
    try {
      await deleteReport(id)
      ;(onDeleted ?? onBack)()
    } catch (e) {
      setSaveError((e as Error).message)
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  if (error === 'unauthorized') return <Notice text="Please sign in as an admin." />
  if (error === 'admin_not_configured') return <Notice text="Admin access is not configured." />
  if (error) return <Notice text={error} danger />
  if (!report) return <ReportSkeleton onBack={onBack} />

  const messages = report.session_json?.messages ?? []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>
          Back to list
        </Button>
        <Button
          variant="danger-outline"
          size="sm"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => setConfirmOpen(true)}
        >
          Delete report
        </Button>
      </div>

      <Card>
        <CardHeader className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge tone="neutral">{prettify(report.category)}</Badge>
            <Badge tone={statusTone(report.status)} dot>
              {report.status}
            </Badge>
            <span className="truncate text-sm font-semibold text-admin-text">
              {report.session_title || 'Untitled session'}
            </span>
          </div>
          <span
            className="shrink-0 text-xs text-admin-subtle"
            title={new Date(report.created_at).toLocaleString()}
          >
            {relativeTime(report.created_at)}
          </span>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-admin-text">
            {report.description}
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 border-t border-admin-border pt-4 text-xs sm:grid-cols-2">
            <Meta term="Reported" value={new Date(report.created_at).toLocaleString()} />
            <Meta term="Session mode" value={report.session_mode} />
            <Meta term="Messages" value={String(report.message_count)} />
            <Meta term="App version" value={report.app_version} mono />
            <Meta term="Viewport" value={report.viewport} mono />
            <Meta term="Email" value={report.email ?? '—'} />
            <Meta term="Client ID" value={report.client_id} mono />
            <Meta term="Page URL" value={report.page_url} mono truncate />
            <Meta term="User agent" value={report.user_agent} className="sm:col-span-2" />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Triage</CardTitle>
          {dirty && <span className="text-xs text-admin-subtle">Unsaved changes</span>}
        </CardHeader>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="sm:w-44"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="admin-notes" className="text-xs font-medium text-admin-muted">
              Admin notes
            </label>
            <textarea
              id="admin-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Context, root cause, links…"
              className="min-h-[4.5rem] rounded-md border border-admin-border-strong bg-admin-surface px-2.5 py-1.5 text-sm text-admin-text transition-colors placeholder:text-admin-subtle hover:border-admin-accent focus-visible:border-admin-accent"
            />
          </div>
          <Button onClick={save} loading={saving} disabled={!dirty} className="sm:mt-[1.35rem]">
            Save
          </Button>
        </CardBody>
        {saveError && (
          <p className="px-4 pb-3 text-xs text-[var(--admin-danger)]">Couldn&apos;t save: {saveError}</p>
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-admin-text">
          Conversation
          <span className="ml-1.5 font-normal text-admin-subtle">
            {messages.length} {messages.length === 1 ? 'message' : 'messages'}
          </span>
        </h2>
        {messages.map((m, i) => (
          <Card key={m.id ?? i}>
            <CardBody>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-admin-subtle">
                {m.role === 'assistant' ? (
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {m.role.toUpperCase()}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-admin-text">
                {m.text}
              </p>
              {m.role === 'assistant' && m.trace && (
                <div className="mt-4 rounded-lg border border-admin-border bg-admin-raised p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-admin-subtle">
                    Trajectory
                  </p>
                  <TrajectoryView
                    trace={m.trace}
                    userMessage={messages[i - 1]?.text ?? ''}
                    assistantText={m.text}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !deleting && setConfirmOpen(o)}
        onConfirm={remove}
        loading={deleting}
        destructive
        title="Delete this report?"
        description="This permanently removes the report and its saved transcript. This cannot be undone."
        confirmLabel="Delete permanently"
      />
    </div>
  )
}

function Meta({
  term,
  value,
  mono = false,
  truncate = false,
  className = '',
}: {
  term: string
  value: string
  mono?: boolean
  truncate?: boolean
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <dt className="text-admin-subtle">{term}</dt>
      <dd
        className={`min-w-0 text-admin-text ${mono ? 'font-[family-name:var(--font-admin-mono)]' : ''} ${
          truncate ? 'truncate' : 'break-words'
        }`}
        title={truncate ? value : undefined}
      >
        {value}
      </dd>
    </div>
  )
}

function Notice({ text, danger = false }: { text: string; danger?: boolean }) {
  return (
    <div
      className={`mx-auto mt-10 max-w-sm rounded-xl border border-admin-border bg-admin-surface p-6 text-center text-sm ${
        danger ? 'text-[var(--admin-danger)]' : 'text-admin-muted'
      }`}
    >
      {text}
    </div>
  )
}

function ReportSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>
        Back to list
      </Button>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  )
}
