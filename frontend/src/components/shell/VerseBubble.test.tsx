import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VerseBubble } from './VerseBubble'

describe('VerseBubble', () => {
  it('renders nothing when there are no translations', () => {
    const { container } = render(<VerseBubble data={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('defaults to KJV and shows its text', () => {
    render(
      <VerseBubble
        data={{
          reference: 'JHN 3:16',
          translations: {
            'eng-NIV': 'For God so loved the world (NIV)...',
            'eng-KJV': 'For God so loved the world (KJV)...',
          },
        }}
      />
    )
    expect(screen.getByText('For God so loved the world (KJV)...')).toBeInTheDocument()
  })

  it('switches translation text when a different one is selected', async () => {
    render(
      <VerseBubble
        data={{
          translations: {
            'eng-NIV': 'NIV text',
            'eng-KJV': 'KJV text',
          },
        }}
      />
    )
    expect(screen.getByText('KJV text')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText(/translation/i), 'NIV')
    expect(screen.getByText('NIV text')).toBeInTheDocument()
  })

  it('does not render a translation switcher with only one translation', () => {
    render(<VerseBubble data={{ translations: { 'eng-KJV': 'Only text' } }} />)
    expect(screen.queryByLabelText(/translation/i)).not.toBeInTheDocument()
    expect(screen.getByText('Only text')).toBeInTheDocument()
  })
})
