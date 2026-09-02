import { afterEach, expect, it, vi } from 'vitest'
import { listReports, getReport, updateReport, deleteReport, deleteAllReports } from './adminApi'

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

it('DELETEs one report by id', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: 'r1' }) })
  vi.stubGlobal('fetch', fetchMock)
  const out = await deleteReport('r1')
  expect(out).toEqual({ deleted: 'r1' })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/feedback/r1')
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
})

it('DELETEs all reports', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted_count: 4 }) })
  vi.stubGlobal('fetch', fetchMock)
  const out = await deleteAllReports()
  expect(out).toEqual({ deleted_count: 4 })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/feedback')
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
})
