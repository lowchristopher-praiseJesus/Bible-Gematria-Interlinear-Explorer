import { describe, expect, it } from 'vitest'
import { formatSessionTimestamp } from './formatTimestamp'

describe('formatSessionTimestamp', () => {
  it('shows "Today, <time>" for a timestamp on the same calendar day as now', () => {
    const now = new Date(2026, 7, 31, 16, 0) // Aug 31, 2026, 4:00 PM
    const startedAt = new Date(2026, 7, 31, 9, 5).getTime() // 9:05 AM same day
    expect(formatSessionTimestamp(startedAt, now)).toBe('Today, 9:05 AM')
  })

  it('shows month/day and time for a past date in the current year', () => {
    const now = new Date(2026, 7, 31, 16, 0)
    const startedAt = new Date(2026, 7, 28, 14, 30).getTime()
    expect(formatSessionTimestamp(startedAt, now)).toBe('Aug 28, 2:30 PM')
  })

  it('includes the year when the timestamp is from a previous year', () => {
    const now = new Date(2026, 7, 31, 16, 0)
    const startedAt = new Date(2025, 11, 3, 18, 40).getTime()
    expect(formatSessionTimestamp(startedAt, now)).toBe('Dec 3, 2025, 6:40 PM')
  })

  it('pads single-digit minutes and handles midnight/noon correctly', () => {
    const now = new Date(2026, 7, 31, 16, 0)
    expect(formatSessionTimestamp(new Date(2026, 7, 31, 0, 5).getTime(), now)).toBe('Today, 12:05 AM')
    expect(formatSessionTimestamp(new Date(2026, 7, 31, 12, 0).getTime(), now)).toBe('Today, 12:00 PM')
  })
})
