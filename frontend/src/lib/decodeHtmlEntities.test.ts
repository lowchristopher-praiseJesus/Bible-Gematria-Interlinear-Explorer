import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities } from './decodeHtmlEntities'

describe('decodeHtmlEntities', () => {
  it('decodes numeric character references', () => {
    expect(decodeHtmlEntities('Job said, &#8220;It may be&#8221;.')).toBe('Job said, “It may be”.')
  })

  it('decodes named entities', () => {
    expect(decodeHtmlEntities('Jack &amp; Jill')).toBe('Jack & Jill')
  })

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('There was a man in the land of Uz.')).toBe('There was a man in the land of Uz.')
  })

  it('does not execute embedded tags', () => {
    expect(decodeHtmlEntities('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })

  it('handles empty input', () => {
    expect(decodeHtmlEntities('')).toBe('')
  })
})
