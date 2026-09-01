import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPane } from './ChatPane'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useReadingPlanStore } from '@/store/useReadingPlanStore'
import * as chatApi from '@/lib/chatApi'

describe('ChatPane', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
    useReadingPlanStore.setState({ progress: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // jsdom doesn't implement scrollIntoView at all, so the auto-scroll
    // test above assigns a plain stub directly onto the prototype instead
    // of using vi.spyOn — clean it back up so it doesn't leak into other
    // test files.
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('renders existing messages and sends a new one on submit', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Ask me anything.' })
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Sure, go ahead.' })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByText('Ask me anything.')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'What is love?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText('Sure, go ahead.')).toBeInTheDocument()
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.messages).toHaveLength(3) // primer + user + assistant
    expect(updated.messages[1]).toMatchObject({ role: 'user', text: 'What is love?' })
  })

  it('renders markdown bold spans and paragraph breaks in assistant messages', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'This is **bold** text.\n\nA second paragraph.',
    })

    render(<ChatPane sessionId={session.id} />)

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('A second paragraph.')).toBeInTheDocument()
  })

  it('clicking a verse reference linked in chat text opens the interlinear artifact', async () => {
    const session = useSessionsStore.getState().createSession('topic', {
      seriesId: 'present-day-ministry-of-jesus',
      conceptSlug: 'grace',
    })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'Grow in grace (see [2 Pet 3:18](/explorer?reference=2PE%203%3A18)).',
    })
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue({} as never)

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('link', { name: '2 Pet 3:18' }))

    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: '2 Pet 3:18 ▸',
      params: { reference: '2PE 3:18' },
    })
  })

  it('clicking an artifact link opens it in the artifact store', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'Here is John 3:16.',
      artifacts: [{ type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } }],
    })
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /strong's/i }))

    expect(useArtifactStore.getState().activeArtifact).toEqual({ type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } })
  })

  it('renders a VerseBubble with translation text for a verse-type message', () => {
    const session = useSessionsStore.getState().createSession('verse', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'Here is **JHN 3:16**.',
      type: 'verse',
      data: { reference: 'JHN 3:16', translations: { 'eng-KJV': 'For God so loved the world...' } },
    })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByText('For God so loved the world...')).toBeInTheDocument()
  })

  it('renders a boxed VerseBubble for every verse in a "verses"-type message, not just the first', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'One prominent example is Galatians 5:22. Others include James 1:2 and Romans 15:13.',
      type: 'verses',
      data: {
        verses: [
          { reference: 'GAL 5:22', translations: { 'eng-KJV': 'But the fruit of the Spirit is love, joy...' } },
          { reference: 'JAS 1:2', translations: { 'eng-KJV': 'Count it all joy...' } },
          { reference: 'ROM 15:13', translations: { 'eng-KJV': 'Now the God of hope fill you...' } },
        ],
      },
    })

    render(<ChatPane sessionId={session.id} />)

    expect(screen.getByText('But the fruit of the Spirit is love, joy...')).toBeInTheDocument()
    expect(screen.getByText('Count it all joy...')).toBeInTheDocument()
    expect(screen.getByText('Now the God of hope fill you...')).toBeInTheDocument()
    expect(screen.getByText('GAL 5:22')).toBeInTheDocument()
    expect(screen.getByText('JAS 1:2')).toBeInTheDocument()
    expect(screen.getByText('ROM 15:13')).toBeInTheDocument()
  })

  it('renders a StrongsBubble with word data for a strongs-type message', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: "Here is the Strong's entry.",
      type: 'strongs',
      data: { words: { G0025: { lemma: 'ἀγαπάω', definition: 'to love' } } },
    })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByText('G0025')).toBeInTheDocument()
    expect(screen.getByText('to love')).toBeInTheDocument()
  })

  it('shows a "Mark day complete" action for reading_plan sessions', () => {
    const session = useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 0, completedDays: [] })
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Day 1 reading' })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByRole('button', { name: /mark day complete/i })).toBeInTheDocument()
  })

  it('marking a day complete advances dayIndex, records it, and appends the next day\'s reading', async () => {
    const session = useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 2, completedDays: [0, 1] })
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Day 3 reading' })
    const postChat = vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat',
      message: 'Day 4 — Chronological Reading Plan',
      artifacts: [{ type: 'chapter', label: 'Read JOB 4 ▸', params: { reference: 'JOB 4' } }],
    })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /mark day complete/i }))

    expect(postChat).toHaveBeenCalledWith({
      message: '',
      mode: 'reading_plan',
      mode_params: { plan: 'chronological', dayIndex: 3, completedDays: [0, 1, 2] },
    })
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.modeParams.completedDays).toEqual([0, 1, 2])
    expect(updated.modeParams.dayIndex).toBe(3)
    expect(await screen.findByText('Day 4 — Chronological Reading Plan')).toBeInTheDocument()
    // The advance is mirrored into cross-session progress so reopening
    // "Bible in a Year" later picks up on day 4, not day 3 again.
    expect(useReadingPlanStore.getState().progress).toEqual({
      plan: 'chronological',
      dayIndex: 3,
      completedDays: [0, 1, 2],
    })
  })

  it('shows the session title and mode badge in a header', () => {
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'The Prodigal Son' })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByText('Parable Study — prodigal son')).toBeInTheDocument()
    expect(screen.getByText('Parable Study')).toBeInTheDocument()
  })

  it('copying a response writes its text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'For God so loved the world.' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /copy response/i }))

    expect(writeText).toHaveBeenCalledWith('For God so loved the world.')
  })

  it('regenerating the last response replaces it rather than appending a duplicate', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: 'What is love?' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'a1', role: 'assistant', text: 'First answer.' })
    const postChat = vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Second answer.' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /regenerate response/i }))

    expect(postChat).toHaveBeenCalledWith(expect.objectContaining({ message: 'What is love?', mode: 'freeform' }))
    expect(await screen.findByText('Second answer.')).toBeInTheDocument()
    expect(screen.queryByText('First answer.')).not.toBeInTheDocument()
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.messages).toHaveLength(2)
  })

  it('picking a choice pill finalizes modeParams and fetches the real response, disabling the other option', async () => {
    const session = useSessionsStore.getState().createSession('reading_plan', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📅 Bible in a Year' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'prompt',
      role: 'assistant',
      text: 'Chronological or canonical?',
      choicesStatus: 'ready',
      choices: [
        { label: 'Chronological', modeParams: { plan: 'chronological', dayIndex: 0, completedDays: [] } },
        { label: 'Canonical (book order)', modeParams: { plan: 'canonical', dayIndex: 0, completedDays: [] } },
      ],
    })
    const postChat = vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Day 1 — Genesis 1' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Chronological' }))

    expect(postChat).toHaveBeenCalledWith({
      message: '',
      mode: 'reading_plan',
      mode_params: { plan: 'chronological', dayIndex: 0, completedDays: [] },
    })
    expect(await screen.findByText('Day 1 — Genesis 1')).toBeInTheDocument()
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.modeParams).toEqual({ plan: 'chronological', dayIndex: 0, completedDays: [] })
    expect(screen.getByRole('button', { name: 'Chronological' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Canonical (book order)' })).toBeDisabled()
    // The plan choice is remembered across sessions too, so reopening
    // "Bible in a Year" later doesn't ask again.
    expect(useReadingPlanStore.getState().progress).toEqual({
      plan: 'chronological',
      dayIndex: 0,
      completedDays: [],
    })
  })

  it('resolving a series choice renders concept pills instead of a plain message', async () => {
    const session = useSessionsStore.getState().createSession('topic', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'prompt-1',
      role: 'assistant',
      text: 'Which series?',
      choicesStatus: 'ready',
      choices: [{ label: 'The Present-Day Ministry of Jesus — Joseph Prince', modeParams: { seriesId: 'present-day-ministry-of-jesus' } }],
    })
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat',
      message: 'Here are the concepts...',
      data: {
        series_id: 'present-day-ministry-of-jesus',
        concepts: [
          { slug: 'grace', title: 'Grace' },
          { slug: 'holiness', title: 'Holiness' },
        ],
      },
    })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /The Present-Day Ministry of Jesus/ }))

    expect(await screen.findByRole('button', { name: 'Grace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Holiness' })).toBeInTheDocument()
  })

  it('retrying a failed choice prompt re-fetches parables', async () => {
    const session = useSessionsStore.getState().createSession('parable', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '🌿 Parable Study' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'prompt',
      role: 'assistant',
      text: 'Which parable?',
      choicesStatus: 'error',
      choicesError: 'Network error',
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ parables: [{ id: 'sower', name: 'The Sower', reference: 'Matthew 13:1-23' }] }),
    } as Response)

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('button', { name: /the sower/i })).toBeInTheDocument()
  })

  it('keeps each artifact next to its own book_context link instead of scattering them into separate rows', async () => {
    vi.spyOn(chatApi, 'fetchChapter').mockResolvedValue({
      book: '1 Peter',
      chapter: 1,
      verseCount: 2,
      verses: [
        { versenumber: 30000, vnum: 15, ref: '1 Peter 1:15', translations: { 'eng-KJV': 'But as he which hath called you is holy.' } },
        { versenumber: 30001, vnum: 16, ref: '1 Peter 1:16', translations: { 'eng-KJV': 'Because it is written, Be ye holy.' } },
      ],
    })
    const session = useSessionsStore.getState().createSession('topic', { conceptSlug: 'holiness' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'Topical Study: Biblical Holiness',
      artifacts: [
        { type: 'interlinear', label: 'Read Leviticus 19:2 ▸', params: { reference: 'Leviticus 19:2' } },
        { type: 'chapter', label: 'Read 1 Peter 1:15-16 ▸', params: { reference: '1 Peter 1:15-16' } },
        { type: 'book_context', label: '1 Peter — Book Context ▸', params: { book: '1PE' } },
        { type: 'interlinear', label: 'Read Hebrews 12:14 ▸', params: { reference: 'Hebrews 12:14' } },
        { type: 'book_context', label: 'Hebrews — Book Context ▸', params: { book: 'HEB' } },
      ],
    })

    render(<ChatPane sessionId={session.id} />)

    // The chapter reading link (nested one div deeper, inside
    // ChapterReadingBubble's own wrapper) shares its row with its own
    // book-context pill.
    const chapterButton = screen.getByRole('button', { name: /read 1 peter 1:15-16/i })
    const chapterRow = chapterButton.closest('div')!.parentElement!
    expect(within(chapterRow).getByRole('button', { name: /1 peter — book context/i })).toBeInTheDocument()

    // Hebrews (a plain pill) shares its row with its own book-context pill.
    const hebrewsButton = screen.getByRole('button', { name: /read hebrews 12:14/i })
    const hebrewsRow = hebrewsButton.closest('div')!
    expect(within(hebrewsRow).getByRole('button', { name: /hebrews — book context/i })).toBeInTheDocument()

    // Leviticus has no curated book context — its row shouldn't pick up
    // one of the others' pills.
    const leviticusButton = screen.getByRole('button', { name: /read leviticus 19:2/i })
    const leviticusRow = leviticusButton.closest('div')!
    expect(within(leviticusRow).queryByRole('button', { name: /book context/i })).not.toBeInTheDocument()
  })

  it('renders back-to-back book_context artifacts (no reading link between them) as independent pills', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'Here are a few verses.',
      type: 'verses',
      data: { verses: [{ reference: 'GAL 5:22', translations: { 'eng-KJV': '...' } }] },
      artifacts: [
        { type: 'book_context', label: 'Galatians — Book Context ▸', params: { book: 'GAL' } },
        { type: 'book_context', label: 'James — Book Context ▸', params: { book: 'JAS' } },
      ],
    })

    render(<ChatPane sessionId={session.id} />)

    expect(screen.getByRole('button', { name: /galatians — book context/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /james — book context/i })).toBeInTheDocument()
  })

  it('scrolls to the latest message as the conversation grows', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Ask me anything.' })
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Sure, go ahead.' })

    render(<ChatPane sessionId={session.id} />)
    scrollIntoView.mockClear() // ignore the initial-render scroll; only care about growth from here

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'What is love?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await screen.findByText('Sure, go ahead.')

    expect(scrollIntoView).toHaveBeenCalled()
  })
})
