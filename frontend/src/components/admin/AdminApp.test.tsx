import { expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminApp } from './AdminApp'

vi.mock('@/lib/adminApi', () => ({
  listReports: vi.fn().mockResolvedValue({
    total: 1,
    items: [{
      id: 'r1', created_at: '2026-09-02T00:00:00Z', category: 'error', status: 'new',
      session_mode: 'freeform', session_title: 'Ask Anything', message_count: 1, has_email: false,
    }],
  }),
  getReport: vi.fn().mockResolvedValue({
    id: 'r1', created_at: '2026-09-02T00:00:00Z', client_id: 'c', email: null,
    category: 'error', description: 'boom', status: 'new', admin_notes: null,
    app_version: 'v', user_agent: 'UA', viewport: '1x1', page_url: 'u',
    session_mode: 'freeform', session_title: 'Ask Anything', message_count: 0,
    session_json: { messages: [] },
  }),
  updateReport: vi.fn(),
}))

afterEach(() => {
  window.history.pushState({}, '', '/admin')
})

it('navigates from list to detail and back via the URL', async () => {
  window.history.pushState({}, '', '/admin')
  render(<AdminApp />)
  await userEvent.click(await screen.findByText('Ask Anything'))
  expect(await screen.findByText('boom')).toBeInTheDocument()
  expect(location.search).toContain('id=r1')
  await userEvent.click(screen.getByText(/back to list/i))
  expect(location.search).not.toContain('id=r1')
})
