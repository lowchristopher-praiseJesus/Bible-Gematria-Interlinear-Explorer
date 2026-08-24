import { describe, expect, it } from 'vitest'
import { usfmToFullRef } from './usfm'

describe('usfmToFullRef', () => {
  it('converts a USFM book code + chapter:verse to full name', () => {
    expect(usfmToFullRef('MAT 20:1')).toBe('Matthew 20:1')
    expect(usfmToFullRef('1CO 13:4')).toBe('1 Corinthians 13:4')
  })

  it('passes through references it does not recognize', () => {
    expect(usfmToFullRef('XYZ 1:1')).toBe('XYZ 1:1')
  })

  it('passes through a reference with no chapter:verse', () => {
    expect(usfmToFullRef('MAT')).toBe('MAT')
  })
})
