import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getClientId } from './clientId'

describe('getClientId', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('returns a stable id across calls and persists it', () => {
    const first = getClientId()
    expect(first).toMatch(/[0-9a-f-]{36}/)
    expect(getClientId()).toBe(first)
    expect(localStorage.getItem('bible-explorer-client-id')).toBe(first)
  })

  it('falls back to an in-memory id when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    const a = getClientId()
    expect(a).toMatch(/[0-9a-f-]{36}/)
    expect(getClientId()).toBe(a)
  })
})
