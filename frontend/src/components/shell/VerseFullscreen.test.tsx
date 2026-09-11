import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VerseFullscreen } from './VerseFullscreen'
import * as chatApi from '@/lib/chatApi'
import { useVerseFontScaleStore } from '@/store/useVerseFontScaleStore'
import type { ExplorerResponse } from '@/types/api'

function fontRem(el: HTMLElement): number {
  return parseFloat(el.style.fontSize)
}

function setTop(el: Element, top: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top,
    toJSON: () => {},
  } as DOMRect)
}

function interlinearFixture(ref: string, vnum: number, originalText: string, kjvText: string, strongsNumber: string): ExplorerResponse {
  return {
    verse: {
      id: vnum, ref, bnum: 43, cnum: 11, vnum, Ch: '', wordnum: 0, letternum: 0,
      total: 0, text1769: '', textAV1611: '',
      language: 'Greek', originalText, stephanusText: null, stephanusTotal: null,
      lcFiles: [], hasQere: false, code: null, alert: null,
    },
    navigation: { previous: vnum - 1, next: vnum + 1 },
    kjvWords: [
      { kjvText, strongsNumber, root: '', rootTranslit: '', rootTranslit2: '', rootVal: 0 },
    ],
    originalWords: [],
    strongsDefinitions: {},
  }
}

const versoFixture = interlinearFixture('John 11:35', 35, 'ἐδάκρυσεν ὁ Ἰησοῦς', 'wept', 'G1145')
const nextVerseFixture = interlinearFixture('John 11:36', 36, 'ἔλεγον οὖν οἱ Ἰουδαῖοι', 'said', 'G3767')

const baseProps = {
  verses: [
    {
      reference: 'JHN 11:35',
      translations: {
        'eng-KJV': 'Jesus wept.',
        'eng-NIV': 'Jesus wept. (NIV)',
        'eng-ESV': 'Jesus wept. (ESV)',
      },
    },
  ],
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
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
    render(<VerseFullscreen {...baseProps} />)

    const fixedPane = screen.getByRole('group', { name: /original view/i })
    expect(fixedPane).toHaveTextContent('Jesus wept.')
    expect(fixedPane.querySelector('select')).toBeNull()
  })

  it('starts with one extra pane on Original language and loads the interlinear data', async () => {
    const spy = vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
    render(<VerseFullscreen {...baseProps} />)

    expect(spy).toHaveBeenCalledWith('JHN 11:35')
    expect(await screen.findByText('ἐδάκρυσεν ὁ Ἰησοῦς')).toBeInTheDocument()
    expect(await screen.findByText('G1145')).toBeInTheDocument()
    const paneSelect = screen.getByLabelText(/pane 1 content/i) as HTMLSelectElement
    expect(paneSelect.value).toBe('__original-language__')
  })

  it('switches an extra pane to another translation', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
    render(<VerseFullscreen {...baseProps} />)

    await userEvent.selectOptions(screen.getByLabelText(/pane 1 content/i), 'NIV')

    expect(screen.getByText('Jesus wept. (NIV)')).toBeInTheDocument()
  })

  it('adds a second comparison pane and then hides the add-pane button at three panes total', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
    render(<VerseFullscreen {...baseProps} />)

    await userEvent.click(screen.getByRole('button', { name: /add pane/i }))

    expect(screen.getByLabelText(/pane 1 content/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/pane 2 content/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add pane/i })).not.toBeInTheDocument()
  })

  it('removes a comparison pane', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
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
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
    const onClose = vi.fn()
    render(<VerseFullscreen {...baseProps} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /exit fullscreen/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when open is false', () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
    render(<VerseFullscreen {...baseProps} open={false} />)

    expect(screen.queryByRole('group', { name: /original view/i })).not.toBeInTheDocument()
  })

  it('enlarges and shrinks the pane text with the font-size controls', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
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
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
    render(<VerseFullscreen {...baseProps} />)

    const atScale1 = 0.875
    expect(fontRem(screen.getByText('Jesus wept.'))).toBeCloseTo(atScale1 * 1.3, 5)
  })

  describe('with more than one verse', () => {
    const multiProps = {
      verses: [
        { reference: 'JHN 11:35', translations: { 'eng-KJV': 'Jesus wept.', 'eng-NIV': 'Jesus wept. (NIV)' } },
        { reference: 'JHN 11:36', translations: { 'eng-KJV': 'Then said the Jews.', 'eng-NIV': 'Then said the Jews. (NIV)' } },
      ],
      initialTranslationCode: 'eng-KJV',
      open: true,
      onClose: () => {},
    }

    it('shows every verse in the fixed pane, each labeled with its own reference', () => {
      vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
      render(<VerseFullscreen {...multiProps} />)

      const fixedPane = screen.getByRole('group', { name: /original view/i })
      expect(fixedPane).toHaveTextContent('JHN 11:35')
      expect(fixedPane).toHaveTextContent('Jesus wept.')
      expect(fixedPane).toHaveTextContent('JHN 11:36')
      expect(fixedPane).toHaveTextContent('Then said the Jews.')
    })

    it('shows the verse count and reference range in the dialog title', () => {
      vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
      render(<VerseFullscreen {...multiProps} />)

      const title = screen.getByText(/2 verses/i)
      expect(title).toHaveTextContent('JHN 11:35')
      expect(title).toHaveTextContent('JHN 11:36')
    })

    it('fetches the original language for every verse and stacks them with reference headings', async () => {
      const spy = vi.spyOn(chatApi, 'fetchInterlinear').mockImplementation((ref: string) =>
        ref === 'JHN 11:36' ? Promise.resolve(nextVerseFixture) : Promise.resolve(versoFixture)
      )
      render(<VerseFullscreen {...multiProps} />)

      expect(spy).toHaveBeenCalledWith('JHN 11:35')
      expect(spy).toHaveBeenCalledWith('JHN 11:36')
      expect(await screen.findByText('ἐδάκρυσεν ὁ Ἰησοῦς')).toBeInTheDocument()
      expect(await screen.findByText('ἔλεγον οὖν οἱ Ἰουδαῖοι')).toBeInTheDocument()
    })

    it('switching an extra pane to another translation shows every verse in that translation', async () => {
      vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
      render(<VerseFullscreen {...multiProps} />)

      await userEvent.selectOptions(screen.getByLabelText(/pane 1 content/i), 'NIV')

      expect(screen.getByText('Jesus wept. (NIV)')).toBeInTheDocument()
      expect(screen.getByText('Then said the Jews. (NIV)')).toBeInTheDocument()
    })

    it('shows a sync-scroll checkbox, checked by default', () => {
      vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
      render(<VerseFullscreen {...multiProps} />)

      const checkbox = screen.getByRole('checkbox', { name: /sync scroll/i }) as HTMLInputElement
      expect(checkbox.checked).toBe(true)
    })

    it('scrolls every other pane so the same verse lands at the top, when one pane scrolls', () => {
      vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
      render(<VerseFullscreen {...multiProps} />)

      const mainPane = screen.getByRole('group', { name: /original view/i })
      const extraPane = screen.getByRole('group', { name: /comparison pane 1/i })
      setTop(mainPane, 0)
      setTop(extraPane, 0)

      // Main pane has scrolled so verse index 1 (JHN 11:36) sits at the top.
      setTop(mainPane.querySelector('[data-verse-idx="0"]')!, -50)
      setTop(mainPane.querySelector('[data-verse-idx="1"]')!, 0)
      // The extra pane hasn't scrolled yet — its own verse index 1 row is
      // further down, at a different offset than the main pane's (its rows
      // are a different height).
      setTop(extraPane.querySelector('[data-verse-idx="0"]')!, 0)
      setTop(extraPane.querySelector('[data-verse-idx="1"]')!, 150)

      fireEvent.scroll(mainPane)

      expect(extraPane.scrollTop).toBe(150)
    })

    it('does not sync other panes when sync scroll is turned off', async () => {
      vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
      render(<VerseFullscreen {...multiProps} />)

      await userEvent.click(screen.getByRole('checkbox', { name: /sync scroll/i }))

      const mainPane = screen.getByRole('group', { name: /original view/i })
      const extraPane = screen.getByRole('group', { name: /comparison pane 1/i })
      setTop(mainPane, 0)
      setTop(extraPane, 0)
      setTop(mainPane.querySelector('[data-verse-idx="0"]')!, -50)
      setTop(mainPane.querySelector('[data-verse-idx="1"]')!, 0)
      setTop(extraPane.querySelector('[data-verse-idx="0"]')!, 0)
      setTop(extraPane.querySelector('[data-verse-idx="1"]')!, 150)

      fireEvent.scroll(mainPane)

      expect(extraPane.scrollTop).toBe(0)
    })
  })

  it('does not show the sync-scroll checkbox for a single verse', () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(versoFixture)
    render(<VerseFullscreen {...baseProps} />)

    expect(screen.queryByRole('checkbox', { name: /sync scroll/i })).not.toBeInTheDocument()
  })
})
