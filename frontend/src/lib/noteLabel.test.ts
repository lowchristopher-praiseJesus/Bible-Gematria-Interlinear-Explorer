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

  it('prefers a non-empty title over the body', () => {
    expect(noteLabel({ title: 'Grace', body: '<p>ignored</p>' })).toBe('Grace')
  })

  it('falls back to the body when title is empty or whitespace', () => {
    expect(noteLabel({ title: '   ', body: '<p>Real content</p>' })).toBe('Real content')
  })

  it('strips HTML tags from a rich-text body before deriving the label', () => {
    expect(noteLabel({ body: '<p><strong>Bold</strong> start</p>' })).toBe('Bold start')
  })
})
