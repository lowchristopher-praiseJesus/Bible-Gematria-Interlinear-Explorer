import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApologeticsTrackArtifact } from './ApologeticsTrackArtifact'
import { onAsk, onTrackComplete } from '@/lib/apologeticsEvents'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { ApologeticsTrack, ModeParams, Session } from '@/types/session'

const player = { load: vi.fn(), play: vi.fn(), destroy: vi.fn() }
let callbacks: { watched(): void; error(): void } | null = null
let createVideoId: string | null = null
// 'now' resolves at once; 'held' waits for release(); 'fail' rejects.
let creation: 'now' | 'held' | 'fail' = 'now'
let release: (() => void) | null = null

vi.mock('@/lib/youtubePlayer', () => ({
  createPlayer: vi.fn((_el: HTMLElement, videoId: string, on: { watched(): void; error(): void }) => {
    callbacks = on
    createVideoId = videoId
    if (creation === 'fail') return Promise.reject(new Error('blocked'))
    if (creation === 'held') return new Promise((r) => { release = () => r(player) })
    return Promise.resolve(player)
  }),
}))

const TRACKS: ApologeticsTrack[] = [
  {
    id: 'jesus-rose',
    title: 'Did Jesus rise?',
    blurb: 'b',
    shorts: [
      { number: 5, title: 'Did Jesus Really Die on the Cross?', youtube_id: 'yt5', thumbnail: '/t/05.jpg',
        further_reading: [{ text: 'John 19:31–37', refs: ['JHN 19:31-37'] }, { text: 'JAMA (1986)', refs: [] }, { text: 'Strauss (1864)', refs: [] }] },
      { number: 6, title: 'Name One Witness To Jesus Resurrection', youtube_id: 'yt6', thumbnail: '/t/06.jpg', further_reading: [] },
      { number: 50, title: 'Subject 50', youtube_id: null, thumbnail: '/t/50.jpg', further_reading: [] },
    ],
  },
]

vi.mock('@/lib/modeData', () => ({
  listApologeticsTracks: vi.fn(async () => TRACKS),
}))

function showSession(modeParams: ModeParams) {
  const session: Session = {
    id: 's1', createdAt: 0, updatedAt: 0, mode: 'apologetics', title: 't', messages: [], notes: [], modeParams,
  }
  useSessionsStore.setState({ sessions: { s1: session } })
  window.history.replaceState({}, '', '/?session=s1')
}

const params = () => useSessionsStore.getState().sessions.s1.modeParams

describe('ApologeticsTrackArtifact', () => {
  beforeEach(() => {
    callbacks = null
    createVideoId = null
    creation = 'now'
    release = null
    player.load.mockClear()
    player.play.mockClear()
    player.destroy.mockClear()
    showSession({ trackId: 'jesus-rose', watchedShorts: [] })
  })
  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('lists shorts by title with progress and coming soon', async () => {
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    expect(await screen.findByText('0 / 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Name One Witness To Jesus Resurrection/ })).toBeInTheDocument()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Subject 50/ })).toBeNull()
    expect(screen.queryByText(/#5\b/)).toBeNull()
    await waitFor(() => expect(createVideoId).toBe('yt5'))
  })

  it('marks watched when the player reports it and stays on that short, ready to ask', async () => {
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    await waitFor(() => expect(callbacks).not.toBeNull())
    act(() => callbacks!.watched())
    expect(params().watchedShorts).toEqual([5])
    expect(await screen.findByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Did Jesus Really Die on the Cross?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask about this' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Mark watched' })).toBeNull()
    expect(player.load).not.toHaveBeenCalled()
  })

  it('clicking a row plays that short', async () => {
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    await waitFor(() => expect(callbacks).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Name One Witness To Jesus Resurrection/ }))
    expect(params().currentShort).toBe(6)
    await waitFor(() => expect(player.load).toHaveBeenCalledWith('yt6'))
  })

  it('clicking the selected short starts it', async () => {
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    await waitFor(() => expect(callbacks).not.toBeNull())
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Did Jesus Really Die on the Cross\?/ }))
    expect(player.play).toHaveBeenCalledTimes(1)
    expect(player.load).not.toHaveBeenCalled()
  })

  it('clicking the selected short while the player loads starts it once ready', async () => {
    creation = 'held'
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    await waitFor(() => expect(createVideoId).toBe('yt5'))
    fireEvent.click(screen.getByRole('button', { name: /Did Jesus Really Die on the Cross\?/ }))
    await act(async () => release!())
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it('mark watched button works and emits track complete once all are watched', async () => {
    const completes: string[] = []
    const off = onTrackComplete((e) => completes.push(`${e.sessionId}:${e.trackTitle}`))
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark watched' }))
    expect(params().watchedShorts).toEqual([5])
    expect(completes).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: /Name One Witness To Jesus Resurrection/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark watched' }))
    expect(params().watchedShorts).toEqual([5, 6])
    expect(completes).toEqual(['s1:Did Jesus rise?'])
    expect(screen.queryByRole('button', { name: 'Mark watched' })).toBeNull()
    off()
  })

  it('ask disabled until watched, emits ask with title', async () => {
    const asks: unknown[] = []
    const off = onAsk((e) => asks.push(e))
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    const ask = await screen.findByRole('button', { name: 'Ask about this' })
    expect(ask).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this' }))
    expect(asks).toEqual([{ sessionId: 's1', shortNumber: 5, title: 'Did Jesus Really Die on the Cross?' }])
    off()
  })

  it('ref chip opens an interlinear artifact; non-Scripture items are plain text', async () => {
    const openArtifact = vi.fn()
    useArtifactStore.setState({ openArtifact })
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    fireEvent.click(await screen.findByRole('button', { name: 'John 19:31–37' }))
    expect(openArtifact).toHaveBeenCalledWith({
      type: 'interlinear', label: 'JHN 19:31-37 ▸', params: { reference: 'JHN 19:31-37' },
    })
    expect(screen.getByText('JAMA (1986)').tagName).not.toBe('BUTTON')
  })

  it('lists plain-text reading items as separate list items', async () => {
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    expect((await screen.findByText('JAMA (1986)')).tagName).toBe('LI')
    expect(screen.getByText('Strauss (1864)').tagName).toBe('LI')
  })

  it('puts the playlist before further reading', async () => {
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    const row = await screen.findByRole('button', { name: /Name One Witness To Jesus Resurrection/ })
    const reading = screen.getByText('Further reading:')
    expect(row.compareDocumentPosition(reading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('falls back when the player errors', async () => {
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    await waitFor(() => expect(callbacks).not.toBeNull())
    act(() => callbacks!.error())
    expect(screen.getByText("This short can't play here.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/shorts/yt5')
    expect(screen.getByRole('button', { name: 'Mark watched' })).toBeEnabled()
  })

  it('restores the saved short and progress', async () => {
    showSession({ trackId: 'jesus-rose', watchedShorts: [5], currentShort: 6 })
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    expect(await screen.findByText('1 / 2')).toBeInTheDocument()
    await waitFor(() => expect(createVideoId).toBe('yt6'))
  })

  it('shows a short picked while the player was still loading', async () => {
    creation = 'held'
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    await waitFor(() => expect(createVideoId).toBe('yt5'))
    fireEvent.click(screen.getByRole('button', { name: /Name One Witness To Jesus Resurrection/ }))
    await act(async () => release!())
    expect(player.load).toHaveBeenCalledWith('yt6')
  })

  it('destroys a player that finishes loading after the panel closed', async () => {
    creation = 'held'
    const { unmount } = render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    await waitFor(() => expect(createVideoId).toBe('yt5'))
    unmount()
    await act(async () => release!())
    expect(player.destroy).toHaveBeenCalled()
  })

  it('offers YouTube for every short when the player cannot load at all', async () => {
    creation = 'fail'
    render(<ApologeticsTrackArtifact trackId="jesus-rose" />)
    expect(await screen.findByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/shorts/yt5')
    fireEvent.click(screen.getByRole('button', { name: /Name One Witness To Jesus Resurrection/ }))
    expect(screen.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/shorts/yt6')
    fireEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    expect(params().watchedShorts).toEqual([6])
  })

  it('creates one usable player under StrictMode', async () => {
    creation = 'held'
    const { createPlayer } = await import('@/lib/youtubePlayer')
    vi.mocked(createPlayer).mockClear()
    render(<StrictMode><ApologeticsTrackArtifact trackId="jesus-rose" /></StrictMode>)
    await waitFor(() => expect(createVideoId).toBe('yt5'))
    await act(async () => release!())
    expect(createPlayer).toHaveBeenCalledTimes(1)
    expect(player.destroy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Name One Witness To Jesus Resurrection/ }))
    expect(player.load).toHaveBeenCalledWith('yt6')
  })

  it('renders unavailable track', async () => {
    render(<ApologeticsTrackArtifact trackId="gone" />)
    expect(await screen.findByText('This track is no longer available.')).toBeInTheDocument()
  })
})
