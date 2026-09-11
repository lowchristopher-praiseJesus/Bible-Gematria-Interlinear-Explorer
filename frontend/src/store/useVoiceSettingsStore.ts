import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface VoiceSettingsState {
  openaiApiKey: string | null
  setApiKey: (key: string) => void
  clearApiKey: () => void
}

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist(
    (set) => ({
      openaiApiKey: null,
      setApiKey: (key) => set({ openaiApiKey: key }),
      clearApiKey: () => set({ openaiApiKey: null }),
    }),
    { name: 'bible-explorer-voice-settings', version: 1 }
  )
)
