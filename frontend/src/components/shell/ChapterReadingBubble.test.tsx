import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChapterReadingBubble } from './ChapterReadingBubble'
import { useArtifactStore } from '@/store/useArtifactStore'
import * as chatApi from '@/lib/chatApi'
import type { ChapterResponse } from '@/types/api'

const chapterFixture: ChapterResponse = {
  book: 'Job',
  chapter: 1,
  verseCount: 2,
  verses: [
    {
      versenumber: 12871,
      vnum: 1,
      ref: 'Job 1:1',
      translations: {
        'eng-KJV': 'There was a man in the land of Uz.',
        'eng-NIV': 'In the land of Uz there lived a man.',
      },
    },
    {
      versenumber: 12872,
      vnum: 2,
      ref: 'Job 1:2',
      translations: {
        'eng-KJV': 'And there were born unto him seven sons.',
        'eng-NIV': 'He had seven sons and three daughters.',
      },
    },
  ],
}

const link = { type: 'chapter' as const, label: 'Read JOB 1 ▸', params: { reference: 'JOB 1' } }

describe('ChapterReadingBubble', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

  it('is collapsed by default and fetches nothing until expanded', () => {
    const fetchChapter = vi.spyOn(chatApi, 'fetchChapter')
    render(<ChapterReadingBubble link={link} />)
    expect(screen.getByRole('button', { name: /read job 1/i })).toBeInTheDocument()
    expect(fetchChapter).not.toHaveBeenCalled()
  })

  it('fetches and renders the chapter verses on first expand, defaulting to the KJV translation', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(chapterFixture)
    render(<ChapterReadingBubble link={link} />)

    await userEvent.click(screen.getByRole('button', { name: /read job 1/i }))

    expect(chatApi.fetchChapter).toHaveBeenCalledWith('JOB 1', { fast: true })
    expect(await screen.findByText(/There was a man in the land of Uz/)).toBeInTheDocument()
    expect(screen.getByText(/And there were born unto him seven sons/)).toBeInTheDocument()
  })

  it('paints the fast KJV-only fetch immediately, then fills in other translations from a background fetch', async () => {
    const kjvOnlyFixture: ChapterResponse = {
      book: 'Job',
      chapter: 1,
      verseCount: 2,
      verses: [
        { versenumber: 12871, vnum: 1, ref: 'Job 1:1', translations: { 'eng-KJV': 'There was a man in the land of Uz.' } },
        { versenumber: 12872, vnum: 2, ref: 'Job 1:2', translations: { 'eng-KJV': 'And there were born unto him seven sons.' } },
      ],
    }
    let resolveFull!: (value: ChapterResponse) => void
    const fullPromise = new Promise<ChapterResponse>((resolve) => {
      resolveFull = resolve
    })
    vi.spyOn(chatApi, 'fetchChapter').mockImplementation((_ref, opts) =>
      opts?.fast ? Promise.resolve(kjvOnlyFixture) : fullPromise
    )
    render(<ChapterReadingBubble link={link} />)
    await userEvent.click(screen.getByRole('button', { name: /read job 1/i }))

    // KJV text is on screen right away — only KJV is on offer yet, and a
    // subtle note says more translations are still coming in.
    expect(await screen.findByText(/There was a man in the land of Uz/)).toBeInTheDocument()
    const selectBeforeMerge = screen.getByLabelText(/translation/i) as HTMLSelectElement
    expect(Array.from(selectBeforeMerge.options).map((o) => o.textContent)).toEqual(['KJV'])
    expect(screen.getByText(/more translations loading/i)).toBeInTheDocument()

    resolveFull(chapterFixture)

    // Once the background fetch resolves, the dropdown gains NIV without
    // disturbing the KJV text already being read.
    await waitFor(() => expect(screen.queryByText(/more translations loading/i)).not.toBeInTheDocument())
    expect(screen.getByText(/There was a man in the land of Uz/)).toBeInTheDocument()
    const select = screen.getByLabelText(/translation/i) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['KJV', 'NIV'])
  })

  it('offers every translation returned across the passage\'s verses', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(chapterFixture)
    render(<ChapterReadingBubble link={link} />)
    await userEvent.click(screen.getByRole('button', { name: /read job 1/i }))
    await screen.findByText(/There was a man in the land of Uz/)

    const select = screen.getByLabelText(/translation/i) as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toEqual(['KJV', 'NIV'])
  })

  it('switches the displayed translation via the version selector', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(chapterFixture)
    render(<ChapterReadingBubble link={link} />)
    await userEvent.click(screen.getByRole('button', { name: /read job 1/i }))
    await screen.findByText(/There was a man in the land of Uz/)

    await userEvent.selectOptions(screen.getByLabelText(/translation/i), 'NIV')

    expect(screen.getByText(/In the land of Uz there lived a man/)).toBeInTheDocument()
    expect(screen.queryByText(/There was a man in the land of Uz\./)).not.toBeInTheDocument()
  })

  it('shows a fallback for a verse missing the selected translation', async () => {
    const partialFixture: ChapterResponse = {
      book: 'Job',
      chapter: 1,
      verseCount: 2,
      verses: [
        { versenumber: 12871, vnum: 1, ref: 'Job 1:1', translations: { 'eng-KJV': 'There was a man in the land of Uz.' } },
        { versenumber: 12872, vnum: 2, ref: 'Job 1:2', translations: {} },
      ],
    }
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(partialFixture)
    render(<ChapterReadingBubble link={link} />)
    await userEvent.click(screen.getByRole('button', { name: /read job 1/i }))

    expect(await screen.findByText(/There was a man in the land of Uz/)).toBeInTheDocument()
    expect(screen.getByText('(translation unavailable)')).toBeInTheDocument()
  })

  it('decodes HTML entities in verse text', async () => {
    const entityFixture: ChapterResponse = {
      book: 'Job',
      chapter: 1,
      verseCount: 1,
      verses: [
        {
          versenumber: 12875,
          vnum: 5,
          ref: 'Job 1:5',
          translations: { 'eng-KJV': 'Job said, &#8220;It may be&#8221; that my sons have sinned.' },
        },
      ],
    }
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(entityFixture)
    render(<ChapterReadingBubble link={link} />)
    await userEvent.click(screen.getByRole('button', { name: /read job 1/i }))

    expect(await screen.findByText('Job said, “It may be” that my sons have sinned.')).toBeInTheDocument()
  })

  it('opens the interlinear artifact for a verse when its number is clicked', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(chapterFixture)
    vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue({
      verse: { id: 12872, ref: 'Job 1:2', bnum: 18, cnum: 1, vnum: 2, Ch: '', wordnum: 0, letternum: 0, total: 0, text1769: '', textAV1611: '', language: 'Hebrew', originalText: '', stephanusText: null, stephanusTotal: null, lcFiles: [], hasQere: false, code: null, alert: null },
      navigation: { previous: 12871, next: 12873 },
      kjvWords: [],
      originalWords: [],
      strongsDefinitions: {},
    })
    render(<ChapterReadingBubble link={link} />)
    await userEvent.click(screen.getByRole('button', { name: /read job 1/i }))
    await screen.findByText(/And there were born unto him seven sons/)

    await userEvent.click(screen.getByRole('button', { name: /open job 1:2 in the original language/i }))

    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: 'Job 1:2 ▸',
      params: { versenumber: 12872 },
    })
  })

  it('fetches the full verse range for a parable-style reference and shows it as the passage label', async () => {
    const parableFixture: ChapterResponse = {
      book: 'Luke',
      chapter: 15,
      verseCount: 22,
      verses: [
        { versenumber: 25000, vnum: 11, ref: 'Luke 15:11', translations: { 'eng-KJV': 'A certain man had two sons.' } },
        { versenumber: 25001, vnum: 12, ref: 'Luke 15:12', translations: { 'eng-KJV': 'Give me the portion of goods that falleth to me.' } },
      ],
    }
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(parableFixture)
    const parableLink = { type: 'chapter' as const, label: 'Read Luke 15:11-32 ▸', params: { reference: 'Luke 15:11-32' } }
    render(<ChapterReadingBubble link={parableLink} />)

    await userEvent.click(screen.getByRole('button', { name: /read luke 15:11-32/i }))

    expect(chatApi.fetchChapter).toHaveBeenCalledWith('Luke 15:11-32')
    expect(await screen.findByText(/A certain man had two sons/)).toBeInTheDocument()
    expect(screen.getByText('Luke 15:11-32')).toBeInTheDocument()
  })
})
