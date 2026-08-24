import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StrongsBubble } from './StrongsBubble'

describe('StrongsBubble', () => {
  it('renders nothing when there are no words', () => {
    const { container } = render(<StrongsBubble data={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders lemma, transliteration, and definition for one entry', () => {
    render(
      <StrongsBubble
        data={{
          words: {
            G0025: { lemma: 'ἀγαπάω\n\nἀγαπάω', transliteration: 'agapaō', definition: 'to love' },
          },
        }}
      />
    )
    expect(screen.getByText('G0025')).toBeInTheDocument()
    expect(screen.getByText(/agapaō/)).toBeInTheDocument()
    expect(screen.getByText('ἀγαπάω')).toBeInTheDocument()
    expect(screen.getByText('to love')).toBeInTheDocument()
  })

  it('renders multiple entries for a word search', () => {
    render(
      <StrongsBubble
        data={{
          words: {
            G0025: { lemma: 'ἀγαπάω', definition: 'to love' },
            G5368: { lemma: 'φιλέω', definition: 'to be fond of' },
          },
        }}
      />
    )
    expect(screen.getByText('G0025')).toBeInTheDocument()
    expect(screen.getByText('G5368')).toBeInTheDocument()
  })
})
