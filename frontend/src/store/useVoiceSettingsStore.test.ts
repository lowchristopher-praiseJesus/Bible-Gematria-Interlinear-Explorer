import { beforeEach, describe, expect, it } from 'vitest'
import { useVoiceSettingsStore } from './useVoiceSettingsStore'

describe('useVoiceSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useVoiceSettingsStore.setState({ openaiApiKey: null, useOpenAiForResponses: false })
  })

  it('defaults to no key', () => {
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBeNull()
  })

  it('defaults to not using OpenAI for responses', () => {
    expect(useVoiceSettingsStore.getState().useOpenAiForResponses).toBe(false)
  })

  it('setUseOpenAiForResponses updates state and persists to localStorage', () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    useVoiceSettingsStore.getState().setUseOpenAiForResponses(true)
    expect(useVoiceSettingsStore.getState().useOpenAiForResponses).toBe(true)
    const stored = JSON.parse(localStorage.getItem('bible-explorer-voice-settings') ?? '{}')
    expect(stored.state.useOpenAiForResponses).toBe(true)
  })

  it('clearApiKey also turns off useOpenAiForResponses', () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    useVoiceSettingsStore.getState().setUseOpenAiForResponses(true)
    useVoiceSettingsStore.getState().clearApiKey()
    expect(useVoiceSettingsStore.getState().useOpenAiForResponses).toBe(false)
  })

  it('emptying the key via setApiKey also turns off useOpenAiForResponses', () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    useVoiceSettingsStore.getState().setUseOpenAiForResponses(true)
    useVoiceSettingsStore.getState().setApiKey('')
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBe('')
    expect(useVoiceSettingsStore.getState().useOpenAiForResponses).toBe(false)
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
