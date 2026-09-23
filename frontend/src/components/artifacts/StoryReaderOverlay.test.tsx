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
    const { container } = render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe('/story-images/cover.png')
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

    const { rerender, container } = render(
      <StoryReaderOverlay artifact={artifact} open onClose={() => {}} />
    )
    rerender(<StoryReaderOverlay artifact={artifact} open={false} onClose={() => {}} />)
    rerender(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)

    resolveFirst({ index: -1, image_url: '/story-images/stale.png' })
    await new Promise((r) => setTimeout(r, 0))

    expect(container.querySelector('img')).not.toBeInTheDocument()
  })
})
