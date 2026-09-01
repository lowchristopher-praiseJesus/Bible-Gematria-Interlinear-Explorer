import type { Session } from '@/types/session'

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatSlug(id: string): string {
  return capitalize(id.replace(/[_-]/g, ' '))
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed
}

/**
 * A short, content-specific line for a session's sidebar row — distinct
 * from `session.title` (which repeats the mode name the sidebar's own
 * section header already shows) and from the generic starter text every
 * session's first user message carries (e.g. every reading-plan session
 * opens with the literal text "📅 Bible in a Year", which says nothing
 * about which plan or day). Falls back to the mode name only when nothing
 * more specific is available yet (a choice prompt still unanswered).
 */
export function describeSession(session: Session): string {
  const { mode, modeParams, messages } = session

  switch (mode) {
    case 'reading_plan': {
      if (!modeParams.plan) return 'Choosing a reading plan'
      const planLabel = modeParams.plan === 'canonical' ? 'Canonical' : 'Chronological'
      return `Day ${(modeParams.dayIndex ?? 0) + 1} — ${planLabel}`
    }
    case 'parable':
      return modeParams.parableId ? formatSlug(modeParams.parableId) : 'Choosing a parable'
    case 'topic':
      return modeParams.conceptSlug ? formatSlug(modeParams.conceptSlug) : 'Choosing a topic'
    case 'verse': {
      // The first assistant message is often just the "which verse?"
      // choice prompt (no data yet) — the resolved reference lands on a
      // later message once "Surprise me" (or a typed reference) settles.
      const primerReference = messages.find((m) => m.role === 'assistant' && m.data?.reference)?.data
        ?.reference as string | undefined
      const reference = modeParams.reference ?? primerReference
      return reference ?? 'Random verse'
    }
    case 'freeform':
    default: {
      const firstUserMessage = messages.find((m) => m.role === 'user')?.text
      return firstUserMessage ? truncate(firstUserMessage, 60) : 'New conversation'
    }
  }
}
