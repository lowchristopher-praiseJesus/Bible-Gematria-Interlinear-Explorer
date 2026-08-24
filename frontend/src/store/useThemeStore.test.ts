import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from './useThemeStore'

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: 'scholarly' })
  })

  it('defaults to scholarly', () => {
    expect(useThemeStore.getState().theme).toBe('scholarly')
  })

  it('setTheme updates state and persists to localStorage', () => {
    useThemeStore.getState().setTheme('midnight')
    expect(useThemeStore.getState().theme).toBe('midnight')
    const stored = JSON.parse(localStorage.getItem('bible-explorer-theme') ?? '{}')
    expect(stored.state.theme).toBe('midnight')
  })
})
