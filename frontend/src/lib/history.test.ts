import { describe, expect, it } from 'vitest'
import { toHistory } from './history'
import type { SessionMessage } from '@/types/session'

describe('toHistory', () => {
  it('maps role/text through unchanged for a plain message', () => {
    const messages: SessionMessage[] = [{ id: 'm1', role: 'user', text: 'Hello' }]
    expect(toHistory(messages)).toEqual([{ role: 'user', text: 'Hello' }])
  })

  it('swaps a delivered devotional bubble text for its full artifact body', () => {
    const messages: SessionMessage[] = [{
      id: 'm1',
      role: 'assistant',
      text: "Here's a devotional on John 3:16.",
      artifacts: [{ type: 'devotional', label: 'Read the devotional ▸', params: { reference: 'John 3:16', text: 'The full devotional text goes here.' } }],
    }]
    expect(toHistory(messages)).toEqual([{ role: 'assistant', text: 'The full devotional text goes here.' }])
  })
})
