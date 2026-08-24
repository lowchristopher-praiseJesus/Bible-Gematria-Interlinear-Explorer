import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeId = 'illuminated' | 'scholarly' | 'midnight' | 'papyrus'

interface ThemeState {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'scholarly',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'bible-explorer-theme', version: 1 }
  )
)
