import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBookContext,
  fetchChapter,
  fetchEnglishSearch,
  fetchGematria,
  fetchInterlinear,
  fetchStrongsEntry,
  fetchWikiConcept,
  postChat,
  toWireModeParams,
} from './chatApi'

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

  it('fetchWikiConcept requests the study-wiki page endpoint', async () => {
    const mockResponse = {
      series_id: 's1',
      slug: 'grace',
      title: 'Grace',
      kind: 'concept',
      body_html: '<p>Undeserved favor.</p>',
      citation: 'Joseph Prince — The Present-Day Ministry of Jesus',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockResponse }))
    const result = await fetchWikiConcept('s1', 'grace')
    expect(global.fetch).toHaveBeenCalledWith('/api/bible-chat/study-wikis/s1/pages/grace')
    expect(result.title).toBe('Grace')
  })
})
