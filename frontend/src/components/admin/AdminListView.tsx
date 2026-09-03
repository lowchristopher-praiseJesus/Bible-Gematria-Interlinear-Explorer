import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CircleDot,
  Inbox,
  Layers,
  Mail,
  Trash2,
} from 'lucide-react'
import {
  listReports,
  deleteReport,
  deleteAllReports,
  type ReportListItem,
} from '@/lib/adminApi'
import { relativeTime } from '@/lib/relativeTime'
import { statusTone } from '@/lib/reportBadges'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Select,
  SkeletonRows,
  StatCard,
} from '@/components/ui'

interface AdminListViewProps {
  onOpen: (id: string) => void
}

const CATEGORY_FILTERS = ['', 'wrong_answer', 'error', 'slow', 'ui', 'other']

const prettify = (s: string) => s.replace(/_/g, ' ')

type Confirm = { kind: 'one'; id: string } | { kind: 'all' } | null

export function AdminListView({ onOpen }: AdminListViewProps) {
  // Status filtering is done client-side against the current page so the KPI
  // cards double as instant filters; category filtering round-trips to the
  // server. The list endpoint caps at 200 rows — ample for a triage queue,
  // and `total` still reports the true grand count.
  const [items, setItems] = useState<ReportListItem[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [confirm, setConfirm] = useState<Confirm>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listReports({ category: category || undefined, limit: 200 })
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
  }, [category, reloadKey])

  const counts = useMemo(() => {
    const c = { all: total, new: 0, triaged: 0, resolved: 0 } as Record<string, number>
    for (const it of items) if (it.status in c) c[it.status] += 1
    return c
  }, [items, total])

  const visible = useMemo(
    () => (status ? items.filter((it) => it.status === status) : items),
    [items, status],
  )

  function toggleStatus(next: string) {
    setStatus((cur) => (cur === next ? '' : next))
  }

  async function runConfirm() {
    if (!confirm) return
    setPending(true)
    setActionError(null)
    try {
      if (confirm.kind === 'one') {
        await deleteReport(confirm.id)
        setItems((prev) => prev.filter((it) => it.id !== confirm.id))
        setTotal((n) => Math.max(0, n - 1))
      } else {
        await deleteAllReports()
        setItems([])
        setTotal(0)
        setReloadKey((k) => k + 1)
      }
      setConfirm(null)
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  if (error === 'unauthorized') {
    return (
      <AuthNotice text="Please sign in as an admin (HTTP Basic) to view reports." />
    )
  }
  if (error === 'admin_not_configured') {
    return <AuthNotice text="Admin access is not configured on this server." />
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-lg font-semibold text-admin-text">Reports</h1>
        <p className="mt-0.5 text-sm text-admin-muted">
          Troubleshooting reports users filed from their chat sessions.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total reports"
          value={counts.all}
          icon={Layers}
          loading={loading}
          active={status === ''}
          onClick={() => setStatus('')}
        />
        <StatCard
          label="New"
          value={counts.new}
          icon={CircleDot}
          accent="var(--admin-new)"
          loading={loading}
          active={status === 'new'}
          onClick={() => toggleStatus('new')}
        />
        <StatCard
          label="Triaged"
          value={counts.triaged}
          icon={AlertCircle}
          accent="var(--admin-triaged)"
          loading={loading}
          active={status === 'triaged'}
          onClick={() => toggleStatus('triaged')}
        />
        <StatCard
          label="Resolved"
          value={counts.resolved}
          icon={Inbox}
          accent="var(--admin-resolved)"
          loading={loading}
          active={status === 'resolved'}
          onClick={() => toggleStatus('resolved')}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-admin-border bg-admin-surface px-3.5 py-3">
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="min-w-40"
        >
          {CATEGORY_FILTERS.map((c) => (
            <option key={c} value={c}>
              {c ? prettify(c) : 'All categories'}
            </option>
          ))}
        </Select>
        <span className="pb-1.5 text-sm text-admin-muted">
          {visible.length === 1 ? '1 report' : `${visible.length} reports`}
          {status && total !== visible.length ? ` · ${total} total` : ''}
        </span>
        <Button
          variant="danger-outline"
          size="sm"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          className="ml-auto"
          disabled={total === 0}
          onClick={() => setConfirm({ kind: 'all' })}
        >
          Clear all
        </Button>
      </div>

      {actionError && (
        <p className="text-sm text-[var(--admin-danger)]">Couldn&apos;t delete: {actionError}</p>
      )}
      {error && !loading && (
        <p className="text-sm text-[var(--admin-danger)]">{error}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-admin-border bg-admin-surface">
        {loading ? (
          <SkeletonRows rows={6} cols={7} />
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Inbox}
              title={status || category ? 'No reports match these filters' : 'No reports yet'}
              description={
                status || category
                  ? 'Try clearing a filter to widen the search.'
                  : 'User-submitted troubleshooting reports will show up here.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-admin-raised text-xs uppercase tracking-wide text-admin-subtle">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-medium">
                  <th>When</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th className="text-right">Msgs</th>
                  <th>Session</th>
                  <th className="w-16" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => onOpen(it.id)}
                    className="group cursor-pointer border-t border-admin-border transition-colors hover:bg-admin-raised [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-middle"
                  >
                    <td className="whitespace-nowrap text-admin-muted" title={new Date(it.created_at).toLocaleString()}>
                      {relativeTime(it.created_at)}
                    </td>
                    <td>
                      <Badge tone="neutral">{prettify(it.category)}</Badge>
                    </td>
                    <td>
                      <Badge tone={statusTone(it.status)} dot>
                        {it.status}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-admin-muted">{it.session_mode}</td>
                    <td className="text-right tabular-nums text-admin-muted">{it.message_count}</td>
                    <td className="max-w-[16rem] truncate text-admin-text">
                      {it.session_title || <span className="text-admin-subtle">Untitled</span>}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {it.has_email && (
                          <Mail className="h-4 w-4 text-admin-subtle" aria-label="Reporter left an email" />
                        )}
                        <IconButton
                          label={`Delete report ${it.id}`}
                          tone="danger"
                          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                          disabled={pending}
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirm({ kind: 'one', id: it.id })
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o && !pending) {
            setConfirm(null)
            setActionError(null)
          }
        }}
        onConfirm={runConfirm}
        loading={pending}
        destructive
        title={confirm?.kind === 'all' ? 'Delete all reports?' : 'Delete this report?'}
        description={
          confirm?.kind === 'all'
            ? `This permanently removes all ${total} report(s), including their saved transcripts. This cannot be undone.`
            : 'This permanently removes the report and its saved transcript.'
        }
        confirmLabel={confirm?.kind === 'all' ? 'Delete all reports' : 'Delete report'}
      />
    </div>
  )
}

function AuthNotice({ text }: { text: string }) {
  return (
    <div className="mx-auto mt-10 max-w-sm rounded-xl border border-admin-border bg-admin-surface p-6 text-center text-sm text-admin-muted">
      {text}
    </div>
  )
}
