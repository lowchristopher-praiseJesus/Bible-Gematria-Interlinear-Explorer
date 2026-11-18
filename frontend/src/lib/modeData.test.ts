import { afterEach, describe, expect, it, vi } from 'vitest'
import { listApologeticsTracks, resetApologeticsTracksCache } from './modeData'

const TRACKS = [{ id: 't1', title: 'Track One', blurb: 'b', shorts: [] }]

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('listApologeticsTracks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetApologeticsTracksCache()
  })

  it('fetches once and reuses the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ tracks: TRACKS }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listApologeticsTracks()).toEqual(TRACKS)
    expect(await listApologeticsTracks()).toEqual(TRACKS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/bible-chat/apologetics/tracks')
  })

  it('does not cache a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(ok({ tracks: TRACKS }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listApologeticsTracks()).rejects.toBeTruthy()
    expect(await listApologeticsTracks()).toEqual(TRACKS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
