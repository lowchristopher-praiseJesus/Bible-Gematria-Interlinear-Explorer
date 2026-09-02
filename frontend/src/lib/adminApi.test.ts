import { afterEach, expect, it, vi } from 'vitest'
import { listReports, getReport, updateReport } from './adminApi'

afterEach(() => vi.unstubAllGlobals())

it('lists reports with query params', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 0, items: [] }) })
  vi.stubGlobal('fetch', fetchMock)
  await listReports({ status: 'new', limit: 10 })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/feedback?status=new&limit=10')
})

it('maps 401 to an unauthorized error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }))
  await expect(getReport('x')).rejects.toThrow(/unauthorized/)
})

it('maps 503 to admin_not_configured', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }))
  await expect(listReports()).rejects.toThrow(/admin_not_configured/)
})

it('PATCHes a status update', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1', status: 'resolved' }) })
  vi.stubGlobal('fetch', fetchMock)
  const out = await updateReport('r1', { status: 'resolved' })
  expect(out.status).toBe('resolved')
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
})
