import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoiceSession } from './voiceApi'

describe('createVoiceSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the offer with the key in a header and returns session id + answer sdp', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ session_id: 'live_123', sdp: 'answer-sdp' }), { status: 200 }))

    const result = await createVoiceSession('offer-sdp', 'sk-test-123')

    expect(result).toEqual({ sessionId: 'live_123', sdp: 'answer-sdp' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/bible-chat/voice/session')
    expect(init?.headers).toMatchObject({ 'X-OpenAI-Key': 'sk-test-123' })
    expect(JSON.parse(init?.body as string)).toEqual({ sdp: 'offer-sdp' })
  })

  it('throws the backend detail message on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "Couldn't start a voice session — check your OpenAI API key in Settings." }),
        { status: 401 }
      )
    )

    await expect(createVoiceSession('offer-sdp', 'bad-key')).rejects.toThrow(/check your OpenAI API key/)
  })

  it('falls back to a status-based message when the error body has no detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 500, statusText: 'Server Error' }))

    await expect(createVoiceSession('offer-sdp', 'sk-test-123')).rejects.toThrow(/500/)
  })
})
