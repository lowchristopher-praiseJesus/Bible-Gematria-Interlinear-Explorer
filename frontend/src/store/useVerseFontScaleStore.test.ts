import { beforeEach, describe, expect, it } from 'vitest'
import { useVerseFontScaleStore, MIN_VERSE_FONT_SCALE, MAX_VERSE_FONT_SCALE } from './useVerseFontScaleStore'

describe('useVerseFontScaleStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useVerseFontScaleStore.setState({ scale: 1 })
  })

  it('defaults to a scale of 1', () => {
    expect(useVerseFontScaleStore.getState().scale).toBe(1)
  })

  it('increase() raises the scale and persists it', () => {
    useVerseFontScaleStore.getState().increase()
    expect(useVerseFontScaleStore.getState().scale).toBeGreaterThan(1)
    const stored = JSON.parse(localStorage.getItem('bible-explorer-verse-font-scale') ?? '{}')
    expect(stored.state.scale).toBe(useVerseFontScaleStore.getState().scale)
  })

  it('decrease() lowers the scale below 1', () => {
    useVerseFontScaleStore.getState().decrease()
    expect(useVerseFontScaleStore.getState().scale).toBeLessThan(1)
  })

  it('increase() never goes past the maximum', () => {
    for (let i = 0; i < 20; i++) useVerseFontScaleStore.getState().increase()
    expect(useVerseFontScaleStore.getState().scale).toBe(MAX_VERSE_FONT_SCALE)
  })

  it('decrease() never goes below the minimum', () => {
    for (let i = 0; i < 20; i++) useVerseFontScaleStore.getState().decrease()
    expect(useVerseFontScaleStore.getState().scale).toBe(MIN_VERSE_FONT_SCALE)
  })
})
