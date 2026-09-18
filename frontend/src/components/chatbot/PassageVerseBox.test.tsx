import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PassageVerseBox } from './PassageVerseBox'
import { useArtifactStore } from '@/store/useArtifactStore'
import * as chatApi from '@/lib/chatApi'
import type { ChapterResponse } from '@/types/api'

const romansFixture: ChapterResponse = {
  book: 'Romans',
  chapter: 8,
  verseCount: 1,
  verses: [
    {
      versenumber: 28118,
      vnum: 1,
      ref: 'Romans 8:1',
      translations: {
        'eng-KJV': 'There is therefore now no condemnation to them which are in Christ Jesus.',
        'eng-NIV': 'Therefore, there is now no condemnation for those who are in Christ Jesus.',
      },
    },
  ],
}

describe('PassageVerseBox', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

  it('fetches and shows the passage text as soon as it mounts, with no click required', () => {
    const fetchChapter = vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(romansFixture)
    render(<PassageVerseBox reference="ROM 8:1" />)
    expect(fetchChapter).toHaveBeenCalledWith('ROM 8:1', { fast: true })
  })

  it('renders the verse text once fetched', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(romansFixture)
    render(<PassageVerseBox reference="ROM 8:1" />)
    expect(await screen.findByText(/no condemnation/)).toBeInTheDocument()
  })

  it('offers the same translation switcher and maximize button as the rest of the app', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(romansFixture)
    render(<PassageVerseBox reference="ROM 8:1" />)
    await screen.findByText(/no condemnation/)

    expect(screen.getByLabelText(/translation/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /compare all verses/i })).toBeInTheDocument()
  })

  it('opens the interlinear view when a verse number is clicked, same as elsewhere', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue(romansFixture)
    render(<PassageVerseBox reference="ROM 8:1" />)
    await screen.findByText(/no condemnation/)

    await userEvent.click(screen.getByRole('button', { name: /open romans 8:1 in the original language/i }))

    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: 'Romans 8:1 ▸',
      params: { versenumber: 28118 },
    })
  })
})
