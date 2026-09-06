import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VerseFullscreen } from './VerseFullscreen'
import * as chatApi from '@/lib/chatApi'
import { useVerseFontScaleStore } from '@/store/useVerseFontScaleStore'
import type { ExplorerResponse } from '@/types/api'

function fontRem(el: HTMLElement): number {
  return parseFloat(el.style.fontSize)
}

const interlinearFixture: ExplorerResponse = {
  verse: {
    id: 1, ref: 'John 11:35', bnum: 43, cnum: 11, vnum: 35, Ch: '', wordnum: 0, letternum: 0,
    total: 0, text1769: '', textAV1611: '',
    language: 'Greek', originalText: 'ἐδάκρυσεν ὁ Ἰησοῦς', stephanusText: null, stephanusTotal: null,
    lcFiles: [], hasQere: false, code: null, alert: null,
  },
  navigation: { previous: 1, next: 2 },
  kjvWords: [
    { kjvText: 'wept', strongsNumber: 'G1145', root: 'δακρύω', rootTranslit: 'dakryō', rootTranslit2: '', rootVal: 0 },
  ],
  originalWords: [],
  strongsDefinitions: {},
}

const baseProps = {
  reference: 'JHN 11:35',
  translations: {
    'eng-KJV': 'Jesus wept.',
    'eng-NIV': 'Jesus wept. (NIV)',
    'eng-ESV': 'Jesus wept. (ESV)',
  },
  initialTranslationCode: 'eng-KJV',
  open: true,
  onClose: () => {},
}

describe('VerseFullscreen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useVerseFontScaleStore.setState({ scale: 1 })
  })

  it('renders the fixed pane with the initial translation text and no switcher for it', () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    render(<VerseFullscreen {...baseProps} />)

    const fixedPane = screen.getByRole('group', { name: /original view/i })
    expect(fixedPane).toHaveTextContent('Jesus wept.')
    expect(fixedPane.querySelector('select')).toBeNull()
  })

  it('starts with one extra pane on Original language and loads the interlinear data', async () => {
    const spy = vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    render(<VerseFullscreen {...baseProps} />)

    expect(spy).toHaveBeenCalledWith('JHN 11:35')
    expect(await screen.findByText('ἐδάκρυσεν ὁ Ἰησοῦς')).toBeInTheDocument()
    expect(await screen.findByText('G1145')).toBeInTheDocument()
    const paneSelect = screen.getByLabelText(/pane 1 content/i) as HTMLSelectElement
    expect(paneSelect.value).toBe('__original-language__')
  })

  it('switches an extra pane to another translation', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    render(<VerseFullscreen {...baseProps} />)

    await userEvent.selectOptions(screen.getByLabelText(/pane 1 content/i), 'NIV')

    expect(screen.getByText('Jesus wept. (NIV)')).toBeInTheDocument()
  })

  it('adds a second comparison pane and then hides the add-pane button at three panes total', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    render(<VerseFullscreen {...baseProps} />)

    await userEvent.click(screen.getByRole('button', { name: /add pane/i }))

    expect(screen.getByLabelText(/pane 1 content/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/pane 2 content/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add pane/i })).not.toBeInTheDocument()
  })

  it('removes a comparison pane', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    render(<VerseFullscreen {...baseProps} />)

    await userEvent.click(screen.getByRole('button', { name: /remove pane 1/i }))

    expect(screen.queryByLabelText(/pane 1 content/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add pane/i })).toBeInTheDocument()
  })

  it('shows an error message in the original-language pane when the interlinear fetch fails', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockRejectedValue(new Error('network'))
    render(<VerseFullscreen {...baseProps} />)

    expect(await screen.findByText(/could not load the original language/i)).toBeInTheDocument()
  })

  it('calls onClose when the exit button is clicked', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    const onClose = vi.fn()
    render(<VerseFullscreen {...baseProps} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /exit fullscreen/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when open is false', () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    render(<VerseFullscreen {...baseProps} open={false} />)

    expect(screen.queryByRole('group', { name: /original view/i })).not.toBeInTheDocument()
  })

  it('enlarges and shrinks the pane text with the font-size controls', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    render(<VerseFullscreen {...baseProps} />)

    const verseText = screen.getByText('Jesus wept.')
    const base = fontRem(verseText)

    await userEvent.click(screen.getByRole('button', { name: /increase font size/i }))
    expect(fontRem(screen.getByText('Jesus wept.'))).toBeGreaterThan(base)

    await userEvent.click(screen.getByRole('button', { name: /decrease font size/i }))
    await userEvent.click(screen.getByRole('button', { name: /decrease font size/i }))
    expect(fontRem(screen.getByText('Jesus wept.'))).toBeLessThan(base)
  })

  it('starts at the font scale saved in the store', () => {
    useVerseFontScaleStore.setState({ scale: 1.3 })
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(interlinearFixture)
    render(<VerseFullscreen {...baseProps} />)

    const atScale1 = 0.875
    expect(fontRem(screen.getByText('Jesus wept.'))).toBeCloseTo(atScale1 * 1.3, 5)
  })
})
