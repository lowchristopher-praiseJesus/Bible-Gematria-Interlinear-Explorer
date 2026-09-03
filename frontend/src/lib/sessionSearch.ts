import type { Session } from '@/types/session'
import { describeSession } from './sessionDescription'

/**
 * The lowercased blob of text a session is matched against by the
 * sidebar search box: its title, the content-specific description shown
 * on its row, and every message it holds. Kept in one place so the
 * search box and its tests agree on exactly what "searching a
 * conversation" covers.
 */
export function sessionHaystack(session: Session): string {
  const parts = [session.title, describeSession(session)]
  for (const message of session.messages) {
    if (message?.text) parts.push(message.text)
  }
  return parts.join('\n').toLowerCase()
}

/**
 * Filters `sessions` to those matching `query`. The query is split on
 * whitespace into terms and a session matches only if *every* term is a
 * substring of its haystack, so "love neighbour" and "John 3:16" both
 * behave as expected. An empty or whitespace-only query is not a filter
 * — the full list is returned unchanged.
 */
export function filterSessions(sessions: Session[], query: string): Session[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return sessions
  return sessions.filter((session) => {
    const hay = sessionHaystack(session)
    return terms.every((term) => hay.includes(term))
  })
}

function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface HighlightSegment {
  text: string
  hit: boolean
}

/**
 * Splits `text` into consecutive segments, flagging the runs that match a
 * term in `query` so a row can wrap them in `<mark>`. An empty query
 * yields the whole string as one non-hit segment.
 */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return [{ text, hit: false }]
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, hit: terms.includes(part.toLowerCase()) }))
}
