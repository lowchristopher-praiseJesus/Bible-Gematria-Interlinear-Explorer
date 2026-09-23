import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemePicker } from './ThemePicker'

const themes = [
  { id: 't1', label: 'Trusting God', description: 'God provides even when we cannot see how.' },
  { id: 't2', label: 'Coming home', description: 'It is never too late to return.' },
]

describe('ThemePicker', () => {
  it('renders every theme as a checkbox and every age range as a button', () => {
    render(
      <ThemePicker
        themes={themes} selectedIds={[]} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={() => {}} onSubmit={() => {}}
        submitting={false} hasStory={false}
      />
    )
    expect(screen.getByText('Trusting God')).toBeInTheDocument()
    expect(screen.getByText('Coming home')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ages 3-6' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ages 7-8' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ages 9-10' })).toBeInTheDocument()
  })

  it('calls onToggleTheme with the theme id when its checkbox is clicked', async () => {
    const onToggleTheme = vi.fn()
    render(
      <ThemePicker
        themes={themes} selectedIds={[]} ageRange="3-6"
        onToggleTheme={onToggleTheme} onChangeAgeRange={() => {}} onSubmit={() => {}}
        submitting={false} hasStory={false}
      />
    )
    await userEvent.click(screen.getByText('Trusting God'))
    expect(onToggleTheme).toHaveBeenCalledWith('t1')
  })

  it('disables the submit button until at least one theme is selected', () => {
    render(
      <ThemePicker
        themes={themes} selectedIds={[]} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={() => {}} onSubmit={() => {}}
        submitting={false} hasStory={false}
      />
    )
    expect(screen.getByRole('button', { name: 'Make my story' })).toBeDisabled()
  })

  it('labels the submit button "Try again" once a story already exists', () => {
    render(
      <ThemePicker
        themes={themes} selectedIds={['t1']} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={() => {}} onSubmit={() => {}}
        submitting={false} hasStory
      />
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('calls onChangeAgeRange when a different age button is clicked', async () => {
    const onChangeAgeRange = vi.fn()
    render(
      <ThemePicker
        themes={themes} selectedIds={['t1']} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={onChangeAgeRange} onSubmit={() => {}}
        submitting={false} hasStory={false}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ages 7-8' }))
    expect(onChangeAgeRange).toHaveBeenCalledWith('7-8')
  })

  it('calls onSubmit when the submit button is clicked with a selection', async () => {
    const onSubmit = vi.fn()
    render(
      <ThemePicker
        themes={themes} selectedIds={['t1']} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={() => {}} onSubmit={onSubmit}
        submitting={false} hasStory={false}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Make my story' }))
    expect(onSubmit).toHaveBeenCalled()
  })
})
