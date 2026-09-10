import { afterEach, expect, it, vi } from 'vitest'
import { createShare, fetchShare } from './shareApi'
import type { Session } from '@/types/session'

const session: Session = {
  id: 's1', createdAt: 1, updatedAt: 2, mode: 'freeform', modeParams: {},
  title: 'Ask Anything',
  messages: [
    { id: 'm1', role: 'user', text: 'hi' },
    { id: 'm2', role: 'assistant', text: 'hello', trace: { turnId: 't' } as never },
  ],
  notes: [{ id: 'n1', body: 'note', createdAt: 1, updatedAt: 1 }],
}

afterEach(() => vi.unstubAllGlobals())

it('createShare POSTs a trace-stripped session and returns the link', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ token: 'tok', url: 'http://x/#import=tok' }),
  })
  vi.stubGlobal('fetch', fetchMock)

  const out = await createShare(session)
  expect(out).toEqual({ token: 'tok', url: 'http://x/#import=tok' })

  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/share')
  const body = JSON.parse(init.body)
  expect(body.client_id).toMatch(/[0-9a-f-]{36}/)
  expect(body.session.title).toBe('Ask Anything')
  expect(body.session.notes[0].body).toBe('note')
  expect(body.session.messages).toHaveLength(2)
  expect(body.session.messages[1]).not.toHaveProperty('trace')
})

it('createShare strips the per-browser rotation slot from modeParams', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ token: 'tok', url: 'http://x/#import=tok' }),
  })
  vi.stubGlobal('fetch', fetchMock)

  const devotionalSession: Session = {
    ...session,
    mode: 'devotional',
    modeParams: { source: 'system', delivered: true, rotationSeed: 918273, rotationCursor: 5 },
  }
  await createShare(devotionalSession)

  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.session.modeParams).not.toHaveProperty('rotationSeed')
  expect(body.session.modeParams).not.toHaveProperty('rotationCursor')
  expect(body.session.modeParams).toEqual({ source: 'system', delivered: true })
})

it('createShare throws on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413, statusText: 'Payload Too Large' }))
  await expect(createShare(session)).rejects.toThrow(/413/)
})

it('fetchShare GETs the encoded token and returns the snapshot', async () => {
  const snap = {
    title: 'T', mode: 'freeform', modeParams: {}, messages: [], notes: [],
    shared_at: '2026-09-07T00:00:00.000Z',
  }
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snap })
  vi.stubGlobal('fetch', fetchMock)

  const out = await fetchShare('tok abc')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/share/tok%20abc')
  expect(out).toEqual(snap)
})

it('fetchShare throws with the status on 404', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))
  await expect(fetchShare('nope')).rejects.toThrow(/404/)
})
