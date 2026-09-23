import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoryArtifact } from './StoryArtifact'

const props = {
  title: 'The Brave Little Sparrow',
  themes: ['Trusting God', 'Coming home'],
  age_range: '7-8',
  text: 'Once upon a time, a small sparrow learned to trust the wind.',
  word_count: 850,
}

describe('StoryArtifact', () => {
  it('renders the title, age badge, theme chips, body and word count', () => {
    render(<StoryArtifact {...props} />)
    expect(screen.getByText('The Brave Little Sparrow')).toBeInTheDocument()
    expect(screen.getByText('Ages 7-8')).toBeInTheDocument()
    expect(screen.getByText('Trusting God')).toBeInTheDocument()
    expect(screen.getByText('Coming home')).toBeInTheDocument()
    expect(screen.getByText(/small sparrow learned to trust/)).toBeInTheDocument()
    expect(screen.getByText('850 words')).toBeInTheDocument()
  })

  it('copies the story text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<StoryArtifact {...props} />)
    await userEvent.click(screen.getByRole('button', { name: /copy story/i }))
    expect(writeText).toHaveBeenCalledWith(props.text)
  })
})
