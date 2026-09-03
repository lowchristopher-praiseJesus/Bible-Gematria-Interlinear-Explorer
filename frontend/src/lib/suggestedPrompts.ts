import type { SessionMode } from '@/types/session'

/**
 * Opening conversation starters shown as clickable chips when a mode is
 * first entered and the user hasn't sent anything yet — a nudge instead
 * of a blank input staring back at them.
 *
 * Only modes that would otherwise land on an empty input need an entry.
 * The guided modes (reading_plan, parable, verse, topic) already open
 * with their own choice pills, so they're intentionally absent.
 */
export const SUGGESTED_PROMPTS: Partial<Record<SessionMode, string[]>> = {
  freeform: [
    'What does “selah” mean in the Psalms?',
    'Show me the interlinear for John 1:1',
    'What is the gematria of Genesis 1:1?',
    'Trace the theme of covenant across the Bible',
  ],
}
