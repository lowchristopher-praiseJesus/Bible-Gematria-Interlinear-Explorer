import { beforeEach, describe, expect, it } from 'vitest'
import { useReadingPlanStore } from './useReadingPlanStore'

describe('useReadingPlanStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useReadingPlanStore.setState({ progress: null })
  })

  it('starts with no saved progress', () => {
    expect(useReadingPlanStore.getState().progress).toBeNull()
  })

  it('setProgress records the plan and day', () => {
    useReadingPlanStore.getState().setProgress({ plan: 'chronological', dayIndex: 0, completedDays: [] })
    expect(useReadingPlanStore.getState().progress).toEqual({
      plan: 'chronological',
      dayIndex: 0,
      completedDays: [],
    })
  })

  it('setProgress overwrites the previous progress (e.g. advancing a day)', () => {
    useReadingPlanStore.getState().setProgress({ plan: 'canonical', dayIndex: 0, completedDays: [] })
    useReadingPlanStore.getState().setProgress({ plan: 'canonical', dayIndex: 1, completedDays: [0] })
    expect(useReadingPlanStore.getState().progress).toEqual({
      plan: 'canonical',
      dayIndex: 1,
      completedDays: [0],
    })
  })

  it('reset clears saved progress', () => {
    useReadingPlanStore.getState().setProgress({ plan: 'chronological', dayIndex: 3, completedDays: [0, 1, 2] })
    useReadingPlanStore.getState().reset()
    expect(useReadingPlanStore.getState().progress).toBeNull()
  })

  it('ignores a malformed persisted blob instead of crashing', async () => {
    localStorage.setItem(
      'bible-explorer-reading-plan',
      JSON.stringify({ state: { progress: { plan: 'sideways', dayIndex: 'nope' } }, version: 1 })
    )
    await useReadingPlanStore.persist.rehydrate()
    expect(useReadingPlanStore.getState().progress).toBeNull()
  })
})
