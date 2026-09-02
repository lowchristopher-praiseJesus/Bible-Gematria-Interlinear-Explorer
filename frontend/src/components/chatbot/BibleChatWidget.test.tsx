import { expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BibleChatWidget } from './BibleChatWidget'

const submitReport = vi.fn()
vi.mock('@/lib/feedbackApi', () => ({ submitReport: (...a: unknown[]) => submitReport(...a) }))

afterEach(() => { vi.unstubAllGlobals(); submitReport.mockReset() })

it('attaches a trace from the terminal SSE event and reports it', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({
      type: 'chat', message: 'hello there', route: 'AI Fallback',
      trace: { turnId: 'w1', requestPath: '/chat', steps: [], outcome: { type: 'chat', route: null, error: null } },
    }),
  }))
  vi.stubGlobal('prompt', () => 'it was wrong')
  submitReport.mockResolvedValue({ id: 'r-1' })

  render(<BibleChatWidget apiUrl="/api/bible-chat" position="inline" />)
  await userEvent.type(screen.getByRole('textbox'), 'hi')
  await userEvent.keyboard('{Enter}')
  await screen.findByText('hello there')

  await userEvent.click(screen.getByRole('button', { name: /report an issue/i }))
  await waitFor(() => expect(submitReport).toHaveBeenCalled())
  const [, form] = submitReport.mock.calls[0]
  expect(form.description).toBe('it was wrong')
})
