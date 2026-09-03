import { useCallback, useState } from 'react'
import { AdminShell } from './AdminShell'
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
    <AdminShell>
      {id ? (
        <AdminReportView key={id} id={id} onBack={back} onDeleted={back} />
      ) : (
        <AdminListView onOpen={open} />
      )}
    </AdminShell>
  )
}

export default AdminApp
