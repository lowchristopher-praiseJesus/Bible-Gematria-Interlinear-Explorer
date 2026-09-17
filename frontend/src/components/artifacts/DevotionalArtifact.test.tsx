import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as chatApi from '@/lib/chatApi'
import { DevotionalArtifact } from './DevotionalArtifact'

describe('DevotionalArtifact', () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('renders the reference heading and the markdown body', () => {
    render(<DevotionalArtifact reference="JHN 14:27" text={'Peace is **not** the absence of a storm.\n\nIt is His presence in it.'} />)
    expect(screen.getByRole('heading', { name: 'JHN 14:27' })).toBeInTheDocument()
    expect(screen.getByText('not').tagName).toBe('STRONG')
    expect(screen.getByText(/It is His presence in it\./)).toBeInTheDocument()
  })

  it('copies the raw devotional text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<DevotionalArtifact reference="JHN 14:27" text={'# Title\n\nBody.'} />)
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith('# Title\n\nBody.')
  })

  it('opens the listen overlay when the Listen button is clicked', async () => {
    // A promise that never resolves (rather than mockResolvedValue's already-settled
    // one) is required here: userEvent.click's internal act()/microtask flushing
    // otherwise lets an immediately-resolving mock settle before this assertion runs,
    // racing past the loading state the test means to observe. The assertions below
    // only cover that loading state, so the promise is intentionally left unsettled —
    // resolving it here would fire DevotionalListenOverlay's state update after this
    // test body (and its act() scope) has already returned.
    const audioPromise = new Promise<{ audio_url: string }>(() => {})
    vi.spyOn(chatApi, 'postDevotionalAudio').mockReturnValue(audioPromise)
    render(<DevotionalArtifact reference="JHN 14:27" text="Peace be with you." />)

    expect(screen.queryByText(/preparing audio/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /listen/i }))
    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument()
  })

  it('primes audio playback synchronously in the click, before the fetch resolves', async () => {
    // Regression test: WebKit (mobile Safari / Chrome-on-iOS) only allows
    // audio.play() within a short window of a real user gesture. Real TTS
    // synthesis on a cache miss can take several seconds - long enough that
    // the overlay's own, later play() call (after its fetch resolves) is no
    // longer gesture-adjacent and gets silently rejected. Priming here,
    // synchronously in the click itself, unlocks playback for the rest of
    // the page so that later call succeeds regardless of how long
    // generation takes.
    const audioPromise = new Promise<{ audio_url: string }>(() => {})
    vi.spyOn(chatApi, 'postDevotionalAudio').mockReturnValue(audioPromise)
    render(<DevotionalArtifact reference="JHN 14:27" text="Peace be with you." />)

    await userEvent.click(screen.getByRole('button', { name: /listen/i }))

    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })
})
