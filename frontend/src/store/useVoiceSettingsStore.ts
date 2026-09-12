import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface VoiceSettingsState {
  openaiApiKey: string | null
  /** When true (and `openaiApiKey` is set), voice-mode turns generate their
   * answer via OpenAI's gpt-5.4-mini using that key instead of the site's
   * default Ollama/NVIDIA backend. Typed chat is unaffected. */
  useOpenAiForResponses: boolean
  setApiKey: (key: string) => void
  clearApiKey: () => void
  setUseOpenAiForResponses: (value: boolean) => void
}

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist(
    (set) => ({
      openaiApiKey: null,
      useOpenAiForResponses: false,
      // Emptying the key also turns the toggle off here, rather than
      // leaving every reader (Settings UI, ChatPane) to re-derive the
      // invariant "the toggle only means something when a key exists".
      setApiKey: (key) =>
        set(key.trim() ? { openaiApiKey: key } : { openaiApiKey: key, useOpenAiForResponses: false }),
      clearApiKey: () => set({ openaiApiKey: null, useOpenAiForResponses: false }),
      setUseOpenAiForResponses: (value) => set({ useOpenAiForResponses: value }),
    }),
    { name: 'bible-explorer-voice-settings', version: 1 }
  )
)
