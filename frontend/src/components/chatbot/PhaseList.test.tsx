import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PhaseList } from './PhaseList'
import type { PhaseResult } from '@/types/session'

const done = (over: Partial<PhaseResult> = {}): PhaseResult => ({
  index: 1, title: 'Contextual Scope', status: 'done', markdown: 'Findings body text.', ...over,
})

describe('PhaseList', () => {
  it('shows each phase title collapsed, with the body hidden until expanded', async () => {
    render(<PhaseList phases={[done()]} />)
    expect(screen.getByText(/contextual scope/i)).toBeInTheDocument()
    expect(screen.queryByText(/findings body text/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /contextual scope/i }))
    expect(screen.getByText(/findings body text/i)).toBeInTheDocument()
  })

  it('marks a running phase as in progress', () => {
    render(<PhaseList phases={[done({ status: 'running', markdown: '' })]} />)
    expect(screen.getByLabelText(/in progress/i)).toBeInTheDocument()
  })

  it('shows an errored phase as failed', () => {
    render(<PhaseList phases={[done({ status: 'error', markdown: 'provider timeout' })]} />)
    expect(screen.getByLabelText(/could not be completed/i)).toBeInTheDocument()
  })

  it('lists verified witnesses for phase 4', async () => {
    render(<PhaseList phases={[done({
      index: 4, title: 'Witnesses',
      citations: [{ reference: '1CO 15:51-52', text: 'Behold, I shew you a mystery', verified: true }],
    })]} />)
    await userEvent.click(screen.getByRole('button', { name: /witnesses/i }))
    expect(screen.getByText('1CO 15:51-52')).toBeInTheDocument()
    expect(screen.getByText(/shew you a mystery/i)).toBeInTheDocument()
  })

  it('shows verdict badges for phase 8', async () => {
    render(<PhaseList phases={[done({
      index: 8, title: 'Validation',
      verdicts: [
        { test: 'heart', passed: true },
        { test: 'cross', passed: true },
        { test: 'grace', passed: true },
      ],
    })]} />)
    await userEvent.click(screen.getByRole('button', { name: /validation/i }))
    expect(screen.getAllByText(/passed/i)).toHaveLength(3)
  })

  it('raises a caution banner when a validation test failed', () => {
    render(<PhaseList phases={[done({
      index: 8, title: 'Validation',
      verdicts: [
        { test: 'heart', passed: true },
        { test: 'cross', passed: false, reason: 'reintroduces sin-consciousness' },
        { test: 'grace', passed: true },
      ],
    })]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/cross test/i)
    expect(screen.getByRole('status')).toHaveTextContent(/sin-consciousness/i)
  })

  it('renders an index-0 notice as a plain line, not a collapsible phase', () => {
    render(<PhaseList phases={[done({
      index: 0, title: 'Passage', markdown: 'Reading that as **MAT 25:1-13**.',
    })]} />)
    expect(screen.getByText(/reading that as/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/phase 0/i)).not.toBeInTheDocument()
  })

  it('renders nothing for an empty phase list', () => {
    const { container } = render(<PhaseList phases={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
