import { beforeEach, describe, expect, it } from 'vitest'
import { useDevotionalRotationStore } from './useDevotionalRotationStore'

describe('useDevotionalRotationStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
  })

  it('starts with no seed and a zero cursor', () => {
    expect(useDevotionalRotationStore.getState().seed).toBeNull()
    expect(useDevotionalRotationStore.getState().cursor).toBe(0)
  })

  it('ensureSeed sets a non-negative integer seed and returns it', () => {
    const seed = useDevotionalRotationStore.getState().ensureSeed()
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThan(2 ** 31)
    expect(useDevotionalRotationStore.getState().seed).toBe(seed)
  })

  it('ensureSeed is idempotent once a seed exists', () => {
    const first = useDevotionalRotationStore.getState().ensureSeed()
    const second = useDevotionalRotationStore.getState().ensureSeed()
    expect(second).toBe(first)
  })

  it('advance increments the cursor', () => {
    useDevotionalRotationStore.getState().advance()
    useDevotionalRotationStore.getState().advance()
    expect(useDevotionalRotationStore.getState().cursor).toBe(2)
  })

  it('reset clears the seed and cursor', () => {
    useDevotionalRotationStore.getState().ensureSeed()
    useDevotionalRotationStore.getState().advance()
    useDevotionalRotationStore.getState().reset()
    expect(useDevotionalRotationStore.getState()).toMatchObject({ seed: null, cursor: 0 })
  })

  it('sanitises a corrupt persisted blob to defaults', () => {
    localStorage.setItem(
      'bible-explorer-devotional-rotation',
      JSON.stringify({ state: { seed: 'nope', cursor: -4 }, version: 1 })
    )
    // Re-import via a fresh hydrate: simulate by calling the persist merge.
    const merged = useDevotionalRotationStore.persist.getOptions().merge?.(
      { seed: 'nope', cursor: -4 } as unknown,
      useDevotionalRotationStore.getState()
    )
    expect(merged).toMatchObject({ seed: null, cursor: 0 })
  })
})
