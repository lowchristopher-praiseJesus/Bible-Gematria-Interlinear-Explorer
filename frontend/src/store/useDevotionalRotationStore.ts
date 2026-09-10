import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Per-browser state for Devotional mode's "Pick one for me" rotation.
 *
 * The backend picker (chatbot/devotional_rotation.py) is a pure function of
 * (seed, cursor): it deals a curated verse pool as a seeded shuffled deck.
 * We keep one random `seed` per browser (so two browsers get independent
 * orders) and a monotonic `cursor` incremented once per delivered rotation
 * devotional. No accounts, no server state — this and the seed are all the
 * "which verses have I seen" memory the feature needs.
 */
interface DevotionalRotationState {
  seed: number | null
  cursor: number
  /** Lazily assign a random seed on first use; return the current seed. */
  ensureSeed: () => number
  /** Advance one step after a rotation devotional is delivered. */
  advance: () => void
  reset: () => void
}

function sanitize(persistedState: unknown): { seed: number | null; cursor: number } {
  const s = (persistedState ?? {}) as Record<string, unknown>
  const seed =
    typeof s.seed === 'number' && Number.isFinite(s.seed) && s.seed >= 0 ? Math.floor(s.seed) : null
  const cursor =
    typeof s.cursor === 'number' && Number.isFinite(s.cursor) && s.cursor >= 0 ? Math.floor(s.cursor) : 0
  return { seed, cursor }
}

export const useDevotionalRotationStore = create<DevotionalRotationState>()(
  persist(
    (set, get) => ({
      seed: null,
      cursor: 0,
      ensureSeed: () => {
        const existing = get().seed
        if (existing != null) return existing
        const seed = Math.floor(Math.random() * 2 ** 31)
        set({ seed })
        return seed
      },
      advance: () => set((state) => ({ cursor: state.cursor + 1 })),
      reset: () => set({ seed: null, cursor: 0 }),
    }),
    {
      name: 'bible-explorer-devotional-rotation',
      version: 1,
      migrate: (persistedState) => sanitize(persistedState) as DevotionalRotationState,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitize(persistedState),
      }),
    }
  )
)
