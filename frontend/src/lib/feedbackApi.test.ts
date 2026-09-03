import { afterEach, expect, it, vi } from 'vitest'
import { submitReport } from './feedbackApi'
import type { Session } from '@/types/session'

const session: Session = {
  id: 's1', createdAt: 1, updatedAt: 2, mode: 'freeform', modeParams: {},
  title: 'Ask Anything',
  messages: [
    { id: 'm1', role: 'user', text: 'hi' },
    { id: 'm2', role: 'assistant', text: 'hello', trace: { turnId: 't' } as never },
  ],
  notes: [],
}

afterEach(() => vi.unstubAllGlobals())

it('POSTs a reduced session plus metadata and returns the id', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r-9' }) })
  vi.stubGlobal('fetch', fetchMock)

  const out = await submitReport(session, { category: 'wrong_answer', description: 'bad' })
  expect(out).toEqual({ id: 'r-9' })

  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/feedback')
  const body = JSON.parse(init.body)
  expect(body.category).toBe('wrong_answer')
  expect(body.description).toBe('bad')
  expect(body.client_id).toMatch(/[0-9a-f-]{36}/)
  expect(body.session_json.messages).toHaveLength(2)
  expect(body.session_json.messages[1].trace.turnId).toBe('t')
  expect(body.session_json).not.toHaveProperty('createdAt')
})

it('throws on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413, statusText: 'Payload Too Large' }))
  await expect(submitReport(session, { category: 'other', description: 'x' })).rejects.toThrow(/413/)
})
