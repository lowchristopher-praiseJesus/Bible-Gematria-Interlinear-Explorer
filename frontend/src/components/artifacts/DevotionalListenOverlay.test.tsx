import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DevotionalListenOverlay } from './DevotionalListenOverlay'
import * as chatApi from '@/lib/chatApi'

describe('DevotionalListenOverlay', () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('shows a loading state, then the play control once audio is ready', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockResolvedValue({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={() => {}} />)

    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /play/i })).toBeInTheDocument()
    expect(chatApi.postDevotionalAudio).toHaveBeenCalledWith('JHN 14:27', 'Peace be with you.')
  })

  it('shows an error state when audio generation fails', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockRejectedValue(new Error('boom'))
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={() => {}} />)
    expect(await screen.findByText(/audio unavailable/i)).toBeInTheDocument()
  })

  it('toggles play/pause on the audio element', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockResolvedValue({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={() => {}} />)

    const playButton = await screen.findByRole('button', { name: /play/i })
    await userEvent.click(playButton)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /play/i })).toBeInTheDocument()
  })

  it('playback ending naturally resets to the Play button', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockResolvedValue({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={() => {}} />)

    const playButton = await screen.findByRole('button', { name: /play/i })
    await userEvent.click(playButton)
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument()

    // Dialog.Portal renders into document.body, not the render() container.
    const audioElement = document.body.querySelector('audio')
    expect(audioElement).not.toBeNull()
    fireEvent(audioElement as HTMLAudioElement, new Event('ended'))

    expect(await screen.findByRole('button', { name: /play/i })).toBeInTheDocument()
  })

  it('Done pauses the audio and calls onClose', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockResolvedValue({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
    const onClose = vi.fn()
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={onClose} />)
    await screen.findByRole('button', { name: /play/i })

    await userEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
