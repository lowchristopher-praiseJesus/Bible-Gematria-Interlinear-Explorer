import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Cross-session memory for "Bible in a Year": once the user has picked
 * Chronological vs Canonical, and once they've marked a day complete, that
 * choice/progress should stick — reopening the mode later shouldn't re-ask
 * the plan question or restart at day 1. This lives outside any one
 * `Session` (which is per-conversation and gets recreated every time the
 * mode picker is used) so it survives across sessions.
 */
export interface ReadingPlanProgress {
  plan: 'chronological' | 'canonical'
  dayIndex: number
  completedDays: number[]
}

interface ReadingPlanState {
  progress: ReadingPlanProgress | null
  /** Called once the user answers the Chronological/Canonical prompt, or
   * whenever a session's reading-plan progress needs to be mirrored here
   * (e.g. after marking a day complete). */
  setProgress: (progress: ReadingPlanProgress) => void
  reset: () => void
}

function isValidProgress(value: unknown): value is ReadingPlanProgress {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.plan === 'chronological' || candidate.plan === 'canonical') &&
    typeof candidate.dayIndex === 'number' &&
    Array.isArray(candidate.completedDays)
  )
}

interface PersistedReadingPlanShape {
  progress?: unknown
}

function sanitizePersistedState(persistedState: unknown): Pick<ReadingPlanState, 'progress'> {
  const state = (persistedState ?? {}) as PersistedReadingPlanShape
  return { progress: isValidProgress(state.progress) ? state.progress : null }
}

export const useReadingPlanStore = create<ReadingPlanState>()(
  persist(
    (set) => ({
      progress: null,
      setProgress: (progress) => set({ progress }),
      reset: () => set({ progress: null }),
    }),
    {
      name: 'bible-explorer-reading-plan',
      version: 1,
      migrate: (persistedState) => sanitizePersistedState(persistedState) as ReadingPlanState,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedState(persistedState),
      }),
    }
  )
)
