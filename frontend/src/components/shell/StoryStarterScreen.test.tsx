import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoryStarterScreen } from './StoryStarterScreen'
import { STORY_STARTER_IDEAS } from '@/lib/storyStarterIdeas'

describe('StoryStarterScreen', () => {
  it('shows the starter idea chips', () => {
    render(<StoryStarterScreen onBack={() => {}} onSubmit={() => {}} />)
    for (const idea of STORY_STARTER_IDEAS) {
      expect(screen.getByRole('button', { name: idea })).toBeInTheDocument()
    }
  })

  it('clicking a chip fills the input with that idea, editable before submitting', async () => {
    render(<StoryStarterScreen onBack={() => {}} onSubmit={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: STORY_STARTER_IDEAS[0] }))

    const input = screen.getByPlaceholderText(/what should the story be about/i)
    expect(input).toHaveValue(STORY_STARTER_IDEAS[0])
  })

  it('disables submit until there is text, whether typed or chip-filled', async () => {
    render(<StoryStarterScreen onBack={() => {}} onSubmit={() => {}} />)
    const submit = screen.getByRole('button', { name: /^go$/i })
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByPlaceholderText(/what should the story be about/i), 'A brave little mouse')
    expect(submit).toBeEnabled()
  })

  it('submits the trimmed typed text', async () => {
    const onSubmit = vi.fn()
    render(<StoryStarterScreen onBack={() => {}} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByPlaceholderText(/what should the story be about/i), '  A brave little mouse  ')
    await userEvent.click(screen.getByRole('button', { name: /^go$/i }))
    expect(onSubmit).toHaveBeenCalledWith('A brave little mouse')
  })

  it('submits a chosen chip idea after clicking it then Go', async () => {
    const onSubmit = vi.fn()
    render(<StoryStarterScreen onBack={() => {}} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: STORY_STARTER_IDEAS[1] }))
    await userEvent.click(screen.getByRole('button', { name: /^go$/i }))
    expect(onSubmit).toHaveBeenCalledWith(STORY_STARTER_IDEAS[1])
  })

  it('calls onBack when Back is clicked', async () => {
    const onBack = vi.fn()
    render(<StoryStarterScreen onBack={onBack} onSubmit={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
