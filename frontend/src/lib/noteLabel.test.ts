import { describe, expect, it } from 'vitest'
import { noteLabel } from './noteLabel'

describe('noteLabel', () => {
  it('returns the first line of a single-line body, trimmed', () => {
    expect(noteLabel({ body: '  Thoughts on grace  ' })).toBe('Thoughts on grace')
  })

  it('skips leading blank lines and returns the first line with content', () => {
    expect(noteLabel({ body: '\n\n   \nReal content\nmore' })).toBe('Real content')
  })

  it('falls back to "Untitled note" for an empty body', () => {
    expect(noteLabel({ body: '' })).toBe('Untitled note')
  })

  it('falls back to "Untitled note" for a whitespace-only body', () => {
    expect(noteLabel({ body: '   \n\t\n  ' })).toBe('Untitled note')
  })
})
