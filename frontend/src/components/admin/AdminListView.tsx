import { useEffect, useState } from 'react'
import {
  listReports,
  deleteReport,
  deleteAllReports,
  type ReportListItem,
} from '@/lib/adminApi'

interface AdminListViewProps {
  onOpen: (id: string) => void
}

const STATUS_FILTERS = ['', 'new', 'triaged', 'resolved']
const CATEGORY_FILTERS = ['', 'wrong_answer', 'error', 'slow', 'ui', 'other']

export function AdminListView({ onOpen }: AdminListViewProps) {
  const [items, setItems] = useState<ReportListItem[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listReports({ status: status || undefined, category: category || undefined })
      .then((r) => {
        if (cancelled) return
        setItems(r.items)
        setTotal(r.total)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status, category, reloadKey])

  async function handleDeleteOne(id: string) {
    if (!window.confirm('Delete this report permanently?')) return
    setBusyId(id)
    setActionError(null)
    try {
      await deleteReport(id)
      setItems((prev) => prev.filter((it) => it.id !== id))
      setTotal((n) => Math.max(0, n - 1))
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleClearAll() {
    if (
      !window.confirm(
        `Delete ALL ${total} report(s) permanently? This cannot be undone.`,
      )
    )
      return
    setClearing(true)
    setActionError(null)
    try {
      await deleteAllReports()
      setItems([])
      setTotal(0)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setClearing(false)
    }
  }

  if (error === 'unauthorized') {
    return <p className="p-6 text-sm">Please sign in as an admin (HTTP Basic) to view reports.</p>
  }
  if (error === 'admin_not_configured') {
    return <p className="p-6 text-sm">Admin access is not configured on this server.</p>
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border px-1 py-0.5">
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{s || 'all'}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border px-1 py-0.5">
            {CATEGORY_FILTERS.map((c) => (
              <option key={c} value={c}>{c || 'all'}</option>
            ))}
          </select>
        </label>
        <span className="text-[var(--color-text-secondary)]">{total} report(s)</span>
        <button
          type="button"
          onClick={handleClearAll}
          disabled={clearing || total === 0}
          className="ml-auto rounded border border-red-600 px-2 py-0.5 text-xs text-red-600 disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Clear all'}
        </button>
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {actionError && <p className="mb-2 text-sm text-red-600">Couldn&apos;t delete: {actionError}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-[var(--color-text-secondary)]">
            <tr>
              <th className="py-1">When</th>
              <th>Category</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Msgs</th>
              <th>Session</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                onClick={() => onOpen(it.id)}
                className="cursor-pointer border-t border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
              >
                <td className="py-1.5">{new Date(it.created_at).toLocaleString()}</td>
                <td>{it.category}</td>
                <td>{it.status}</td>
                <td>{it.session_mode}</td>
                <td>{it.message_count}</td>
                <td>{it.session_title}</td>
                <td>{it.has_email ? '✉' : ''}</td>
                <td>
                  <button
                    type="button"
                    aria-label={`Delete report ${it.id}`}
                    title="Delete report"
                    disabled={busyId === it.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteOne(it.id)
                    }}
                    className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-[var(--color-surface-alt)] disabled:opacity-40"
                  >
                    {busyId === it.id ? '…' : '✕'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
