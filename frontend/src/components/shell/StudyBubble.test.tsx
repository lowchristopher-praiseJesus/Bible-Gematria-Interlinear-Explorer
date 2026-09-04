import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StudyBubble } from './StudyBubble'
import { useArtifactStore } from '@/store/useArtifactStore'

describe('StudyBubble', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, activeNote: null, status: 'idle', data: null, error: null })
  })

  it('renders nothing when there are no verses', () => {
    const { container } = render(<StudyBubble data={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the reference, original text, and a word-by-word breakdown', () => {
    render(
      <StudyBubble
        data={{
          verses: [
            {
              reference: 'JHN.003.016',
              display_reference: 'JHN 3:16',
              commentary: {
                language: 'grc',
                text: 'Οὕτως γὰρ ἠγάπησεν ὁ Θεὸς τὸν κόσμον',
                words: [
                  {
                    position: 3,
                    text: 'ἠγάπησεν',
                    lemma: 'ἀγαπάω',
                    translation: { gloss: 'loved' },
                    morphology: { morph: 'V-AAI-3S' },
                    lexical: { strong: '25' },
                  },
                ],
              },
            },
          ],
        }}
      />
    )
    expect(screen.getByText('JHN 3:16')).toBeInTheDocument()
    expect(screen.getByText(/Οὕτως γὰρ ἠγάπησεν/)).toBeInTheDocument()
    expect(screen.getByText('loved')).toBeInTheDocument()
    expect(screen.getByText('ἀγαπάω')).toBeInTheDocument()
    expect(screen.getByText('V-AAI-3S')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'G25' })).toBeInTheDocument()
  })

  it('opens the Strong’s artifact when a word’s number is tapped', async () => {
    render(
      <StudyBubble
        data={{
          verses: [
            {
              display_reference: 'JHN 3:16',
              commentary: {
                language: 'grc',
                words: [{ text: 'Θεὸς', lemma: 'θεός', translation: { gloss: 'God' }, lexical: { strong: '2316' } }],
              },
            },
          ],
        }}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'G2316' }))
    expect(useArtifactStore.getState().activeArtifact).toMatchObject({ type: 'strongs', params: { id: 'G2316' } })
  })

  it('prefixes Hebrew Strong’s numbers with H and reads right-to-left', () => {
    render(
      <StudyBubble
        data={{
          verses: [
            {
              display_reference: 'GEN 1:1',
              commentary: {
                language: 'hbo',
                text: 'בְּרֵאשִׁית',
                words: [{ text: 'בְּרֵאשִׁית', lemma: 'רֵאשִׁית', lexical: { strong: '7225' } }],
              },
            },
          ],
        }}
      />
    )
    expect(screen.getByRole('button', { name: 'H7225' })).toBeInTheDocument()
  })

  it('falls back to a note when a verse has no breakdown', () => {
    render(
      <StudyBubble
        data={{ verses: [{ display_reference: 'JHN 3:16', note: 'No commentary available.' }] }}
      />
    )
    expect(screen.getByText('No commentary available.')).toBeInTheDocument()
  })
})
