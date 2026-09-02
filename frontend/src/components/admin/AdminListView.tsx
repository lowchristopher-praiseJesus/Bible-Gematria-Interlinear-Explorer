import { useEffect, useState } from 'react'
import { listReports, type ReportListItem } from '@/lib/adminApi'

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
  }, [status, category])

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
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
