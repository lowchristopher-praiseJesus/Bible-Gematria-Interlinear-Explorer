import { expect, it, vi, afterEach, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminListView } from './AdminListView'

vi.mock('@/lib/adminApi', () => ({
  listReports: vi.fn(),
  deleteReport: vi.fn(),
  deleteAllReports: vi.fn(),
}))
import { listReports, deleteReport, deleteAllReports } from '@/lib/adminApi'

afterEach(() => {
  vi.clearAllMocks()
})

const twoRows = {
  total: 2,
  items: [
    {
      id: 'r1', created_at: '2026-09-02T00:00:00Z', category: 'error', status: 'new',
      session_mode: 'freeform', session_title: 'First Session', message_count: 4, has_email: true,
    },
    {
      id: 'r2', created_at: '2026-09-02T01:00:00Z', category: 'ui', status: 'new',
      session_mode: 'freeform', session_title: 'Second Session', message_count: 2, has_email: false,
    },
  ],
}

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

it('deletes a single report from its row without opening it', async () => {
  ;(listReports as unknown as Mock).mockResolvedValue(twoRows)
  ;(deleteReport as unknown as Mock).mockResolvedValue({ deleted: 'r1' })
  const onOpen = vi.fn()
  render(<AdminListView onOpen={onOpen} />)

  const firstRow = (await screen.findByText('First Session')).closest('tr')!
  await userEvent.click(within(firstRow).getByRole('button', { name: /delete report r1/i }))
  // The row action now asks for confirmation before it deletes anything.
  await userEvent.click(await screen.findByRole('button', { name: 'Delete report' }))

  expect(deleteReport).toHaveBeenCalledWith('r1')
  expect(onOpen).not.toHaveBeenCalled()
  expect(screen.queryByText('First Session')).not.toBeInTheDocument()
  expect(screen.getByText('Second Session')).toBeInTheDocument()
  expect(screen.getByText('1 report')).toBeInTheDocument()
})

it('clears all reports after confirmation', async () => {
  ;(listReports as unknown as Mock)
    .mockResolvedValueOnce(twoRows)
    .mockResolvedValueOnce({ total: 0, items: [] })
  ;(deleteAllReports as unknown as Mock).mockResolvedValue({ deleted_count: 2 })
  render(<AdminListView onOpen={() => {}} />)

  await screen.findByText('First Session')
  await userEvent.click(screen.getByRole('button', { name: /clear all/i }))
  await userEvent.click(await screen.findByRole('button', { name: 'Delete all reports' }))

  expect(deleteAllReports).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('First Session')).not.toBeInTheDocument()
  expect(screen.getByText('0 reports')).toBeInTheDocument()
})

it('does not clear when the user cancels the confirm', async () => {
  ;(listReports as unknown as Mock).mockResolvedValue(twoRows)
  render(<AdminListView onOpen={() => {}} />)

  await screen.findByText('First Session')
  await userEvent.click(screen.getByRole('button', { name: /clear all/i }))
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

  expect(deleteAllReports).not.toHaveBeenCalled()
  expect(screen.getByText('First Session')).toBeInTheDocument()
})
