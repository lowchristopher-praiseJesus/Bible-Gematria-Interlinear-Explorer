import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as chatApi from '@/lib/chatApi'
import { DevotionalArtifact } from './DevotionalArtifact'

describe('DevotionalArtifact', () => {
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
    // A deferred promise (rather than mockResolvedValue's already-settled one) is
    // required here: userEvent.click's internal act()/microtask flushing otherwise
    // lets an immediately-resolving mock settle before this assertion runs, racing
    // past the loading state the test means to observe.
    let resolveAudio!: (value: { audio_url: string }) => void
    const audioPromise = new Promise<{ audio_url: string }>((resolve) => {
      resolveAudio = resolve
    })
    vi.spyOn(chatApi, 'postDevotionalAudio').mockReturnValue(audioPromise)
    render(<DevotionalArtifact reference="JHN 14:27" text="Peace be with you." />)

    expect(screen.queryByText(/preparing audio/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /listen/i }))
    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument()

    resolveAudio({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
  })
})
