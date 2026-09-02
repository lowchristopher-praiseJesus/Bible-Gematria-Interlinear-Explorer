import { useCallback, useState } from 'react'
import { AdminListView } from './AdminListView'
import { AdminReportView } from './AdminReportView'

function currentId(): string | null {
  return new URLSearchParams(window.location.search).get('id')
}

export function AdminApp() {
  const [id, setId] = useState<string | null>(() => currentId())

  const open = useCallback((next: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('id', next)
    window.history.pushState({}, '', url)
    setId(next)
  }, [])

  const back = useCallback(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('id')
    window.history.pushState({}, '', url)
    setId(null)
  }, [])

  return (
    <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-theme-border)] px-4 py-2 text-sm font-semibold">
        Troubleshooting reports
      </header>
      {id ? <AdminReportView id={id} onBack={back} /> : <AdminListView onOpen={open} />}
    </div>
  )
}

export default AdminApp
