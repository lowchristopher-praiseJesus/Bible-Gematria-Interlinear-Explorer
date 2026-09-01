import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrongsArtifact } from './StrongsArtifact'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { StrongsResponse } from '@/types/api'

const strongsFixture: StrongsResponse = {
  definition: {
    strongsNumber: 'H2720',
    root: 'חָרֵב',
    transliteration: 'chareb',
    transliteration1: 'chareb',
    transliteration2: 'chareb',
    partOfSpeech: 'Adjective',
    meaning: 'dry, desolate',
    // Straight from Complete.db — still carries the old Flask app's
    // cross-reference link, e.g. href="/strongs?strongsnumber=H2717".
    strongsDefinition: 'from <a href="/strongs?strongsnumber=H2717">H2717</a>; parched or ruined.',
    outline: null,
    note: null,
    usageCount: 10,
    verseCount: 8,
    bookCount: 3,
    value: 1,
  },
  verses: [],
  resultSummary: '8 verses found in 3 books',
}

describe('StrongsArtifact', () => {
  afterEach(() => {
    useArtifactStore.setState({ activeArtifact: null, history: [], status: 'idle', data: null, error: null })
  })

  it('renders the definition text, including the embedded cross-reference link', () => {
    render(<StrongsArtifact data={strongsFixture} />)
    expect(screen.getByText(/parched or ruined/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'H2717' })).toBeInTheDocument()
  })

  it('opens the cross-referenced Strong\'s entry in-app instead of navigating to the dead legacy route', async () => {
    render(<StrongsArtifact data={strongsFixture} />)
    await userEvent.click(screen.getByRole('link', { name: 'H2717' }))

    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'strongs',
      label: 'H2717 ▸',
      params: { id: 'H2717' },
    })
  })

  it('does not navigate the browser for the intercepted link (default is prevented)', async () => {
    render(<StrongsArtifact data={strongsFixture} />)
    const link = screen.getByRole('link', { name: 'H2717' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a click that lands outside any link alone', async () => {
    render(<StrongsArtifact data={strongsFixture} />)
    await userEvent.click(screen.getByText(/parched or ruined/))
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
  })

  it('shows the result summary when there is no definition to render', () => {
    render(<StrongsArtifact data={{ definition: null, verses: [], resultSummary: 'No results for zzz' }} />)
    expect(screen.getByText('No results for zzz')).toBeInTheDocument()
  })
})
