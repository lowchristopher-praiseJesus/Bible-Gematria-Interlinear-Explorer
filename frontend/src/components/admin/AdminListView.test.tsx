import { expect, it, vi, afterEach, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminListView } from './AdminListView'

vi.mock('@/lib/adminApi', () => ({
  listReports: vi.fn(),
}))
import { listReports } from '@/lib/adminApi'

afterEach(() => vi.clearAllMocks())

it('renders rows and opens one', async () => {
  ;(listReports as unknown as Mock).mockResolvedValue({
    total: 1,
    items: [{
      id: 'r1', created_at: '2026-09-02T00:00:00Z', category: 'error', status: 'new',
      session_mode: 'freeform', session_title: 'Ask Anything', message_count: 4, has_email: true,
    }],
  })
  const onOpen = vi.fn()
  render(<AdminListView onOpen={onOpen} />)
  await screen.findByText('Ask Anything')
  await userEvent.click(screen.getByText('Ask Anything'))
  expect(onOpen).toHaveBeenCalledWith('r1')
})

it('shows an auth message when the API says unauthorized', async () => {
  ;(listReports as unknown as Mock).mockRejectedValue(new Error('unauthorized'))
  render(<AdminListView onOpen={() => {}} />)
  expect(await screen.findByText(/sign in as an admin/i)).toBeInTheDocument()
})