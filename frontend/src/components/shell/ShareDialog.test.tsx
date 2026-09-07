import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const origExec = (document as unknown as { execCommand?: unknown }).execCommand

  beforeEach(() => {
    createShare.mockReset()
    createImpl = () => Promise.resolve({ token: 'tok', url: 'http://localhost/?import=tok' })
  })

  afterEach(() => {
    if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard)
    else Object.assign(navigator, { clipboard: undefined })
    Object.assign(document, { execCommand: origExec })
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

  it('falls back to execCommand when the async clipboard API is unavailable', async () => {
    // Plain-http LAN context: navigator.clipboard is undefined.
    Object.assign(navigator, { clipboard: undefined })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.assign(document, { execCommand })
    render(<ShareDialog session={session} open onOpenChange={() => {}} />)
    await screen.findByLabelText('Share link')
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument()
  })

  it('shows a manual-copy hint when every copy path fails', async () => {
    Object.assign(navigator, { clipboard: undefined })
    Object.assign(document, { execCommand: vi.fn().mockReturnValue(false) })
    render(<ShareDialog session={session} open onOpenChange={() => {}} />)
    await screen.findByLabelText('Share link')
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(await screen.findByText(/couldn.t copy automatically/i)).toBeInTheDocument()
  })

  it('re-requests a link when the conversation has grown since the last share', async () => {
    createImpl = () => Promise.resolve({ token: 'a', url: 'http://localhost/?import=a' })
    const twoMsg: Session = {
      ...session,
      messages: [
        { id: 'm1', role: 'user', text: 'hi' },
        { id: 'm2', role: 'assistant', text: 'hello' },
      ],
    }
    const { rerender } = render(<ShareDialog session={twoMsg} open onOpenChange={() => {}} />)
    expect(await screen.findByLabelText('Share link')).toHaveValue('http://localhost/?import=a')
    expect(createShare).toHaveBeenCalledTimes(1)

    createImpl = () => Promise.resolve({ token: 'b', url: 'http://localhost/?import=b' })
    const threeMsg: Session = {
      ...twoMsg,
      messages: [...twoMsg.messages, { id: 'm3', role: 'user', text: 'more' }],
    }
    rerender(<ShareDialog session={threeMsg} open onOpenChange={() => {}} />)
    expect(await screen.findByLabelText('Share link')).toHaveValue('http://localhost/?import=b')
    expect(createShare).toHaveBeenCalledTimes(2)
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
