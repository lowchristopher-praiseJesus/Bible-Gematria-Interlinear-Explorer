import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const MIN_VERSE_FONT_SCALE = 0.85
export const MAX_VERSE_FONT_SCALE = 1.6
export const VERSE_FONT_SCALE_STEP = 0.15

function clampToStep(value: number): number {
  const clamped = Math.min(MAX_VERSE_FONT_SCALE, Math.max(MIN_VERSE_FONT_SCALE, value))
  return Math.round(clamped * 100) / 100
}

interface VerseFontScaleState {
  scale: number
  increase: () => void
  decrease: () => void
}

export const useVerseFontScaleStore = create<VerseFontScaleState>()(
  persist(
    (set) => ({
      scale: 1,
      increase: () => set((s) => ({ scale: clampToStep(s.scale + VERSE_FONT_SCALE_STEP) })),
      decrease: () => set((s) => ({ scale: clampToStep(s.scale - VERSE_FONT_SCALE_STEP) })),
    }),
    { name: 'bible-explorer-verse-font-scale', version: 1 }
  )
)
