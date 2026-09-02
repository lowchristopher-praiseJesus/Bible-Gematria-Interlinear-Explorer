import { getClientId } from '@/lib/clientId'
import { parseJsonResponse } from '@/lib/chatApi'
import type { Session } from '@/types/session'

export type ReportCategory = 'wrong_answer' | 'error' | 'slow' | 'ui' | 'other'

export interface ReportForm {
  category: ReportCategory
  description: string
  email?: string
}

function appVersion(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.VITE_APP_VERSION ?? 'dev'
}

export async function submitReport(session: Session, form: ReportForm): Promise<{ id: string }> {
  const payload = {
    category: form.category,
    description: form.description,
    email: form.email?.trim() || undefined,
    client_id: getClientId(),
    app_version: appVersion(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    page_url: typeof location !== 'undefined' ? location.href : '',
    session_json: {
      id: session.id,
      mode: session.mode,
      modeParams: session.modeParams,
      title: session.title,
      messages: session.messages,
    },
  }

  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<{ id: string }>(res)
}
