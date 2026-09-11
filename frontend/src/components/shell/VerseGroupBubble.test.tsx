import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VerseGroupBubble } from './VerseGroupBubble'
import * as chatApi from '@/lib/chatApi'

describe('VerseGroupBubble', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a VerseBubble for every verse passed in', () => {
    render(
      <VerseGroupBubble
        verses={[
          { reference: 'GAL 5:22', translations: { 'eng-KJV': 'But the fruit of the Spirit is love, joy...' } },
          { reference: 'JAS 1:2', translations: { 'eng-KJV': 'Count it all joy...' } },
        ]}
      />
    )

    expect(screen.getByText('But the fruit of the Spirit is love, joy...')).toBeInTheDocument()
    expect(screen.getByText('Count it all joy...')).toBeInTheDocument()
  })

  it('does not show a compare button when there is only one verse', () => {
    render(<VerseGroupBubble verses={[{ reference: 'GAL 5:22', translations: { 'eng-KJV': 'Text' } }]} />)

    expect(screen.queryByRole('button', { name: /compare/i })).not.toBeInTheDocument()
  })

  it('opens a fullscreen view with every verse when Compare is clicked', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue({
      verse: { id: 1, ref: 'GAL 5:22', bnum: 48, cnum: 5, vnum: 22, Ch: '', wordnum: 0, letternum: 0, total: 0, text1769: '', textAV1611: '', language: 'Greek', originalText: '', stephanusText: null, stephanusTotal: null, lcFiles: [], hasQere: false, code: null, alert: null },
      navigation: { previous: 1, next: 2 },
      kjvWords: [],
      originalWords: [],
      strongsDefinitions: {},
    })
    render(
      <VerseGroupBubble
        verses={[
          { reference: 'GAL 5:22', translations: { 'eng-KJV': 'But the fruit of the Spirit is love, joy...' } },
          { reference: 'JAS 1:2', translations: { 'eng-KJV': 'Count it all joy...' } },
        ]}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: /compare/i }))

    const fixedPane = screen.getByRole('group', { name: /original view/i })
    expect(fixedPane).toHaveTextContent('But the fruit of the Spirit is love, joy...')
    expect(fixedPane).toHaveTextContent('Count it all joy...')
  })

  it('skips verses with no reference or translations when building the fullscreen list', async () => {
    render(
      <VerseGroupBubble
        verses={[
          { reference: 'GAL 5:22', translations: { 'eng-KJV': 'But the fruit of the Spirit is love, joy...' } },
          {},
          { reference: 'JAS 1:2', translations: { 'eng-KJV': 'Count it all joy...' } },
        ]}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: /compare/i }))

    const fixedPane = screen.getByRole('group', { name: /original view/i })
    expect(fixedPane).toHaveTextContent('But the fruit of the Spirit is love, joy...')
    expect(fixedPane).toHaveTextContent('Count it all joy...')
  })
})
