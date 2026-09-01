import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikiConceptArtifact } from './WikiConceptArtifact'
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

describe('WikiConceptArtifact', () => {
  afterEach(() => {
    useArtifactStore.setState({ activeArtifact: null, history: [], status: 'idle', data: null, error: null })
  })

  it('renders the page title, body, and citation', () => {
    render(<WikiConceptArtifact data={pageFixture} />)
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(screen.getByText(/undeserved favor/)).toBeInTheDocument()
    expect(screen.getByText(pageFixture.citation)).toBeInTheDocument()
  })

  it('opens a wikilink as a nested wiki_concept artifact', async () => {
    render(<WikiConceptArtifact data={pageFixture} />)
    await userEvent.click(screen.getByRole('link', { name: 'Holiness' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'wiki_concept',
      label: 'Holiness ▸',
      params: { seriesId: 'present-day-ministry-of-jesus', slug: 'holiness' },
    })
  })

  it('opens a scripture reference as an interlinear artifact', async () => {
    render(<WikiConceptArtifact data={pageFixture} />)
    await userEvent.click(screen.getByRole('link', { name: 'Rom 6:14' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: 'Rom 6:14 ▸',
      params: { reference: 'ROM 6:14' },
    })
  })

  it('does not navigate the browser for an intercepted link', async () => {
    render(<WikiConceptArtifact data={pageFixture} />)
    const link = screen.getByRole('link', { name: 'Rom 6:14' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
