import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBookContext,
  fetchChapter,
  fetchEnglishSearch,
  fetchGematria,
  fetchInterlinear,
  fetchStrongsEntry,
  postChat,
  postChatStream,
  postDevotionalAudio,
  streamStoryIllustrations,
  toWireModeParams,
} from './chatApi'
import type { PhaseResult } from '@/types/session'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
  )
}

function postedBody() {
  const [, init] = vi.mocked(fetch).mock.calls[0]
  return JSON.parse((init as RequestInit).body as string)
}

/** A `body.getReader()` stand-in that replays `frames` one chunk per
 * `read()` call, encoded exactly as the raw bytes a fetch body would
 * deliver — callers can split one SSE frame across multiple entries to
 * exercise the buffering logic. */
function fakeReader(frames: string[]) {
  let i = 0
  return {
    read: async () => {
      if (i < frames.length) {
        return { done: false, value: new TextEncoder().encode(frames[i++]) }
      }
      return { done: true, value: undefined }
    },
  }
}

function mockStreamFetch(frames: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => fakeReader(frames) } })
  )
}

describe('chatApi', () => {
  it('postChat posts to /api/bible-chat/chat', async () => {
    mockFetchOnce({ type: 'chat', message: 'hi' })
    const result = await postChat({ message: 'hello' })
    expect(result.message).toBe('hi')
    expect(fetch).toHaveBeenCalledWith(
      '/api/bible-chat/chat',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('postChat translates parableId to parable_id in mode_params', async () => {
    mockFetchOnce({ type: 'chat', message: 'hi' })
    await postChat({ message: '', mode: 'parable', mode_params: { parableId: 'prodigal_son' } })
    expect(postedBody().mode_params).toEqual({ parable_id: 'prodigal_son' })
  })

  it('postChat translates dayIndex and completedDays to snake_case in mode_params', async () => {
    mockFetchOnce({ type: 'chat', message: 'hi' })
    await postChat({
      message: '',
      mode: 'reading_plan',
      mode_params: { plan: 'chronological', dayIndex: 1, completedDays: [0] },
    })
    expect(postedBody().mode_params).toEqual({
      plan: 'chronological',
      day_index: 1,
      completed_days: [0],
    })
  })

  it('postChat passes reference through unchanged in mode_params', async () => {
    mockFetchOnce({ type: 'chat', message: 'hi' })
    await postChat({ message: '', mode: 'verse', mode_params: { reference: 'John 3:16' } })
    expect(postedBody().mode_params).toEqual({ reference: 'John 3:16' })
  })

  it('fetchInterlinear converts USFM reference to full name before calling /api/explorer', async () => {
    mockFetchOnce({ verse: { ref: 'Matthew 6:28' } })
    await fetchInterlinear('MAT 6:28')
    expect(fetch).toHaveBeenCalledWith('/api/explorer?reference=Matthew%206%3A28')
  })

  it('fetchInterlinear strips a verse range down to its start verse', async () => {
    mockFetchOnce({ verse: { ref: 'John 3:16' } })
    await fetchInterlinear('JHN 3:16-18')
    expect(fetch).toHaveBeenCalledWith('/api/explorer?reference=John%203%3A16')
  })

  it('fetchInterlinear strips a verse range for a full book name reference', async () => {
    mockFetchOnce({ verse: { ref: '1 Corinthians 13:4' } })
    await fetchInterlinear('1 Corinthians 13:4-7')
    expect(fetch).toHaveBeenCalledWith('/api/explorer?reference=1%20Corinthians%2013%3A4')
  })

  it('fetchInterlinear leaves a bare book/chapter reference (no verse) unchanged', async () => {
    mockFetchOnce({ verse: { ref: 'Matthew 6' } })
    await fetchInterlinear('MAT 6')
    expect(fetch).toHaveBeenCalledWith('/api/explorer?reference=Matthew%206')
  })

  it('fetchChapter calls /passage without a fast flag by default', async () => {
    mockFetchOnce({ book: 'Job', chapter: 1, verseCount: 1, verses: [] })
    await fetchChapter('JOB 1')
    expect(fetch).toHaveBeenCalledWith('/api/bible-chat/passage?reference=Job+1')
  })

  it('fetchChapter passes fast=true through to /passage when requested', async () => {
    mockFetchOnce({ book: 'Job', chapter: 1, verseCount: 1, verses: [] })
    await fetchChapter('JOB 1', { fast: true })
    expect(fetch).toHaveBeenCalledWith('/api/bible-chat/passage?reference=Job+1&fast=true')
  })

  it('fetchStrongsEntry calls /api/strongs', async () => {
    mockFetchOnce({ definition: null, verses: [], resultSummary: 'No results' })
    await fetchStrongsEntry('G26')
    expect(fetch).toHaveBeenCalledWith('/api/strongs?strongsnumber=G26')
  })

  it('fetchBookContext calls the bible-chat book_context endpoint', async () => {
    mockFetchOnce({ book: 'MAT', book_name: 'Matthew', sections: {} })
    await fetchBookContext('MAT')
    expect(fetch).toHaveBeenCalledWith('/api/bible-chat/book_context/MAT')
  })

  it('fetchGematria calls /api/gematria', async () => {
    mockFetchOnce({ wordResults: [], verseResults: [], strongsDefinitions: {}, resultSummaryWords: '', resultSummaryVerses: '' })
    await fetchGematria(777)
    expect(fetch).toHaveBeenCalledWith('/api/gematria?value=777')
  })

  it('fetchEnglishSearch calls /api/english', async () => {
    mockFetchOnce({ searchTerm: 'love', results: [], resultSummary: 'No results' })
    await fetchEnglishSearch('love')
    expect(fetch).toHaveBeenCalledWith('/api/english?words=love')
  })

  it('postDevotionalAudio posts reference+text and resolves audio_url against CHAT_API', async () => {
    mockFetchOnce({ audio_url: '/devotional-audio/abc123.mp3' })
    const result = await postDevotionalAudio('JHN 14:27', 'Peace be with you.')
    expect(postedBody()).toEqual({ reference: 'JHN 14:27', text: 'Peace be with you.' })
    expect(result.audio_url).toBe('/api/bible-chat/devotional-audio/abc123.mp3')
  })

  it('postChat throws on a non-ok response instead of resolving with the error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'boom' }),
      })
    )
    await expect(postChat({ message: 'hi' })).rejects.toThrow(/500/)
  })

  it('toWireModeParams maps seriesId and conceptSlug to snake_case', () => {
    expect(toWireModeParams({ seriesId: 'present-day-ministry-of-jesus', conceptSlug: 'grace' })).toEqual({
      series_id: 'present-day-ministry-of-jesus',
      concept_slug: 'grace',
    })
  })

  it('toWireModeParams maps characterId to character_id', () => {
    expect(toWireModeParams({ characterId: 'david' })).toEqual({ character_id: 'david' })
  })

  it('toWireModeParams maps rotationSeed and rotationCursor to snake_case', () => {
    expect(toWireModeParams({ rotationSeed: 7, rotationCursor: 2 })).toEqual({
      rotation_seed: 7,
      rotation_cursor: 2,
    })
  })

  it('maps Tell a Story mode_params keys to their snake_case wire names', () => {
    const wire = toWireModeParams({
      storyThemes: [{ id: 't1', label: 'Trust', description: 'desc' }],
      storyDigest: 'a digest',
      storySelectedThemeIds: ['t1'],
      storyAgeRange: '7-8',
      storySourceMessages: [{ role: 'user', text: 'hi' }],
      storySourceSessionId: 'sess-1',
      storySourceLabel: 'Socratic Study',
    })
    expect(wire).toEqual({
      story_themes: [{ id: 't1', label: 'Trust', description: 'desc' }],
      story_digest: 'a digest',
      story_selected_theme_ids: ['t1'],
      story_age_range: '7-8',
      source_messages: [{ role: 'user', text: 'hi' }],
      storySourceSessionId: 'sess-1',
      storySourceLabel: 'Socratic Study',
    })
  })
})

describe('postChatStream', () => {
  it('calls onChunk for each streamed chunk and resolves with the final result plus trace', async () => {
    mockStreamFetch([
      'data: {"type":"stream","chunk":"Hel","text":"Hel"}\n\n',
      'data: {"type":"stream","chunk":"lo","text":"Hello"}\n\n',
      'data: {"type":"final","result":{"type":"chat","message":"Hello there","route":"AI Fallback"}}\n\n',
      'data: {"type":"trace","trace":{"turnId":"t1"}}\n\n',
    ])
    const onChunk = vi.fn()

    const result = await postChatStream({ message: 'hi' }, { onChunk })

    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hel')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'Hello')
    expect(result).toEqual({
      type: 'chat',
      message: 'Hello there',
      route: 'AI Fallback',
      trace: { turnId: 't1' },
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/bible-chat/chat/stream',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('resolves with just the final result for a turn that never streams a chunk', async () => {
    mockStreamFetch([
      'data: {"type":"final","result":{"type":"verse","message":"Jesus wept.","route":"deterministic"}}\n\n',
      'data: {"type":"trace","trace":{"turnId":"t2"}}\n\n',
    ])

    const result = await postChatStream({ message: 'quote John 11:35' })

    expect(result.message).toBe('Jesus wept.')
    expect(result.trace).toEqual({ turnId: 't2' })
  })

  it('reassembles an SSE frame split across multiple reads', async () => {
    mockStreamFetch([
      'data: {"type":"stre',
      'am","chunk":"Hi","text":"Hi"}\n\n',
      'data: {"type":"final","result":{"type":"chat","message":"Hi"}}\n\n',
    ])
    const onChunk = vi.fn()

    const result = await postChatStream({ message: 'hi' }, { onChunk })

    expect(onChunk).toHaveBeenCalledWith('Hi')
    expect(result.message).toBe('Hi')
  })

  it('throws on a non-ok response instead of trying to read a stream body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' })
    )
    await expect(postChatStream({ message: 'hi' })).rejects.toThrow(/500/)
  })

  it('throws if the stream ends without ever sending a final event', async () => {
    mockStreamFetch(['data: {"type":"trace","trace":{}}\n\n'])
    await expect(postChatStream({ message: 'hi' })).rejects.toThrow(/Stream ended without a response/)
  })
})

describe('postChat trace passthrough', () => {
  it('returns the trace field from the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'chat', message: 'hi', trace: { turnId: 'x', steps: [] } }),
    }))
    const res = await postChat({ message: 'hi' })
    expect(res.trace).toEqual({ turnId: 'x', steps: [] })
    vi.unstubAllGlobals()
  })
})

describe('postChatStream phase events', () => {
  it('calls onPhase for each phase event and still resolves with the final result', async () => {
    mockStreamFetch([
      'data: {"type":"phase","phase":{"index":1,"title":"Context","status":"done","markdown":"a"}}\n\n',
      'data: {"type":"phase","phase":{"index":2,"title":"Semantics","status":"done","markdown":"b"}}\n\n',
      'data: {"type":"final","result":{"type":"chat","message":"report"}}\n\n',
      'data: {"type":"trace","trace":{}}\n\n',
    ])
    const phases: PhaseResult[] = []
    const result = await postChatStream({ message: 'run it' }, { onPhase: (p) => phases.push(p) })
    expect(phases.map((p) => p.index)).toEqual([1, 2])
    expect(phases[0].title).toBe('Context')
    expect(result.message).toBe('report')
  })

  it('ignores phase events when no onPhase handler is given', async () => {
    mockStreamFetch([
      'data: {"type":"phase","phase":{"index":1,"title":"Context","status":"done","markdown":"a"}}\n\n',
      'data: {"type":"final","result":{"type":"chat","message":"report"}}\n\n',
    ])
    await expect(postChatStream({ message: 'run it' })).resolves.toMatchObject({ message: 'report' })
  })

  it('calls onPassage with the resolved reference before any phase', async () => {
    mockStreamFetch([
      'data: {"type":"passage","reference":"ROM 8:1"}\n\n',
      'data: {"type":"phase","phase":{"index":1,"title":"Context","status":"done","markdown":"a"}}\n\n',
      'data: {"type":"final","result":{"type":"chat","message":"report"}}\n\n',
    ])
    let received: string | undefined
    const result = await postChatStream({ message: 'run it' }, { onPassage: (r) => { received = r } })
    expect(received).toBe('ROM 8:1')
    expect(result.message).toBe('report')
  })
})

describe('streamStoryIllustrations', () => {
  it('yields one item per newline-delimited JSON line', async () => {
    mockStreamFetch([
      '{"index":-1,"image_url":"/story-images/a.png"}\n{"index":0,"image_url":"/story-images/b.png"}\n',
    ])
    const items = []
    for await (const item of streamStoryIllustrations({ characters: '', cover_scene: 'cover', page_scenes: ['p1'] })) {
      items.push(item)
    }
    expect(items).toEqual([
      { index: -1, image_url: '/api/bible-chat/story-images/a.png' },
      { index: 0, image_url: '/api/bible-chat/story-images/b.png' },
    ])
  })

  it('prefixes every image_url with the chatbot proxy path, leaving null ones null', async () => {
    // '/story-images/...' only exists on the chatbot service, reachable
    // through the /api/bible-chat proxy — same as postDevotionalAudio's
    // audio_url. A bare backend path would 404 against the Flask app.
    mockStreamFetch([
      '{"index":-1,"image_url":"/story-images/cover.png"}\n{"index":0,"image_url":null,"error":"x"}\n',
    ])
    const items = []
    for await (const item of streamStoryIllustrations({ characters: '', cover_scene: 'cover', page_scenes: ['p1'] })) {
      items.push(item)
    }
    expect(items[0].image_url).toBe('/api/bible-chat/story-images/cover.png')
    expect(items[1].image_url).toBeNull()
  })

  it('reassembles a line split across multiple read() chunks', async () => {
    mockStreamFetch(['{"index":-1,"ima', 'ge_url":"/story-images/a.png"}\n'])
    const items = []
    for await (const item of streamStoryIllustrations({ characters: '', cover_scene: 'cover', page_scenes: [] })) {
      items.push(item)
    }
    expect(items).toEqual([{ index: -1, image_url: '/api/bible-chat/story-images/a.png' }])
  })

  it('yields a trailing line with no terminating newline', async () => {
    mockStreamFetch(['{"index":0,"image_url":null,"error":"rate limited"}'])
    const items = []
    for await (const item of streamStoryIllustrations({ characters: '', cover_scene: 'cover', page_scenes: ['p1'] })) {
      items.push(item)
    }
    expect(items).toEqual([{ index: 0, image_url: null, error: 'rate limited' }])
  })

  it('posts to /api/bible-chat/story/illustrations with the given payload', async () => {
    mockStreamFetch(['{"index":-1,"image_url":"/story-images/a.png"}\n'])
    const payload = { characters: 'Zara: red hair.', cover_scene: 'A cover.', page_scenes: ['Page one.'] }
    const drained = []
    for await (const item of streamStoryIllustrations(payload)) drained.push(item)
    expect(drained).toHaveLength(1)
    expect(fetch).toHaveBeenCalledWith(
      '/api/bible-chat/story/illustrations',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) })
    )
  })
})
