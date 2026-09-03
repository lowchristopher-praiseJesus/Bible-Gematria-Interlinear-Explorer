import { expect, it, vi, afterEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminReportView } from './AdminReportView'

vi.mock('@/lib/adminApi', () => ({
  getReport: vi.fn(),
  updateReport: vi.fn(),
  deleteReport: vi.fn(),
}))
import { getReport, updateReport, deleteReport } from '@/lib/adminApi'

const detail = {
  id: 'r1', created_at: '2026-09-02T00:00:00Z', client_id: 'c', email: null,
  category: 'wrong_answer', description: 'the answer was wrong', status: 'new', admin_notes: null,
  app_version: '1.0', user_agent: 'UA', viewport: '800x600', page_url: 'http://x/',
  session_mode: 'freeform', session_title: 'Ask Anything', message_count: 2,
  session_json: {
    id: 's1', mode: 'freeform', title: 'Ask Anything',
    messages: [
      { id: 'm1', role: 'user', text: 'what is grace' },
      { id: 'm2', role: 'assistant', text: 'Grace is unmerited favour.', trace: {
        turnId: 't', requestPath: '/chat', startedAt: 0, endedAt: 10, durationMs: 10,
        input: { message: 'what is grace', mode: 'freeform', modeParams: null, historyLength: 0, pageContext: null },
        steps: [], outcome: { type: 'chat', route: null, error: null },
        totals: { toolCalls: 0, llmCalls: 0, llmTokens: null, durationMs: 10 },
      } },
    ],
  },
}

afterEach(() => {
  vi.clearAllMocks()
})


it('renders the transcript and a trajectory per traced turn', async () => {
  ;(getReport as unknown as Mock).mockResolvedValue(detail)
  render(<AdminReportView id="r1" onBack={() => {}} />)
  expect(await screen.findByText('the answer was wrong')).toBeInTheDocument()
  // rendered twice: once in the transcript, once as TrajectoryView's USER step
  expect(screen.getAllByText('what is grace')).toHaveLength(2)
  expect(screen.getAllByText('USER')).toHaveLength(2)   // transcript label + TrajectoryView step
})

it('saves a status change', async () => {
  ;(getReport as unknown as Mock).mockResolvedValue(detail)
  ;(updateReport as unknown as Mock).mockResolvedValue({ ...detail, status: 'resolved' })
  render(<AdminReportView id="r1" onBack={() => {}} />)
  await screen.findByText('the answer was wrong')
  await userEvent.selectOptions(screen.getByLabelText(/status/i), 'resolved')
  await userEvent.click(screen.getByRole('button', { name: /save/i }))
  await waitFor(() => expect(updateReport).toHaveBeenCalledWith('r1', { status: 'resolved', admin_notes: '' }))
})

it('deletes the report and calls onDeleted', async () => {
  ;(getReport as unknown as Mock).mockResolvedValue(detail)
  ;(deleteReport as unknown as Mock).mockResolvedValue({ deleted: 'r1' })
  const onDeleted = vi.fn()
  const onBack = vi.fn()
  render(<AdminReportView id="r1" onBack={onBack} onDeleted={onDeleted} />)
  await screen.findByText('the answer was wrong')
  await userEvent.click(screen.getByRole('button', { name: /delete report/i }))
  // Deleting now goes through a confirmation dialog.
  await userEvent.click(await screen.findByRole('button', { name: /delete permanently/i }))
  await waitFor(() => expect(deleteReport).toHaveBeenCalledWith('r1'))
  expect(onDeleted).toHaveBeenCalledTimes(1)
  expect(onBack).not.toHaveBeenCalled()
})

it('does not delete when the confirm is cancelled', async () => {
  ;(getReport as unknown as Mock).mockResolvedValue(detail)
  render(<AdminReportView id="r1" onBack={() => {}} onDeleted={() => {}} />)
  await screen.findByText('the answer was wrong')
  await userEvent.click(screen.getByRole('button', { name: /delete report/i }))
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  expect(deleteReport).not.toHaveBeenCalled()
})
