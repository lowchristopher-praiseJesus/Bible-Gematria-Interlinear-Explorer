import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DevotionalArtifact } from './DevotionalArtifact'

describe('DevotionalArtifact', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders the reference heading and the markdown body', () => {
    render(<DevotionalArtifact reference="JHN 14:27" text={'Peace is **not** the absence of a storm.\n\nIt is His presence in it.'} />)
    expect(screen.getByRole('heading', { name: 'JHN 14:27' })).toBeInTheDocument()
    expect(screen.getByText('not').tagName).toBe('STRONG')
    expect(screen.getByText(/It is His presence in it\./)).toBeInTheDocument()
  })

  it('copies the raw devotional text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<DevotionalArtifact reference="JHN 14:27" text={'# Title\n\nBody.'} />)
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith('# Title\n\nBody.')
  })
})
