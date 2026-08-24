import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from './SettingsPanel'
import { useThemeStore } from '@/store/useThemeStore'

describe('SettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: 'scholarly' })
    document.documentElement.removeAttribute('data-theme')
  })

  it('opens and lists all four themes', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('button', { name: /illuminated manuscript/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modern scholarly/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /midnight study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /papyrus editorial/i })).toBeInTheDocument()
  })

  it('selecting a theme updates the store and the document attribute', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    await userEvent.click(screen.getByRole('button', { name: /midnight study/i }))
    expect(useThemeStore.getState().theme).toBe('midnight')
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight')
  })
})
