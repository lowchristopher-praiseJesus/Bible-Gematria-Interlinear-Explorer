import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as chatApi from '@/lib/chatApi'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useTranslationSettingsStore } from '@/store/useTranslationSettingsStore'
import { PassageSearchArtifact } from './PassageSearchArtifact'
import type { PassageSearchArtifactParams } from '@/types/session'
import type { ChapterResponse } from '@/types/api'

const CHAPTER: ChapterResponse = {
  book: '1 Thessalonians',
  chapter: 4,
  verseCount: 1,
  verses: [
    {
      versenumber: 29001,
      vnum: 16,
      ref: '1 Thessalonians 4:16',
      translations: {
        'eng-KJV': 'KJV: the Lord himself shall descend.',
        'eng-NIV': 'NIV: the Lord himself will come down.',
      },
    },
  ],
}

const BASE: PassageSearchArtifactParams = {
  query: 'Where is the rapture talked about in the Bible?',
  kind: 'statement',
  label: '',
  phrasings: ['caught up together'],
  verified: true,
  semantic: true,
  credits: [],
  passages: [
    {
      ref: '1 Thessalonians 4:16-17',
      first_ref: '1 Thessalonians 4:16',
      text: '[16] For the Lord himself shall descend from heaven [17] Then we which are alive and remain shall be caught up',
      reason: 'Describes believers being caught up to meet the Lord.',
      sources: ['embedding', 'keyword'],
    },
    { ref: 'John 14:1-3', first_ref: 'John 14:1', text: '[3] I will come again', reason: '', sources: ['embedding'] },
  ],
}

describe('PassageSearchArtifact', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, history: [], status: 'idle', data: null, error: null })
    useTranslationSettingsStore.setState({ defaultTranslationAbbr: 'KJV' })
    // Default: the verse fetch fails, so every card shows its server-sent snippet.
    vi.spyOn(chatApi, 'fetchChapter').mockRejectedValue(new Error('offline'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the query, each passage, its reason and text', async () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.getByText(/Where is the rapture talked about/)).toBeInTheDocument()
    expect(screen.getByText('Describes believers being caught up to meet the Lord.')).toBeInTheDocument()
    expect(await screen.findByText(/shall descend from heaven/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1 Thessalonians 4:16-17' })).toHaveAttribute(
      'href', '/explorer?reference=1%20Thessalonians%204%3A16',
    )
  })

  it('omits the reason line when a passage has none', () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.getAllByTestId('passage-reason')).toHaveLength(1)
  })

  it('opens a passage in-app as an interlinear artifact instead of navigating to the dead legacy route', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue({} as Awaited<ReturnType<typeof chatApi.fetchInterlinear>>)
    render(<PassageSearchArtifact {...BASE} />)
    await userEvent.click(screen.getByRole('link', { name: 'John 14:1-3' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear', label: 'John 14:1-3 ▸', params: { reference: 'John 14:1' },
    })
    await waitFor(() => expect(useArtifactStore.getState().status).toBe('ready'))
    expect(chatApi.fetchInterlinear).toHaveBeenCalledWith('John 14:1')
    expect(useArtifactStore.getState().error).toBeNull()
  })

  it('notes when relevance was not verified and when semantic search was unavailable', () => {
    render(<PassageSearchArtifact {...BASE} verified={false} semantic={false} />)
    expect(screen.getByText(/relevance not verified/i)).toBeInTheDocument()
    expect(screen.getByText(/semantic search unavailable/i)).toBeInTheDocument()
  })

  it('shows neither note for a verified semantic result', () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.queryByText(/relevance not verified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/semantic search unavailable/i)).not.toBeInTheDocument()
  })

  it('shows the search phrasings used and any credits', () => {
    render(<PassageSearchArtifact {...BASE} credits={['Cross-references: OpenBible.info (CC-BY)']} />)
    expect(screen.getByText(/caught up together/)).toBeInTheDocument()
    expect(screen.getByText(/OpenBible.info/)).toBeInTheDocument()
  })

  it('frames a passage query by its label and marks cross-reference hits', () => {
    render(
      <PassageSearchArtifact
        {...BASE}
        kind="passage"
        label="Romans 8:28"
        query="Romans 8:28"
        phrasings={[]}
        passages={[{ ...BASE.passages[0], sources: ['cross_reference'] }]}
      />,
    )
    expect(screen.getByText(/related to Romans 8:28/i)).toBeInTheDocument()
    expect(screen.getByText(/cross-reference/i)).toBeInTheDocument()
  })

  it('renders an empty or malformed card (old or imported) without crashing', () => {
    render(<PassageSearchArtifact {...(BASE as PassageSearchArtifactParams)} passages={undefined as never} phrasings={undefined as never} credits={undefined as never} />)
    expect(screen.getByText(/Where is the rapture talked about/)).toBeInTheDocument()
  })

  it('renders a passage that has no sources field', () => {
    const passage = { ref: 'Jude 1:3', first_ref: 'Jude 1:3', text: '[3] contend', reason: '' } as unknown as PassageSearchArtifactParams['passages'][number]
    render(<PassageSearchArtifact {...BASE} passages={[passage]} />)
    expect(screen.getByRole('link', { name: 'Jude 1:3' })).toBeInTheDocument()
    expect(screen.queryByText('cross-reference')).not.toBeInTheDocument()
  })

  it('shows the not-exhaustive note only when there are passages', () => {
    const { rerender } = render(<PassageSearchArtifact {...BASE} />)
    expect(screen.getByText(/Not an exhaustive list/)).toBeInTheDocument()
    rerender(<PassageSearchArtifact {...BASE} passages={[]} />)
    expect(screen.queryByText(/Not an exhaustive list/)).not.toBeInTheDocument()
  })

  describe('verse box', () => {
    it('shows each passage in a verse box with a translation switcher and a compare button', async () => {
      vi.mocked(chatApi.fetchChapter).mockResolvedValue(CHAPTER)
      render(<PassageSearchArtifact {...BASE} />)
      expect(await screen.findAllByLabelText('Translation')).toHaveLength(2)
      expect(chatApi.fetchChapter).toHaveBeenCalledWith('1 Thessalonians 4:16-17', { fast: true })
      expect(chatApi.fetchChapter).toHaveBeenCalledWith('John 14:1-3', { fast: true })
      expect(screen.getAllByRole('button', { name: /Compare all verses in/ })).toHaveLength(2)
    })

    it('displays the passage in the default translation from the user setting', async () => {
      useTranslationSettingsStore.setState({ defaultTranslationAbbr: 'NIV' })
      vi.mocked(chatApi.fetchChapter).mockResolvedValue(CHAPTER)
      render(<PassageSearchArtifact {...BASE} passages={[BASE.passages[0]]} />)
      expect(await screen.findByText('NIV: the Lord himself will come down.')).toBeInTheDocument()
    })

    it('falls back to the server-sent snippet when the verses cannot be fetched', async () => {
      render(<PassageSearchArtifact {...BASE} passages={[BASE.passages[0]]} />)
      expect(await screen.findByText(/shall descend from heaven/)).toBeInTheDocument()
      expect(screen.queryByLabelText('Translation')).not.toBeInTheDocument()
      expect(screen.queryByText('offline')).not.toBeInTheDocument()
    })

    it('only fetches a card once it scrolls near view', async () => {
      const observed: Array<{ el: Element; fire: () => void }> = []
      class FakeIO {
        cb: IntersectionObserverCallback
        constructor(cb: IntersectionObserverCallback) {
          this.cb = cb
        }
        observe(el: Element) {
          observed.push({
            el,
            fire: () => this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as never),
          })
        }
        unobserve() {}
        disconnect() {}
      }
      vi.stubGlobal('IntersectionObserver', FakeIO)
      vi.mocked(chatApi.fetchChapter).mockResolvedValue(CHAPTER)
      render(<PassageSearchArtifact {...BASE} />)
      expect(chatApi.fetchChapter).not.toHaveBeenCalled()
      expect(screen.getByText(/shall descend from heaven/)).toBeInTheDocument()

      act(() => observed[0].fire())
      await waitFor(() => expect(chatApi.fetchChapter).toHaveBeenCalledWith('1 Thessalonians 4:16-17', { fast: true }))
      expect(chatApi.fetchChapter).not.toHaveBeenCalledWith('John 14:1-3', { fast: true })
    })
  })
})
