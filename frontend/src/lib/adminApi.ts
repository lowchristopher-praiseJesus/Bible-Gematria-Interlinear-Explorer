import type { Trace } from '@/types/trace'

export interface ReportListItem {
  id: string
  created_at: string
  category: string
  status: string
  session_mode: string
  session_title: string
  message_count: number
  has_email: boolean
}

export interface ReportListResult {
  total: number
  items: ReportListItem[]
}

export interface AdminMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  type?: string
  trace?: Trace
}

export interface ReportDetail {
  id: string
  created_at: string
  client_id: string
  email: string | null
  category: string
  description: string
  status: string
  admin_notes: string | null
  app_version: string
  user_agent: string
  viewport: string
  page_url: string
  session_mode: string
  session_title: string
  message_count: number
  session_json: { id?: string; mode?: string; title?: string; messages: AdminMessage[] }
}

async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (res.status === 401) throw new Error('unauthorized')
  if (res.status === 503) throw new Error('admin_not_configured')
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export function listReports(params: {
  status?: string
  category?: string
  limit?: number
  offset?: number
} = {}): Promise<ReportListResult> {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  if (params.category) q.set('category', params.category)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return adminFetch<ReportListResult>(`/api/admin/feedback${qs ? `?${qs}` : ''}`)
}

export function getReport(id: string): Promise<ReportDetail> {
  return adminFetch<ReportDetail>(`/api/admin/feedback/${encodeURIComponent(id)}`)
}

export function updateReport(
  id: string,
  patch: { status?: string; admin_notes?: string },
): Promise<ReportDetail> {
  return adminFetch<ReportDetail>(`/api/admin/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteReport(id: string): Promise<{ deleted: string }> {
  return adminFetch<{ deleted: string }>(`/api/admin/feedback/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function deleteAllReports(): Promise<{ deleted_count: number }> {
  return adminFetch<{ deleted_count: number }>('/api/admin/feedback', { method: 'DELETE' })
}
