import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptChips } from './PromptChips'

describe('PromptChips', () => {
  it('renders one button per prompt', () => {
    render(<PromptChips prompts={['First prompt', 'Second prompt']} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: 'First prompt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Second prompt' })).toBeInTheDocument()
  })

  it('renders nothing when given no prompts', () => {
    const { container } = render(<PromptChips prompts={[]} onPick={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('calls onPick with the prompt text when a chip is clicked', async () => {
    const onPick = vi.fn()
    render(<PromptChips prompts={['What does “selah” mean?']} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: 'What does “selah” mean?' }))
    expect(onPick).toHaveBeenCalledWith('What does “selah” mean?')
  })

  it('disables every chip when disabled', () => {
    render(<PromptChips prompts={['A', 'B']} onPick={() => {}} disabled />)
    expect(screen.getByRole('button', { name: 'A' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'B' })).toBeDisabled()
  })

  it('shows an optional label above the chips', () => {
    render(<PromptChips prompts={['A']} onPick={() => {}} label="Try asking…" />)
    expect(screen.getByText('Try asking…')).toBeInTheDocument()
  })
})
