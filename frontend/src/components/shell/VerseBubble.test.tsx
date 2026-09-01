import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VerseBubble } from './VerseBubble'
import { useArtifactStore } from '@/store/useArtifactStore'
import * as chatApi from '@/lib/chatApi'

describe('VerseBubble', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

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
          reference: 'JHN 3:16',
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
    render(<VerseBubble data={{ reference: 'JHN 3:16', translations: { 'eng-KJV': 'Only text' } }} />)
    expect(screen.queryByLabelText(/translation/i)).not.toBeInTheDocument()
    expect(screen.getByText('Only text')).toBeInTheDocument()
  })

  it('decodes HTML entities in the translation text', () => {
    render(
      <VerseBubble
        data={{
          reference: 'JOB 1:5',
          translations: { 'eng-ESV': 'Job said, &#8220;It may be&#8221; that my sons have sinned.' },
        }}
      />
    )
    expect(screen.getByText('Job said, “It may be” that my sons have sinned.')).toBeInTheDocument()
  })

  it('opens the interlinear artifact for the verse when its number is clicked', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue({
      verse: { id: 23400, ref: 'John 3:16', bnum: 43, cnum: 3, vnum: 16, Ch: '', wordnum: 0, letternum: 0, total: 0, text1769: '', textAV1611: '', language: 'Greek', originalText: '', stephanusText: null, stephanusTotal: null, lcFiles: [], hasQere: false, code: null, alert: null },
      navigation: { previous: 23399, next: 23401 },
      kjvWords: [],
      originalWords: [],
      strongsDefinitions: {},
    })
    render(<VerseBubble data={{ reference: 'JHN 3:16', translations: { 'eng-KJV': 'For God so loved the world...' } }} />)

    await userEvent.click(screen.getByRole('button', { name: /open jhn 3:16 in the original language/i }))

    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: 'JHN 3:16 ▸',
      params: { reference: 'JHN 3:16' },
    })
  })

  it('shows the reference in a bordered box, matching the reading-plan verse box', () => {
    const { container } = render(
      <VerseBubble data={{ reference: 'JHN 3:16', translations: { 'eng-KJV': 'For God so loved the world...' } }} />
    )
    expect(screen.getByText('JHN 3:16')).toBeInTheDocument()
    expect(container.querySelector('.border')).not.toBeNull()
  })
})
