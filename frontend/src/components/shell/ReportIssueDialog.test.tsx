import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportIssueDialog } from './ReportIssueDialog'
import type { Session } from '@/types/session'

const submitReport = vi.fn()
// NOTE: the factory records the call on `submitReport` (so `toHaveBeenCalledWith`
// still works) but returns from a plain, mutable `submitImpl`. Routing a
// rejection back through the `vi.fn()` spy's own return value trips a
// vitest 4.1.11 defect that mis-attributes the (component-caught) rejection to
// the running test. See task-14-report.md.
let submitImpl: (...a: unknown[]) => Promise<unknown> = () => Promise.resolve({ id: 'r-1' })
vi.mock('@/lib/feedbackApi', () => ({
  submitReport: (...a: unknown[]) => {
    submitReport(...a)
    return submitImpl(...a)
  },
}))

const session: Session = {
  id: 's1', createdAt: 1, updatedAt: 2, mode: 'freeform', modeParams: {},
  title: 'Ask Anything', messages: [{ id: 'm1', role: 'user', text: 'hi' }], notes: [],
}

describe('ReportIssueDialog', () => {
  beforeEach(() => {
    submitReport.mockReset()
    submitImpl = () => Promise.resolve({ id: 'r-1' })
  })

  it('requires a description before it can submit', async () => {
    render(<ReportIssueDialog session={session} open onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: /send report/i })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/what went wrong/i), 'the answer was wrong')
    expect(screen.getByRole('button', { name: /send report/i })).toBeEnabled()
  })

  it('submits the chosen category + description and then closes', async () => {
    submitImpl = () => Promise.resolve({ id: 'r-1' })
    const onOpenChange = vi.fn()
    render(<ReportIssueDialog session={session} open onOpenChange={onOpenChange} />)
    await userEvent.selectOptions(screen.getByLabelText(/category/i), 'slow')
    await userEvent.type(screen.getByLabelText(/what went wrong/i), 'took 40 seconds')
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await waitFor(() => expect(submitReport).toHaveBeenCalledWith(session, {
      category: 'slow', description: 'took 40 seconds', email: undefined,
    }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 2500 })
  })

  it('keeps the text and shows an error when submit fails', async () => {
    submitImpl = () => Promise.reject(new Error('Request failed: 413 Payload Too Large'))
    render(<ReportIssueDialog session={session} open onOpenChange={() => {}} />)
    await userEvent.type(screen.getByLabelText(/what went wrong/i), 'boom')
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(await screen.findByText(/couldn.t send/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/what went wrong/i)).toHaveValue('boom')
  })
})
