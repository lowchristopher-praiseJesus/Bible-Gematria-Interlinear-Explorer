import { getClientId } from '@/lib/clientId'
import { parseJsonResponse } from '@/lib/chatApi'
import type { Session, SessionMessage, SharePayload } from '@/types/session'

/** Drop the per-turn diagnostic `trace` blob — large and never needed to
 * re-render a shared conversation. The backend strips it again on write;
 * doing it here keeps the request small. */
function stripTrace(messages: SessionMessage[]): SessionMessage[] {
  return messages.map((m) => {
    if (m.trace === undefined) return m
    const { trace: _trace, ...rest } = m
    return rest as SessionMessage
  })
}

export async function createShare(session: Session): Promise<{ token: string; url: string }> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: getClientId(),
      session: {
        mode: session.mode,
        modeParams: session.modeParams,
        title: session.title,
        messages: stripTrace(session.messages),
        notes: session.notes,
      },
    }),
  })
  return parseJsonResponse<{ token: string; url: string }>(res)
}

export interface FetchedShare extends SharePayload {
  shared_at?: string
}

export async function fetchShare(token: string): Promise<FetchedShare> {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}`)
  return parseJsonResponse<FetchedShare>(res)
}
