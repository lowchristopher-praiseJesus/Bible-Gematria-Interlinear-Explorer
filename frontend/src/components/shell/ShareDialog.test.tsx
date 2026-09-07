import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareDialog } from './ShareDialog'
import type { Session } from '@/types/session'

const createShare = vi.fn()
let createImpl: (...a: unknown[]) => Promise<unknown> = () =>
  Promise.resolve({ token: 'tok', url: 'http://localhost/?import=tok' })
vi.mock('@/lib/shareApi', () => ({
  createShare: (...a: unknown[]) => {
    createShare(...a)
    return createImpl(...a)
  },
}))

const session: Session = {
  id: 's1', createdAt: 1, updatedAt: 2, mode: 'freeform', modeParams: {},
  title: 'Ask Anything', messages: [{ id: 'm1', role: 'user', text: 'hi' }], notes: [],
}

describe('ShareDialog', () => {
  beforeEach(() => {
    createShare.mockReset()
    createImpl = () => Promise.resolve({ token: 'tok', url: 'http://localhost/?import=tok' })
  })

  it('creates a link on open and shows it', async () => {
    render(<ShareDialog session={session} open onOpenChange={() => {}} />)
    expect(await screen.findByLabelText('Share link')).toHaveValue('http://localhost/?import=tok')
    expect(createShare).toHaveBeenCalledTimes(1)
  })

  it('copies the link to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ShareDialog session={session} open onOpenChange={() => {}} />)
    await screen.findByLabelText('Share link')
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith('http://localhost/?import=tok')
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument()
  })

  it('shows a retry on failure and re-requests on click', async () => {
    createImpl = () => Promise.reject(new Error('Request failed: 500'))
    render(<ShareDialog session={session} open onOpenChange={() => {}} />)
    expect(await screen.findByText(/couldn.t create a share link/i)).toBeInTheDocument()
    createImpl = () => Promise.resolve({ token: 't2', url: 'http://localhost/?import=t2' })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByLabelText('Share link')).toHaveValue('http://localhost/?import=t2')
  })
})
