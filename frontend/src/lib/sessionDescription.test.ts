import { describe, expect, it } from 'vitest'
import { describeSession } from './sessionDescription'
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

describe('describeSession', () => {
  it('describes an unanswered reading-plan prompt as choosing a plan', () => {
    const session = makeSession({ mode: 'reading_plan', modeParams: {} })
    expect(describeSession(session)).toBe('Choosing a reading plan')
  })

  it('describes an in-progress reading plan by day and plan name', () => {
    const session = makeSession({
      mode: 'reading_plan',
      modeParams: { plan: 'canonical', dayIndex: 4, completedDays: [0, 1, 2, 3] },
    })
    expect(describeSession(session)).toBe('Day 5 — Canonical')
  })

  it('describes a chronological reading plan on day 1', () => {
    const session = makeSession({ mode: 'reading_plan', modeParams: { plan: 'chronological', dayIndex: 0 } })
    expect(describeSession(session)).toBe('Day 1 — Chronological')
  })

  it('describes an unanswered parable prompt as choosing a parable', () => {
    const session = makeSession({ mode: 'parable', modeParams: {} })
    expect(describeSession(session)).toBe('Choosing a parable')
  })

  it('describes a chosen parable by its formatted name', () => {
    const session = makeSession({ mode: 'parable', modeParams: { parableId: 'prodigal_son' } })
    expect(describeSession(session)).toBe('Prodigal son')
  })

  it('describes a chosen topic by its formatted name', () => {
    const session = makeSession({ mode: 'topic', modeParams: { seriesId: 'some-series', conceptSlug: 'faith_and_doubt' } })
    expect(describeSession(session)).toBe('Faith and doubt')
  })

  it('describes a topic session with a resolved concept by its slug', () => {
    const session = makeSession({ mode: 'topic', modeParams: { seriesId: 'present-day-ministry-of-jesus', conceptSlug: 'grace' } })
    expect(describeSession(session)).toBe('Grace')
  })

  it('describes a topic session with only a series chosen as "Choosing a topic"', () => {
    const session = makeSession({ mode: 'topic', modeParams: { seriesId: 'present-day-ministry-of-jesus' } })
    expect(describeSession(session)).toBe('Choosing a topic')
  })

  it('describes a verse session by its explicit reference param', () => {
    const session = makeSession({ mode: 'verse', modeParams: { reference: 'John 3:16' } })
    expect(describeSession(session)).toBe('John 3:16')
  })

  it('falls back to the primer response\'s reference when no explicit reference param was set', () => {
    const session = makeSession({
      mode: 'verse',
      modeParams: {},
      messages: [
        { id: 'u1', role: 'user', text: '✨ Verse of the Day' },
        { id: 'a1', role: 'assistant', text: 'Here is JHN 3:16.', data: { reference: 'JHN 3:16' } },
      ],
    })
    expect(describeSession(session)).toBe('JHN 3:16')
  })

  it('falls back to "Random verse" when no reference is known yet', () => {
    const session = makeSession({ mode: 'verse', modeParams: {} })
    expect(describeSession(session)).toBe('Random verse')
  })

  it('skips past a choice-prompt assistant message with no data yet to find the resolved reference', () => {
    // "Surprise me" flow: the first assistant message is the "want a
    // random verse?" choice prompt (no data), and the resolved reference
    // only lands once that choice is answered.
    const session = makeSession({
      mode: 'verse',
      modeParams: {},
      messages: [
        { id: 'u1', role: 'user', text: '✨ Verse of the Day' },
        { id: 'p1', role: 'assistant', text: 'Want a random verse?', choicesStatus: 'ready', choices: [] },
        { id: 'a1', role: 'assistant', text: 'Here is 1CH 14:14.', data: { reference: '1CH 14:14' } },
      ],
    })
    expect(describeSession(session)).toBe('1CH 14:14')
  })

  it('describes a freeform session by its first user message', () => {
    const session = makeSession({
      mode: 'freeform',
      messages: [{ id: 'u1', role: 'user', text: 'What does John 3:16 mean?' }],
    })
    expect(describeSession(session)).toBe('What does John 3:16 mean?')
  })

  it('truncates a long first message', () => {
    const longText = 'a'.repeat(100)
    const session = makeSession({
      mode: 'freeform',
      messages: [{ id: 'u1', role: 'user', text: longText }],
    })
    const result = describeSession(session)
    expect(result.length).toBe(60)
    expect(result.endsWith('…')).toBe(true)
  })

  it('falls back to "New conversation" for a freeform session with no messages yet', () => {
    const session = makeSession({ mode: 'freeform', messages: [] })
    expect(describeSession(session)).toBe('New conversation')
  })
})
