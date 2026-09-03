import { describe, expect, it } from 'vitest'
import { filterSessions, sessionHaystack, splitHighlight } from './sessionSearch'
import type { Session } from '@/types/session'

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: 's1',
    createdAt: 0,
    updatedAt: 0,
    mode: 'freeform',
    modeParams: {},
    title: 'Ask Anything',
    messages: [],
    notes: [],
    ...overrides,
  }
}

describe('sessionHaystack', () => {
  it('includes the title, the derived description, and every message text, lowercased', () => {
    const session = makeSession({
      mode: 'parable',
      modeParams: { parableId: 'prodigal_son' },
      title: 'Parable Study — prodigal son',
      messages: [
        { id: 'u1', role: 'user', text: 'Why did the FATHER run?' },
        { id: 'a1', role: 'assistant', text: 'Because of his compassion.' },
      ],
    })
    const hay = sessionHaystack(session)
    expect(hay).toContain('parable study — prodigal son')
    expect(hay).toContain('prodigal son') // from describeSession
    expect(hay).toContain('why did the father run?')
    expect(hay).toContain('because of his compassion.')
  })

  it('does not throw on a session whose messages have empty or missing text', () => {
    const session = makeSession({
      messages: [
        { id: 'u1', role: 'user', text: '' },
        { id: 'a1', role: 'assistant', text: undefined as unknown as string },
      ],
    })
    expect(() => sessionHaystack(session)).not.toThrow()
  })
})

describe('filterSessions', () => {
  const love = makeSession({
    id: 'love',
    mode: 'topic',
    modeParams: { seriesId: 's', conceptSlug: 'love-your-neighbour' },
    title: 'Topical Study — love your neighbour',
    messages: [{ id: 'u1', role: 'user', text: 'What does it mean to love my neighbour?' }],
  })
  const john316 = makeSession({
    id: 'john316',
    mode: 'verse',
    modeParams: { reference: 'John 3:16' },
    title: 'Verse of the Day',
    messages: [{ id: 'a1', role: 'assistant', text: 'For God so loved the world.' }],
  })
  const all = [love, john316]

  it('returns every session unchanged for an empty or whitespace-only query', () => {
    expect(filterSessions(all, '')).toEqual(all)
    expect(filterSessions(all, '   ')).toEqual(all)
  })

  it('matches on message text, case-insensitively', () => {
    expect(filterSessions(all, 'LOVED THE WORLD')).toEqual([john316])
  })

  it('matches on the session title / derived description', () => {
    expect(filterSessions(all, 'john 3:16')).toEqual([john316])
  })

  it('requires every whitespace-separated term to appear somewhere in the session', () => {
    expect(filterSessions(all, 'love neighbour')).toEqual([love])
    expect(filterSessions(all, 'neighbour world')).toEqual([])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterSessions(all, 'zebra')).toEqual([])
  })
})

describe('splitHighlight', () => {
  it('returns the text as a single non-hit segment when the query is empty', () => {
    expect(splitHighlight('Prodigal son', '  ')).toEqual([{ text: 'Prodigal son', hit: false }])
  })

  it('flags the matched run, case-insensitively, and keeps the surrounding text', () => {
    expect(splitHighlight('The Prodigal Son', 'prodigal')).toEqual([
      { text: 'The ', hit: false },
      { text: 'Prodigal', hit: true },
      { text: ' Son', hit: false },
    ])
  })

  it('does not throw when a term contains regex-special characters', () => {
    expect(() => splitHighlight('John 3:16 explained', 'john 3:16 (')).not.toThrow()
    expect(splitHighlight('John 3:16 explained', '3:16')).toEqual([
      { text: 'John ', hit: false },
      { text: '3:16', hit: true },
      { text: ' explained', hit: false },
    ])
  })
})
