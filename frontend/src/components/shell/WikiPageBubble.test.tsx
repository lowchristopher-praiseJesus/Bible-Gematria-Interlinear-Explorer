import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikiPageBubble } from './WikiPageBubble'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { WikiPageResponse } from '@/types/api'

const pageFixture: WikiPageResponse = {
  series_id: 'present-day-ministry-of-jesus',
  slug: 'grace',
  title: 'Grace',
  kind: 'concept',
  body_html:
    '<p>Defined as <strong>undeserved favor</strong>. See ' +
    '<a href="/topic-wiki?series=present-day-ministry-of-jesus&page=holiness">Holiness</a> for more, ' +
    'and <a href="/explorer?reference=ROM%206%3A14">Rom 6:14</a>.</p>',
  citation: 'Joseph Prince — The Present-Day Ministry of Jesus and How It Empowers You',
}

describe('WikiPageBubble', () => {
  it('renders the page title, body, and citation', () => {
    render(<WikiPageBubble data={pageFixture} onOpenConcept={vi.fn()} />)
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(screen.getByText(/undeserved favor/)).toBeInTheDocument()
    expect(screen.getByText(pageFixture.citation)).toBeInTheDocument()
  })

  it('opens a wikilink as a new chat message via onOpenConcept', async () => {
    const onOpenConcept = vi.fn()
    render(<WikiPageBubble data={pageFixture} onOpenConcept={onOpenConcept} />)
    await userEvent.click(screen.getByRole('link', { name: 'Holiness' }))
    expect(onOpenConcept).toHaveBeenCalledWith(
      'present-day-ministry-of-jesus',
      'holiness',
      'Holiness',
    )
  })

  it('opens a scripture reference as an interlinear artifact', async () => {
    render(<WikiPageBubble data={pageFixture} onOpenConcept={vi.fn()} />)
    await userEvent.click(screen.getByRole('link', { name: 'Rom 6:14' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: 'Rom 6:14 ▸',
      params: { reference: 'ROM 6:14' },
    })
  })

  it('does not navigate the browser for an intercepted link', async () => {
    render(<WikiPageBubble data={pageFixture} onOpenConcept={vi.fn()} />)
    const link = screen.getByRole('link', { name: 'Rom 6:14' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})