import { useEffect, useState } from 'react'
import { getReport, updateReport, deleteReport, type ReportDetail } from '@/lib/adminApi'
import { TrajectoryView } from './TrajectoryView'

interface AdminReportViewProps {
  id: string
  onBack: () => void
  onDeleted?: () => void
}

const STATUSES = ['new', 'triaged', 'resolved']

export function AdminReportView({ id, onBack, onDeleted }: AdminReportViewProps) {
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('new')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
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

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateReport(id, { status, admin_notes: notes })
      setReport(updated)
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
    if (!window.confirm('Delete this report permanently?')) return
    setDeleting(true)
    setSaveError(null)
    try {
      await deleteReport(id)
      ;(onDeleted ?? onBack)()
    } catch (e) {
      setSaveError((e as Error).message)
      setDeleting(false)
    }
  }

  if (error === 'unauthorized') return <p className="p-6 text-sm">Please sign in as an admin.</p>
  if (error === 'admin_not_configured') return <p className="p-6 text-sm">Admin access is not configured.</p>
  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>
  if (!report) return <p className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</p>

  const messages = report.session_json?.messages ?? []

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-[var(--color-theme-accent)]">← Back to list</button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="rounded border border-red-600 px-2 py-1 text-xs text-red-600 disabled:opacity-40"
        >
          {deleting ? 'Deleting…' : 'Delete report'}
        </button>
      </div>

      <header className="rounded-lg border border-[var(--color-theme-border)] p-3 text-sm">
        <p className="font-semibold">{report.category} · {report.session_title}</p>
        <p className="mt-1 whitespace-pre-wrap">{report.description}</p>
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
          {new Date(report.created_at).toLocaleString()} · {report.app_version} · {report.viewport} ·{' '}
          {report.email ?? 'no email'} · <span className="break-all">{report.user_agent}</span>
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border px-1 py-0.5">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col text-xs">
            Admin notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-16 rounded border px-1 py-0.5"
            />
          </label>
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-[var(--color-theme-accent)] px-3 py-1.5 text-sm text-[var(--color-theme-accent-contrast)] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {saveError && <p className="mt-1 text-xs text-red-600">Couldn&apos;t save: {saveError}</p>}
      </header>

      <section className="flex flex-col gap-4">
        {messages.map((m, i) => (
          <div key={m.id ?? i} className="rounded-lg border border-[var(--color-theme-border)] p-3">
            <p className="text-xs font-mono text-[var(--color-text-secondary)]">{m.role.toUpperCase()}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{m.text}</p>
            {m.role === 'assistant' && m.trace && (
              <div className="mt-3">
                <TrajectoryView
                  trace={m.trace}
                  userMessage={messages[i - 1]?.text ?? ''}
                  assistantText={m.text}
                />
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
