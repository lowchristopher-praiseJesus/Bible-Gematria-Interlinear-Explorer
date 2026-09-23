import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoryArtifact } from './StoryArtifact'
import type { StoryArtifactParams } from '@/types/session'

const { streamStoryIllustrations } = vi.hoisted(() => ({ streamStoryIllustrations: vi.fn() }))
vi.mock('@/lib/chatApi', () => ({ streamStoryIllustrations }))

async function* emptyStream() {}

const props: StoryArtifactParams = {
  title: 'The Brave Little Sparrow',
  themes: ['Trusting God', 'Coming home'],
  age_range: '7-8',
  word_count: 850,
  characters: 'Sparrow: small and brown.',
  cover: { scene: 'The sparrow on a branch.', image_url: null },
  pages: [
    { text: 'Once upon a time, a small sparrow learned to trust the wind.', scene: 'A scene.', image_url: null },
    { text: 'It flew home at last.', scene: 'Another scene.', image_url: null },
  ],
}

describe('StoryArtifact', () => {
  it('renders the title, age badge, theme chips, first page and word count', () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryArtifact {...props} />)
    expect(screen.getByText('The Brave Little Sparrow')).toBeInTheDocument()
    expect(screen.getByText('Ages 7-8')).toBeInTheDocument()
    expect(screen.getByText('Trusting God')).toBeInTheDocument()
    expect(screen.getByText('Coming home')).toBeInTheDocument()
    expect(screen.getByText(/small sparrow learned to trust/)).toBeInTheDocument()
    expect(screen.getByText('850 words')).toBeInTheDocument()
  })

  it("copies every page's text, joined, to the clipboard", async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<StoryArtifact {...props} />)
    await userEvent.click(screen.getByRole('button', { name: /copy story/i }))
    expect(writeText).toHaveBeenCalledWith(
      'Once upon a time, a small sparrow learned to trust the wind.\n\nIt flew home at last.'
    )
  })

  it('opens the full-screen reader when "Read full screen" is clicked', async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryArtifact {...props} />)
    expect(screen.queryByText('Cover')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /read full screen/i }))
    expect(screen.getByText('Cover')).toBeInTheDocument()
  })
})
