import { beforeEach, describe, expect, it } from 'vitest'
import { useVoiceSettingsStore } from './useVoiceSettingsStore'

describe('useVoiceSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useVoiceSettingsStore.setState({ openaiApiKey: null })
  })

  it('defaults to no key', () => {
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBeNull()
  })

  it('setApiKey updates state and persists to localStorage', () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBe('sk-test-123')
    const stored = JSON.parse(localStorage.getItem('bible-explorer-voice-settings') ?? '{}')
    expect(stored.state.openaiApiKey).toBe('sk-test-123')
  })

  it('clearApiKey resets state and localStorage', () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    useVoiceSettingsStore.getState().clearApiKey()
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBeNull()
    const stored = JSON.parse(localStorage.getItem('bible-explorer-voice-settings') ?? '{}')
    expect(stored.state.openaiApiKey).toBeNull()
  })
})
