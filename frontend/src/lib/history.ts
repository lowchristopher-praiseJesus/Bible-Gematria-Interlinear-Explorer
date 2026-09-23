import type { DevotionalArtifactParams, SessionMessage } from '@/types/session'

/**
 * A delivered devotional's chat bubble is only its pointer sentence
 * ("Here's a devotional on X") — the actual body lives solely in the
 * message's `devotional` artifact, so it never floods the transcript.
 * History sent to the backend needs the real text swapped back in, or a
 * follow-up turn (e.g. voice mode's "read out the devotion", or Tell a
 * Story deriving themes from this conversation) reaches the LLM with no
 * devotional content to answer from.
 */
export function toHistory(messages: SessionMessage[]): { role: 'user' | 'assistant'; text: string }[] {
  return messages.map((m) => {
    const devotional = m.artifacts?.find((a) => a.type === 'devotional')
    const text = devotional
      ? (devotional.params as unknown as DevotionalArtifactParams).text
      : m.text
    return { role: m.role, text }
  })
}
