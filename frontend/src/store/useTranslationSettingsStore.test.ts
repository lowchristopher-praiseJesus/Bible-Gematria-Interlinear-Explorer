import { beforeEach, describe, expect, it } from 'vitest'
import { useTranslationSettingsStore } from './useTranslationSettingsStore'

describe('useTranslationSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useTranslationSettingsStore.setState({ defaultTranslationAbbr: 'KJV' })
  })

  it('defaults to KJV', () => {
    expect(useTranslationSettingsStore.getState().defaultTranslationAbbr).toBe('KJV')
  })

  it('setDefaultTranslationAbbr updates state and persists to localStorage', () => {
    useTranslationSettingsStore.getState().setDefaultTranslationAbbr('CUV')
    expect(useTranslationSettingsStore.getState().defaultTranslationAbbr).toBe('CUV')
    const stored = JSON.parse(localStorage.getItem('bible-explorer-translation-settings') ?? '{}')
    expect(stored.state.defaultTranslationAbbr).toBe('CUV')
  })
})
