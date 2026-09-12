import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPane } from './ChatPane'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useReadingPlanStore } from '@/store/useReadingPlanStore'
import { useDevotionalRotationStore } from '@/store/useDevotionalRotationStore'
import * as chatApi from '@/lib/chatApi'
import * as shareApi from '@/lib/shareApi'
import * as voiceModule from './useVoiceMode'

describe('ChatPane', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
    useReadingPlanStore.setState({ progress: null })
    useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
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
    vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({ type: 'chat', message: 'Sure, go ahead.' })

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

  it('lets the user compare every verse of a "verses"-type message in one fullscreen view', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'm1',
      role: 'assistant',
      text: 'One prominent example is Galatians 5:22. Others include James 1:2.',
      type: 'verses',
      data: {
        verses: [
          { reference: 'GAL 5:22', translations: { 'eng-KJV': 'But the fruit of the Spirit is love, joy...' } },
          { reference: 'JAS 1:2', translations: { 'eng-KJV': 'Count it all joy...' } },
        ],
      },
    })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /compare 2 verses/i }))

    const fixedPane = screen.getByRole('group', { name: /original view/i })
    expect(fixedPane).toHaveTextContent('But the fruit of the Spirit is love, joy...')
    expect(fixedPane).toHaveTextContent('Count it all joy...')
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
    const postChatStream = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({ type: 'chat', message: 'Second answer.' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /regenerate response/i }))

    expect(postChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'What is love?', mode: 'freeform' }),
      expect.anything()
    )
    expect(await screen.findByText('Second answer.')).toBeInTheDocument()
    expect(screen.queryByText('First answer.')).not.toBeInTheDocument()
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.messages).toHaveLength(2)
  })

  it('picking a choice pill finalizes modeParams, fetches the real response, and collapses the other options', async () => {
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
    expect(screen.queryByRole('button', { name: 'Canonical (book order)' })).not.toBeInTheDocument()
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
    vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({ type: 'chat', message: 'Sure, go ahead.' })

    render(<ChatPane sessionId={session.id} />)
    scrollIntoView.mockClear() // ignore the initial-render scroll; only care about growth from here

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'What is love?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await screen.findByText('Sure, go ahead.')

    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('shows a "thinking" indicator while a response is pending, then removes it', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    let resolvePost!: (value: Awaited<ReturnType<typeof chatApi.postChatStream>>) => void
    vi.spyOn(chatApi, 'postChatStream').mockImplementation(
      () => new Promise((resolve) => { resolvePost = resolve })
    )

    render(<ChatPane sessionId={session.id} />)
    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'What is grace?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(screen.getByRole('status', { name: /thinking/i })).toBeInTheDocument()

    resolvePost({ type: 'chat', message: 'Grace is unmerited favor.' })

    expect(await screen.findByText('Grace is unmerited favor.')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /thinking/i })).not.toBeInTheDocument()
  })

  it('stores the response trace on the assistant message', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({
      type: 'chat', message: 'answer',
      trace: { turnId: 'tt', requestPath: '/chat', steps: [], outcome: { type: 'chat', route: null, error: null } },
    } as never)

    render(<ChatPane sessionId={session.id} />)
    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'hello')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    const msgs = useSessionsStore.getState().sessions[session.id].messages
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.trace?.turnId).toBe('tt')
  })

  it('shows suggested starter chips when a freeform chat has no user turn yet, and sends one on click', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'u0', role: 'user', text: '💬 Ask Anything' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'a0', role: 'assistant', text: 'What would you like to explore?' })
    const postChatStream = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({ type: 'chat', message: 'Selah likely marks a musical pause.' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /what does .selah. mean/i }))

    expect(postChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'freeform', message: expect.stringMatching(/selah/i) }),
      expect.anything()
    )
    expect(await screen.findByText('Selah likely marks a musical pause.')).toBeInTheDocument()
    // Once a real question has been asked, the starters are gone.
    expect(screen.queryByRole('button', { name: /trace the theme of covenant/i })).not.toBeInTheDocument()
  })

  it('hides suggested starter chips once the user has sent a message', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'u0', role: 'user', text: '💬 Ask Anything' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'a0', role: 'assistant', text: 'What would you like to explore?' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: 'What is love?' })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.queryByRole('button', { name: /trace the theme of covenant/i })).not.toBeInTheDocument()
  })

  it('does not show starter chips for a guided mode that opens with its own choice pills', () => {
    const session = useSessionsStore.getState().createSession('reading_plan', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'u0', role: 'user', text: '📅 Bible in a Year' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'a0', role: 'assistant', text: 'Chronological or canonical?' })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.queryByText('Try asking…')).not.toBeInTheDocument()
  })

  it('renders follow-up question chips under the latest assistant message and sends one on click', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: 'What is grace?' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1',
      role: 'assistant',
      text: 'Grace is unmerited favour.',
      followUpQuestions: ['How is grace different from mercy?', 'Where does Paul discuss grace?'],
    })
    const postChatStream = vi
      .spyOn(chatApi, 'postChatStream')
      .mockResolvedValue({ type: 'chat', message: 'Mercy withholds punishment; grace gives blessing.' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'How is grace different from mercy?' }))

    expect(postChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'How is grace different from mercy?', mode: 'freeform' }),
      expect.anything()
    )
    expect(await screen.findByText('Mercy withholds punishment; grace gives blessing.')).toBeInTheDocument()
  })

  it('does not render follow-up chips under a superseded assistant message', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: 'q1' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1',
      role: 'assistant',
      text: 'first answer',
      followUpQuestions: ['stale follow-up'],
    })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u2', role: 'user', text: 'q2' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a2',
      role: 'assistant',
      text: 'second answer',
      followUpQuestions: ['fresh follow-up'],
    })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.queryByRole('button', { name: 'stale follow-up' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'fresh follow-up' })).toBeInTheDocument()
  })

  it('opens the report dialog from the header', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /report an issue/i }))
    expect(await screen.findByText(/report an issue with this chat/i)).toBeInTheDocument()
  })

  it('opens the Share dialog and shows a generated link', async () => {
    vi.spyOn(shareApi, 'createShare').mockResolvedValue({ token: 'tok', url: 'http://localhost/#import=tok' })
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'user', text: 'hi' })
    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /^share$/i }))
    expect(await screen.findByLabelText('Share link')).toHaveValue('http://localhost/#import=tok')
  })

  it('disables Share on an empty (zero-message) conversation', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByRole('button', { name: /^share$/i })).toBeDisabled()
  })

  it('shows the notes control in the header', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument()
  })

  function devotionalFinal() {
    return {
      type: 'verse',
      message: "Here's a devotional on **JHN 14:27**.",
      data: {
        reference: 'JHN 14:27',
        translations: { 'eng-KJV': 'Peace I leave with you...' },
        book_context: null,
        devotional: '# On Peace\n\nSome words.',
      },
      artifacts: [{
        type: 'devotional',
        label: 'Read the devotional ▸',
        params: { reference: 'JHN 14:27', text: '# On Peace\n\nSome words.' },
      }],
    }
  }

  it('auto-fires the devotional generation for a system-source session', async () => {
    const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: 'pick', choicesStatus: 'ready',
      choices: [{ label: "I'll choose", modeParams: { source: 'user' } }],
    })
    useSessionsStore.getState().appendMessage(session.id, { id: 'a2', role: 'assistant', text: 'Let me find a verse for you…' })

    const spy = vi.spyOn(chatApi, 'postChatStream').mockImplementation(async (_payload, handlers) => {
      handlers?.onChunk?.('LEAKED BODY TEXT')
      return devotionalFinal() as never
    })

    render(<ChatPane sessionId={session.id} />)

    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: '', mode: 'devotional', mode_params: expect.objectContaining({ source: 'system' }) }),
      expect.anything()
    )
    // body text streamed by the mock must NOT appear in the bubble
    expect(screen.queryByText('LEAKED BODY TEXT')).not.toBeInTheDocument()
    // the devotional link (artifact pill) is shown
    expect(screen.getByRole('button', { name: /read the devotional/i })).toBeInTheDocument()
    // delivered flag set
    expect(useSessionsStore.getState().sessions[session.id].modeParams.delivered).toBe(true)
  })

  it('rotates a status phrase next to the dots during the devotional generation wait', async () => {
    vi.useFakeTimers()
    try {
      const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
      useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
      useSessionsStore.getState().appendMessage(session.id, {
        id: 'a1', role: 'assistant', text: 'pick', choicesStatus: 'ready',
        choices: [{ label: "I'll choose", modeParams: { source: 'user' } }],
      })
      useSessionsStore.getState().appendMessage(session.id, { id: 'a2', role: 'assistant', text: 'Let me find a verse for you…' })
      // Never resolves — only the phrase rotation while pending is under test.
      vi.spyOn(chatApi, 'postChatStream').mockImplementation(() => new Promise(() => {}))

      render(<ChatPane sessionId={session.id} />)
      await act(async () => {})

      expect(screen.getByText('Finding a verse…')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(3000))
      expect(screen.getByText('Reading it over…')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(3000))
      expect(screen.getByText('Writing your devotional…')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(3000))
      expect(screen.getByText('Finding a verse…')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not auto-fire for a user-source session; the typed message is the generation', async () => {
    const session = useSessionsStore.getState().createSession('devotional', { source: 'user' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant',
      text: "Tell me a verse reference (e.g. John 3:16) or a theme (e.g. 'facing anxiety'), and I'll write you a devotional.",
    })
    const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)

    render(<ChatPane sessionId={session.id} />)
    expect(spy).not.toHaveBeenCalled()

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'Psalm 23')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Psalm 23', mode: 'devotional' }),
      expect.anything()
    )
    expect(useSessionsStore.getState().sessions[session.id].modeParams.delivered).toBe(true)
  })

  it('a system-source devotional sends rotation seed+cursor and advances the cursor', async () => {
    localStorage.clear()
    useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
    const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: 'Let me find a verse for you…',
    })

    const spy = vi.spyOn(chatApi, 'postChatStream').mockImplementation(async (_payload, handlers) => {
      handlers?.onChunk?.('')
      return devotionalFinal() as never
    })

    render(<ChatPane sessionId={session.id} />)
    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '',
        mode: 'devotional',
        mode_params: expect.objectContaining({
          source: 'system',
          rotationSeed: expect.any(Number),
          rotationCursor: 0,
        }),
      }),
      expect.anything()
    )
    expect(useDevotionalRotationStore.getState().cursor).toBe(1)
    // the slot is persisted on the session so an errored retry reuses it
    expect(useSessionsStore.getState().sessions[session.id].modeParams.rotationCursor).toBe(0)
  })

  it('a second system-source devotional uses the advanced cursor', async () => {
    localStorage.clear()
    useDevotionalRotationStore.setState({ seed: 12345, cursor: 1 })
    const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'a1', role: 'assistant', text: 'Let me find a verse for you…' })
    const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)

    render(<ChatPane sessionId={session.id} />)
    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode_params: expect.objectContaining({ rotationSeed: 12345, rotationCursor: 1 }),
      }),
      expect.anything()
    )
    expect(useDevotionalRotationStore.getState().cursor).toBe(2)
  })

  it('a user-source devotional sends no rotation params', async () => {
    localStorage.clear()
    useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
    const session = useSessionsStore.getState().createSession('devotional', { source: 'user' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'p', role: 'assistant',
      text: "Tell me a verse reference (e.g. John 3:16) or a theme (e.g. 'facing anxiety'), and I'll write you a devotional.",
    })
    const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)

    render(<ChatPane sessionId={session.id} />)
    const input = screen.getByPlaceholderText(/verse|theme|Ask/i)
    fireEvent.change(input, { target: { value: 'Psalm 23' } })
    fireEvent.submit(input.closest('form')!)

    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()
    const payload = spy.mock.calls[0][0] as { mode_params?: Record<string, unknown> }
    expect(payload.mode_params).not.toHaveProperty('rotationSeed')
    expect(payload.mode_params).not.toHaveProperty('rotationCursor')
    expect(useDevotionalRotationStore.getState().cursor).toBe(0)
  })

  it('errored first turn keeps the cursor + persists the slot; a successful re-fire advances exactly once', async () => {
    localStorage.clear()
    useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
    const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: 'Let me find a verse for you…',
    })

    // First auto-fire errors: `delivered` is not set and the store cursor
    // must NOT advance — but the (seed, cursor) slot is persisted on the
    // session so a retry reuses it instead of re-claiming a new one.
    const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)
    spy.mockResolvedValueOnce({ type: 'error', message: 'Sorry, the model is unavailable.' } as never)

    const { unmount } = render(<ChatPane sessionId={session.id} />)
    expect(await screen.findByText('the model is unavailable', { exact: false })).toBeInTheDocument()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(useDevotionalRotationStore.getState().cursor).toBe(0)
    const persistedSeed = useSessionsStore.getState().sessions[session.id].modeParams.rotationSeed
    expect(typeof persistedSeed).toBe('number')
    expect(useSessionsStore.getState().sessions[session.id].modeParams.rotationCursor).toBe(0)
    expect(useSessionsStore.getState().sessions[session.id].modeParams.delivered).toBeFalsy()

    // The auto-fire ref is per-mount, so a fresh ChatPane instance (a
    // remount, or another devotional session auto-firing) re-runs the
    // effect. `delivered` is still unset, so it re-fires runDevotionalTurn('').
    // This attempt succeeds.
    unmount()
    render(<ChatPane sessionId={session.id} />)
    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()

    // The retry reused the SAME slot (no re-injection) …
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: '',
        mode: 'devotional',
        mode_params: expect.objectContaining({
          rotationSeed: persistedSeed,
          rotationCursor: 0,
        }),
      }),
      expect.anything()
    )
    // … and the cursor advances exactly once for the delivered pick.
    expect(useDevotionalRotationStore.getState().cursor).toBe(1)
    expect(useSessionsStore.getState().sessions[session.id].modeParams.delivered).toBe(true)
  })

  it('auto-fires once for each session when the same ChatPane instance is reused (no key prop)', async () => {
    const makeSystemDevotionalSession = () => {
      const s = useSessionsStore.getState().createSession('devotional', { source: 'system' })
      useSessionsStore.getState().appendMessage(s.id, { id: `${s.id}-u1`, role: 'user', text: '📖 Devotional' })
      useSessionsStore.getState().appendMessage(s.id, {
        id: `${s.id}-a1`, role: 'assistant', text: 'pick', choicesStatus: 'ready',
        choices: [{ label: "I'll choose", modeParams: { source: 'user' } }],
      })
      useSessionsStore.getState().appendMessage(s.id, {
        id: `${s.id}-a2`, role: 'assistant', text: 'Let me find a verse for you…',
      })
      return s
    }
    const s1 = makeSystemDevotionalSession()
    const s2 = makeSystemDevotionalSession()
    const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)

    const { rerender } = render(<ChatPane sessionId={s1.id} />)
    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(1)

    // Switch sessions on the SAME mounted instance — the second
    // system-source devotional must still auto-fire.
    rerender(<ChatPane sessionId={s2.id} />)
    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(2)

    expect(useSessionsStore.getState().sessions[s1.id].modeParams.delivered).toBe(true)
    expect(useSessionsStore.getState().sessions[s2.id].modeParams.delivered).toBe(true)
  })

  it('does not render a Regenerate button on a delivered devotional message', () => {
    const session = useSessionsStore.getState().createSession('devotional', { source: 'user', delivered: true })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: "Here's a devotional on **JHN 14:27**.", type: 'verse',
      data: { reference: 'JHN 14:27', translations: { 'eng-KJV': 'Peace I leave with you...' } },
      artifacts: [{ type: 'devotional', label: 'Read the devotional ▸', params: { reference: 'JHN 14:27', text: '# d' } }],
    })

    render(<ChatPane sessionId={session.id} />)

    // Regenerate would replace the ~1,400-word devotional with a
    // one-paragraph chat answer, unrecoverably — it must not be offered.
    expect(screen.queryByRole('button', { name: /regenerate response/i })).not.toBeInTheDocument()
    // The devotional artifact pill is still there.
    expect(screen.getByRole('button', { name: /read the devotional/i })).toBeInTheDocument()
  })

  it('ignores a second form submit fired while a generation is already in flight (Enter bypasses the disabled Send button)', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    let resolvePost!: (value: Awaited<ReturnType<typeof chatApi.postChatStream>>) => void
    const spy = vi.spyOn(chatApi, 'postChatStream').mockImplementation(
      () => new Promise((resolve) => { resolvePost = resolve })
    )

    render(<ChatPane sessionId={session.id} />)
    const input = screen.getByPlaceholderText(/ask about a verse/i)
    const form = input.closest('form')!

    await userEvent.type(input, 'first question')
    fireEvent.submit(form) // first turn starts; loading = true
    await userEvent.type(input, 'second question')
    fireEvent.submit(form) // must be a no-op while the first turn is in flight

    expect(spy).toHaveBeenCalledTimes(1)
    resolvePost({ type: 'chat', message: 'done' })
    expect(await screen.findByText('done')).toBeInTheDocument()
  })

  it('after delivery, a follow-up is an ordinary streamed chat turn', async () => {
    const session = useSessionsStore.getState().createSession('devotional', { source: 'user', delivered: true })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: "Here's a devotional on **JHN 14:27**.", type: 'verse',
      data: { reference: 'JHN 14:27', translations: { 'eng-KJV': '...' } },
      artifacts: [{ type: 'devotional', label: 'Read the devotional ▸', params: { reference: 'JHN 14:27', text: '# d' } }],
    })
    const spy = vi.spyOn(chatApi, 'postChatStream').mockImplementation(async (_payload, handlers) => {
      handlers?.onChunk?.('streaming answer…')
      return { type: 'chat', message: 'The Greek word here is eirēnē.' } as never
    })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'what is the Greek word?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText('The Greek word here is eirēnē.')).toBeInTheDocument()
    // onChunk output IS rendered for a normal turn (devotional flag not set)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'what is the Greek word?', mode: 'devotional' }),
      expect.objectContaining({ onChunk: expect.any(Function) })
    )
  })

  it('renders a voice toggle that reflects the voice hook status', () => {
    vi.spyOn(voiceModule, 'useVoiceMode').mockReturnValue({
      status: 'listening',
      errorMessage: null,
      liveCaption: 'What does grace mean',
      toggle: vi.fn(),
      stop: vi.fn(),
      speak: vi.fn(),
    })
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    expect(screen.getByRole('button', { name: /listening/i })).toBeInTheDocument()
    expect(screen.getByText('What does grace mean')).toBeInTheDocument()
  })

  it('shows the voice error message as visible text, not only a hover tooltip', () => {
    vi.spyOn(voiceModule, 'useVoiceMode').mockReturnValue({
      status: 'error',
      errorMessage: 'Microphone permission was denied.',
      liveCaption: '',
      toggle: vi.fn(),
      stop: vi.fn(),
      speak: vi.fn(),
    })
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    // A `title` attribute never renders on a touch device (no hover state),
    // so the error must also appear as real text in the document.
    expect(screen.getByText('Microphone permission was denied.')).toBeInTheDocument()
  })

  it('speaks the resolved answer against the delegation id the transcript arrived with', async () => {
    const speak = vi.fn()
    let onTranscript: ((text: string, delegationId: string) => void) | undefined
    vi.spyOn(voiceModule, 'useVoiceMode').mockImplementation((opts) => {
      onTranscript = opts.onTranscript
      return { status: 'listening', errorMessage: null, liveCaption: '', toggle: vi.fn(), stop: vi.fn(), speak }
    })
    vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({ type: 'chat', message: 'Grace is unmerited favor.' })
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    await act(async () => {
      onTranscript?.('What does grace mean?', 'deleg_1')
    })

    expect(await screen.findByText('Grace is unmerited favor.')).toBeInTheDocument()
    expect(speak).toHaveBeenCalledWith('Grace is unmerited favor.', 'deleg_1')
  })

  it('stops the voice session when the sidebar switches to another conversation', () => {
    const stop = vi.fn()
    vi.spyOn(voiceModule, 'useVoiceMode').mockReturnValue({
      status: 'listening',
      errorMessage: null,
      liveCaption: '',
      toggle: vi.fn(),
      stop,
      speak: vi.fn(),
    })
    const s1 = useSessionsStore.getState().createSession('freeform', {})
    const s2 = useSessionsStore.getState().createSession('freeform', {})

    // No `key` in App.tsx, so this is the same mounted ChatPane (and the
    // same live WebRTC session) being pointed at a different conversation.
    const { rerender } = render(<ChatPane sessionId={s1.id} />)
    expect(stop).not.toHaveBeenCalled()

    rerender(<ChatPane sessionId={s2.id} />)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops the voice session on unmount', () => {
    const stop = vi.fn()
    vi.spyOn(voiceModule, 'useVoiceMode').mockReturnValue({
      status: 'listening',
      errorMessage: null,
      liveCaption: '',
      toggle: vi.fn(),
      stop,
      speak: vi.fn(),
    })
    const session = useSessionsStore.getState().createSession('freeform', {})
    const { unmount } = render(<ChatPane sessionId={session.id} />)

    unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('speaks a short hold-on message when a voice turn is dropped mid-generation, and still answers the first turn against its own delegation id', async () => {
    // Full-duplex: GPT-Live keeps listening while the previous answer is
    // generating, so a second utterance can hit sendMessage's `loading`
    // guard. It must not leave the hook stuck at 'thinking' — and the first
    // turn's answer must still be spoken against ITS delegation id, not the
    // dropped turn's.
    const speak = vi.fn()
    let onTranscript: ((text: string, delegationId: string) => void) | undefined
    vi.spyOn(voiceModule, 'useVoiceMode').mockImplementation((opts) => {
      onTranscript = opts.onTranscript
      return { status: 'listening', errorMessage: null, liveCaption: '', toggle: vi.fn(), stop: vi.fn(), speak }
    })
    let resolvePost!: (value: Awaited<ReturnType<typeof chatApi.postChatStream>>) => void
    const spy = vi.spyOn(chatApi, 'postChatStream').mockImplementation(
      () => new Promise((resolve) => { resolvePost = resolve })
    )
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    await act(async () => {
      onTranscript?.('Who wrote Psalm 23?', 'deleg_A')
    })
    expect(spy).toHaveBeenCalledTimes(1)

    await act(async () => {
      onTranscript?.('And who wrote Psalm 51?', 'deleg_B')
    })

    expect(spy).toHaveBeenCalledTimes(1) // the second turn was dropped …
    expect(speak).toHaveBeenCalledTimes(1) // … but not silently
    expect(speak).toHaveBeenCalledWith(expect.stringMatching(/one moment/i), 'deleg_B')

    await act(async () => {
      resolvePost({ type: 'chat', message: 'David wrote it.' })
    })

    expect(speak).toHaveBeenLastCalledWith('David wrote it.', 'deleg_A')
  })

  it('does not speak a typed turn that follows a dropped voice turn', async () => {
    // Regression: the "this turn was voice-originated" marker used to
    // survive an early return, so the *next* turn — even a typed one —
    // wrongly got spoken back.
    const speak = vi.fn()
    let onTranscript: ((text: string, delegationId: string) => void) | undefined
    vi.spyOn(voiceModule, 'useVoiceMode').mockImplementation((opts) => {
      onTranscript = opts.onTranscript
      return { status: 'listening', errorMessage: null, liveCaption: '', toggle: vi.fn(), stop: vi.fn(), speak }
    })
    let resolvePost!: (value: Awaited<ReturnType<typeof chatApi.postChatStream>>) => void
    vi.spyOn(chatApi, 'postChatStream').mockImplementation(
      () => new Promise((resolve) => { resolvePost = resolve })
    )
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    const input = screen.getByPlaceholderText(/ask about a verse/i)
    const form = input.closest('form')!
    fireEvent.change(input, { target: { value: 'a typed question' } })
    fireEvent.submit(form)

    // A voice utterance lands while the typed turn is still generating.
    await act(async () => {
      onTranscript?.('a dropped voice question', 'deleg_X')
    })
    expect(speak).toHaveBeenCalledWith(expect.stringMatching(/one moment/i), 'deleg_X')
    speak.mockClear()

    // The typed turn's own answer must not be spoken.
    await act(async () => {
      resolvePost({ type: 'chat', message: 'A typed answer.' })
    })
    expect(speak).not.toHaveBeenCalled()

    // Nor the next typed turn's.
    fireEvent.change(input, { target: { value: 'another typed question' } })
    fireEvent.submit(form)
    await act(async () => {
      resolvePost({ type: 'chat', message: 'Another typed answer.' })
    })
    expect(speak).not.toHaveBeenCalled()
  })

  it('does not leave the voice hook at "thinking" when a voice turn hits the devotional generation branch', async () => {
    const speak = vi.fn()
    let onTranscript: ((text: string, delegationId: string) => void) | undefined
    vi.spyOn(voiceModule, 'useVoiceMode').mockImplementation((opts) => {
      onTranscript = opts.onTranscript
      return { status: 'listening', errorMessage: null, liveCaption: '', toggle: vi.fn(), stop: vi.fn(), speak }
    })
    const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)
    const session = useSessionsStore.getState().createSession('devotional', { source: 'user' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'p', role: 'assistant', text: 'Tell me a verse reference or a theme.',
    })
    render(<ChatPane sessionId={session.id} />)

    await act(async () => {
      onTranscript?.('Psalm 23', 'deleg_D')
    })

    // The devotional still generates …
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Psalm 23', mode: 'devotional' }),
      expect.anything()
    )
    // … and the hook is told something rather than left hanging at 'thinking'.
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0][1]).toBe('deleg_D')
  })

  it('does not speak the answer for a normal typed turn', async () => {
    const speak = vi.fn()
    vi.spyOn(voiceModule, 'useVoiceMode').mockReturnValue({
      status: 'idle',
      errorMessage: null,
      liveCaption: '',
      toggle: vi.fn(),
      stop: vi.fn(),
      speak,
    })
    vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({ type: 'chat', message: 'Sure, go ahead.' })
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    await screen.findByText('Sure, go ahead.')
    expect(speak).not.toHaveBeenCalled()
  })
})
