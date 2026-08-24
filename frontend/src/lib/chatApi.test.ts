import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBookContext,
  fetchEnglishSearch,
  fetchGematria,
  fetchInterlinear,
  fetchStrongsEntry,
  postChat,
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

  it('fetchInterlinear converts USFM reference to full name before calling /api/explorer', async () => {
    mockFetchOnce({ verse: { ref: 'Matthew 6:28' } })
    await fetchInterlinear('MAT 6:28')
    expect(fetch).toHaveBeenCalledWith('/api/explorer?reference=Matthew%206%3A28')
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
})
