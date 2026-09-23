import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoryReaderOverlay } from './StoryReaderOverlay'
import type { StoryArtifactParams } from '@/types/session'

const { streamStoryIllustrations } = vi.hoisted(() => ({ streamStoryIllustrations: vi.fn() }))
vi.mock('@/lib/chatApi', () => ({ streamStoryIllustrations }))

beforeEach(() => {
  vi.clearAllMocks()
})

async function* emptyStream() {}

const artifact: StoryArtifactParams = {
  title: 'The Brave Little Sparrow',
  themes: ['Trusting God'],
  age_range: '7-8',
  word_count: 40,
  characters: 'Sparrow: small and brown.',
  cover: { scene: 'The sparrow on a branch.', image_url: null },
  pages: [
    { text: 'Page one text.', scene: 'Scene one.', image_url: null },
    { text: 'Page two text.', scene: 'Scene two.', image_url: null },
  ],
}

describe('StoryReaderOverlay', () => {
  it('shows the cover page with title and badges when opened', () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    expect(screen.getAllByText('The Brave Little Sparrow').length).toBeGreaterThan(0)
    expect(screen.getByText('Ages 7-8')).toBeInTheDocument()
    expect(screen.getByText('Cover')).toBeInTheDocument()
  })

  it('navigates to the next page and shows its text and position', async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Page one text.')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('disables Previous on the cover and Next on the last page', async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('fetches illustrations on open and fills in the cover image as it arrives', async () => {
    async function* stream() {
      yield { index: -1, image_url: '/story-images/cover.png' }
      yield { index: 0, image_url: '/story-images/page0.png' }
    }
    streamStoryIllustrations.mockReturnValue(stream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    // Dialog.Portal renders into document.body, not the render() container.
    await waitFor(() => {
      expect(document.body.querySelector('img')?.getAttribute('src')).toBe('/story-images/cover.png')
    })
  })

  it('shows an "illustration unavailable" state for a page whose image failed', async () => {
    async function* stream() {
      yield { index: 0, image_url: null, error: 'rate limited' }
    }
    streamStoryIllustrations.mockReturnValue(stream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('img', { name: 'Illustration unavailable' })).toBeInTheDocument()
  })

  it('does not fetch illustrations when every image is already resolved', () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    const resolved: StoryArtifactParams = {
      ...artifact,
      cover: { ...artifact.cover, image_url: '/story-images/cover.png' },
      pages: artifact.pages.map((p) => ({ ...p, image_url: '/story-images/page.png' })),
    }
    render(<StoryReaderOverlay artifact={resolved} open onClose={() => {}} />)
    expect(streamStoryIllustrations).not.toHaveBeenCalled()
  })

  it('ignores a stale in-flight fetch after the overlay is closed and reopened', async () => {
    let resolveFirst!: (item: { index: number; image_url: string }) => void
    const firstStream = (async function* () {
      yield await new Promise<{ index: number; image_url: string }>((resolve) => {
        resolveFirst = resolve
      })
    })()
    streamStoryIllustrations.mockReturnValueOnce(firstStream)
    streamStoryIllustrations.mockReturnValueOnce(emptyStream())

    const { rerender } = render(
      <StoryReaderOverlay artifact={artifact} open onClose={() => {}} />
    )
    rerender(<StoryReaderOverlay artifact={artifact} open={false} onClose={() => {}} />)
    rerender(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)

    resolveFirst({ index: -1, image_url: '/story-images/stale.png' })
    await new Promise((r) => setTimeout(r, 0))

    // Dialog.Portal renders into document.body, not the render() container.
    expect(document.body.querySelector('img')).not.toBeInTheDocument()
  })

  it('keeps its page and does not re-fetch when re-rendered with a new but identical artifact object', async () => {
    // ArtifactPane re-spreads StoryArtifact's props on every one of its own
    // re-renders, so the reader routinely receives a fresh object for the
    // very same story.
    streamStoryIllustrations.mockReturnValue(emptyStream())
    const { rerender } = render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    const sameContent: StoryArtifactParams = {
      ...artifact,
      themes: [...artifact.themes],
      cover: { ...artifact.cover },
      pages: artifact.pages.map((p) => ({ ...p })),
    }
    rerender(<StoryReaderOverlay artifact={sameContent} open onClose={() => {}} />)
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('Page one text.')).toBeInTheDocument()
    expect(streamStoryIllustrations).toHaveBeenCalledTimes(1)
  })

  it('resets to the cover and re-fetches when shown a genuinely different story', async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    const { rerender } = render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))

    streamStoryIllustrations.mockReturnValue(emptyStream())
    const different: StoryArtifactParams = {
      ...artifact,
      pages: [{ text: 'A different story.', scene: 'A different scene.', image_url: null }],
    }
    rerender(<StoryReaderOverlay artifact={different} open onClose={() => {}} />)

    expect(screen.getByText('Cover')).toBeInTheDocument()
    expect(streamStoryIllustrations).toHaveBeenCalledTimes(2)
  })

  it('marks every undelivered illustration unavailable when the stream ends early', async () => {
    // streamStoryIllustrations yields nothing at all for a failed request
    // (non-2xx / no body) — nothing will ever arrive, so no spinner may
    // be left up.
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    expect(await screen.findByRole('img', { name: 'Illustration unavailable' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('img', { name: 'Illustration unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading illustration' })).not.toBeInTheDocument()
  })

  it('keeps delivered images and marks the rest unavailable when the stream throws mid-way', async () => {
    async function* stream() {
      yield { index: -1, image_url: '/api/bible-chat/story-images/cover.png' }
      throw new SyntaxError('Unexpected token in JSON')
    }
    streamStoryIllustrations.mockReturnValue(stream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await waitFor(() => {
      expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
        '/api/bible-chat/story-images/cover.png'
      )
    })
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('img', { name: 'Illustration unavailable' })).toBeInTheDocument()
  })

  it('marks illustrations unavailable when the request itself rejects', async () => {
    // eslint-disable-next-line require-yield
    async function* stream(): AsyncGenerator<never> {
      throw new TypeError('Failed to fetch')
    }
    streamStoryIllustrations.mockReturnValue(stream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    expect(await screen.findByRole('img', { name: 'Illustration unavailable' })).toBeInTheDocument()
  })

  it('renders a legacy (pre-illustration) story artifact text-only without fetching', async () => {
    const legacy = {
      title: 'An Old Story',
      themes: ['Trusting God'],
      age_range: '3-6',
      text: 'Once upon a time, long ago.',
      word_count: 6,
    } as unknown as StoryArtifactParams
    render(<StoryReaderOverlay artifact={legacy} open onClose={() => {}} />)
    expect(screen.getByText('Cover')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Illustration unavailable' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Once upon a time, long ago.')).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(streamStoryIllustrations).not.toHaveBeenCalled()
  })
})
