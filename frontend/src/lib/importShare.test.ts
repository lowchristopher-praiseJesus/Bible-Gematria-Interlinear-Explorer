import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { consumeImportParam } from './importShare'
import { useSessionsStore } from '@/store/useSessionsStore'
import * as shareApi from './shareApi'

function setImportParam(token: string | null) {
  // The token lives in the URL fragment now, not a query param.
  window.history.replaceState(
    {},
    '',
    window.location.pathname + (token ? `#import=${token}` : ''),
  )
}

const snap = {
  title: 'Devotional', mode: 'devotional' as const, modeParams: { source: 'system' as const },
  messages: [{ id: 'x', role: 'user' as const, text: 'hello' }], notes: [],
  shared_at: '2026-09-07T00:00:00.000Z',
}

beforeEach(() => {
  localStorage.clear()
  useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  setImportParam(null)
})
afterEach(() => vi.restoreAllMocks())

it('returns none when there is no import param', async () => {
  expect(await consumeImportParam()).toEqual({ status: 'none' })
})

it('fetches, imports, and reports the new session id', async () => {
  setImportParam('tok-1')
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue(snap)
  const result = await consumeImportParam()
  expect(result.status).toBe('imported')
  const id = (result as { sessionId: string }).sessionId
  const session = useSessionsStore.getState().sessions[id]
  expect(session.imported?.token).toBe('tok-1')
  expect(session.mode).toBe('devotional')
})

it('does not re-import a token whose session still exists — jumps to it', async () => {
  setImportParam('tok-2')
  const fetchSpy = vi.spyOn(shareApi, 'fetchShare').mockResolvedValue(snap)
  const first = await consumeImportParam()
  fetchSpy.mockClear()
  const second = await consumeImportParam()
  expect(second).toEqual({ status: 'duplicate', sessionId: (first as { sessionId: string }).sessionId })
  expect(fetchSpy).not.toHaveBeenCalled()
})

it('re-imports when the token was imported before but its session was deleted', async () => {
  setImportParam('tok-3')
  const fetchSpy = vi.spyOn(shareApi, 'fetchShare').mockResolvedValue(snap)
  const first = await consumeImportParam()
  const firstId = (first as { sessionId: string }).sessionId
  useSessionsStore.getState().deleteSession(firstId)
  fetchSpy.mockClear()

  const second = await consumeImportParam()
  expect(second.status).toBe('imported')
  const secondId = (second as { sessionId: string }).sessionId
  expect(secondId).not.toBe(firstId)
  expect(fetchSpy).toHaveBeenCalled()
  expect(useSessionsStore.getState().sessions[secondId].imported?.token).toBe('tok-3')
})

it('coerces an unknown mode to freeform', async () => {
  setImportParam('tok-bogus')
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue({ ...snap, mode: 'bogus' as never })
  const result = await consumeImportParam()
  expect(result.status).toBe('imported')
  const id = (result as { sessionId: string }).sessionId
  expect(useSessionsStore.getState().sessions[id].mode).toBe('freeform')
})

it('coerces a prototype-key mode ("toString") to freeform', async () => {
  setImportParam('tok-proto')
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue({ ...snap, mode: 'toString' as never })
  const result = await consumeImportParam()
  expect(result.status).toBe('imported')
  const id = (result as { sessionId: string }).sessionId
  expect(useSessionsStore.getState().sessions[id].mode).toBe('freeform')
})

it('maps a 404 to a not_found error', async () => {
  setImportParam('gone')
  vi.spyOn(shareApi, 'fetchShare').mockRejectedValue(new Error('Request failed: 404 Not Found'))
  expect(await consumeImportParam()).toEqual({ status: 'error', reason: 'not_found' })
})

it('maps any other failure to a network error', async () => {
  setImportParam('down')
  vi.spyOn(shareApi, 'fetchShare').mockRejectedValue(new Error('Failed to fetch'))
  expect(await consumeImportParam()).toEqual({ status: 'error', reason: 'network' })
})

it('maps a shapeless payload to a bad_data error', async () => {
  setImportParam('weird')
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue({ nope: true } as never)
  expect(await consumeImportParam()).toEqual({ status: 'error', reason: 'bad_data' })
})

it('imports the exact JSON shape GET /api/share/<token> returns (wire contract)', async () => {
  // This literal MUST stay in lockstep with the Flask `read_share` response
  // asserted in tests/test_share_api.py::test_get_returns_snapshot_without_client_id:
  //   { title, mode, modeParams, messages, notes, shared_at }  — snake_case
  //   `shared_at`, camelCase `modeParams`, no `client_id`. If either side
  //   renames a key, this test breaks instead of a silent drop in prod.
  const serverResponse = {
    title: 'Ask Anything',
    mode: 'freeform' as const,
    modeParams: {},
    messages: [
      { id: 'm1', role: 'user' as const, text: 'hi' },
      { id: 'm2', role: 'assistant' as const, text: 'hello', artifacts: [] },
    ],
    notes: [{ id: 'n1', body: 'my note', createdAt: 1, updatedAt: 1 }],
    shared_at: '2026-09-08T00:00:00.000Z',
  }
  setImportParam('tok-contract')
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue(serverResponse)

  const result = await consumeImportParam()
  expect(result.status).toBe('imported')
  const s = useSessionsStore.getState().sessions[(result as { sessionId: string }).sessionId]
  expect(s.title).toBe('Ask Anything')
  expect(s.mode).toBe('freeform')
  expect(s.modeParams).toEqual({})
  expect(s.messages.map((m) => m.text)).toEqual(['hi', 'hello'])
  expect(s.notes.map((n) => n.body)).toEqual(['my note'])
  expect(s.imported).toEqual({
    token: 'tok-contract',
    importedAt: expect.any(Number),
    sharedAt: '2026-09-08T00:00:00.000Z',
  })
})
