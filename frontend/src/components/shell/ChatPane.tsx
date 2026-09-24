import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, AudioLines, CalendarDays, Check, Copy, Flag, Loader2, Mic, RefreshCw, Share2, Wand2 } from 'lucide-react'
import { postChat, postChatStream } from '@/lib/chatApi'
import { listParables, listStudyWikis } from '@/lib/modeData'
import { renderMarkdown } from '@/lib/renderMarkdown'
import { toHistory } from '@/lib/history'
import { startTellAStory, deriveStoryThemes, MAX_STORY_SOURCE_MESSAGES } from '@/lib/tellAStory'
import { ThemePicker, type StoryAgeRange } from './ThemePicker'
import { useArtifactStore } from '@/store/useArtifactStore'
import { MODE_LABELS, useSessionsStore } from '@/store/useSessionsStore'
import { useReadingPlanStore } from '@/store/useReadingPlanStore'
import { useDevotionalRotationStore } from '@/store/useDevotionalRotationStore'
import { useVoiceSettingsStore } from '@/store/useVoiceSettingsStore'
import { VerseBubble, type VerseBubbleData } from './VerseBubble'
import { VerseGroupBubble } from './VerseGroupBubble'
import { StrongsBubble } from './StrongsBubble'
import { StudyBubble } from './StudyBubble'
import { ChapterReadingBubble } from './ChapterReadingBubble'
import { PhaseList } from '@/components/chatbot/PhaseList'
import { PassageVerseBox } from '@/components/chatbot/PassageVerseBox'
import { PromptChips } from './PromptChips'
import { ChatNotesMenu } from './ChatNotesMenu'
import { ReportIssueDialog } from './ReportIssueDialog'
import { ShareDialog } from './ShareDialog'
import { useVoiceMode, type UseVoiceModeResult } from './useVoiceMode'
import { SUGGESTED_PROMPTS } from '@/lib/suggestedPrompts'
import type { ArtifactLink, MessageChoice, SessionMessage, PhaseResult } from '@/types/session'

interface Props {
  sessionId: string
  onNavigateToSession?: (id: string) => void
}

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Socratic mode's passage reference is essential session state established
// once (by the primer's random pick, or a message naming a new passage) —
// unlike other modes, later turns' own text rarely repeats it, so once the
// turn that named it scrolls out of the 6-message history window sent to
// the backend, the passage is unrecoverable there. Every socratic response
// carries the reference it settled on in `data.reference`, so persist it
// into modeParams here rather than relying on the backend to rediscover it
// from a truncated history each time.
function socraticReference(data: unknown): string | undefined {
  return (data as { reference?: string | null } | undefined)?.reference ?? undefined
}

type HermeneuticsPatch = { reference?: string; runDigest?: string; scopeChapter?: string }

// Deep Study persists the resolved passage and the run digest into
// modeParams, so a later turn is answered from the completed run instead of
// re-running the eight phases.
//
// The session reference is only ever taken from a completed run (it carries
// a digest) or the mode primer. A claim redirect, a "which part?" narrowing
// reply or a no-text reply may mention a passage, but the user never chose
// it — adopting it would make their next, unrelated message run it.
//
// `scopeChapter` (the chapter a narrowing reply asked the user to pick
// from) lives for exactly one turn, so "verses 1-5" can be read against it;
// every other reply clears it.
function hermeneuticsParams(data: unknown, opts: { fromPrimer?: boolean } = {}): HermeneuticsPatch {
  const d = data as { reference?: string; runDigest?: string; scopeChapter?: string } | null | undefined
  const patch: HermeneuticsPatch = { scopeChapter: d?.scopeChapter || undefined }
  if (d?.reference && (d.runDigest || opts.fromPrimer)) patch.reference = d.reference
  // Only a fresh run returns a digest; a follow-up turn returns none, and
  // must not clear the one the session already holds.
  if (d?.runDigest) patch.runDigest = d.runDigest
  return patch
}

const ARTIFACT_PILL =
  'text-xs px-2 py-1 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]'

// Both reading orders (chronological, canonical) are always distributed
// across exactly 365 days — see _DAYS in chatbot/data/reading_plans.py.
const READING_PLAN_TOTAL_DAYS = 365

// The devotional generation call has no incremental progress to report (see
// the streamAssistantReply comment on why its SSE chunks never reach the
// bubble), so these rotate on a client-side timer purely to keep the
// multi-second wait from reading as frozen.
const DEVOTIONAL_STATUS_PHRASES = ['Finding a verse…', 'Reading it over…', 'Writing your devotional…']

// Tell a Story's theme-derivation primer is a single LLM call (up to 120s,
// see STORY_LLM_TIMEOUT_SECONDS) with no intermediate progress of its own —
// unlike devotional generation, one static phrase is enough to say "this is
// working," not frozen.
const TELLING_STORY_STATUS = 'Reading the conversation for themes…'

const VOICE_STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
}

interface ArtifactGroup {
  primary: ArtifactLink
  bookContext?: ArtifactLink
}

/** Pairs each primary artifact (a "Read X" link) with its "book_context"
 * link, if one immediately follows it — the backend always emits a
 * book_context link right after the reference it belongs to (see
 * _reading_artifacts() in chatbot/router.py), so adjacency in the array is
 * what ties the two together. Without this, splitting artifacts into flat
 * "all pills" / "all chapter links" rows (the previous approach) scatters
 * a reference's own book-context pill away from its reading link whenever
 * a message mixes single-verse and passage-range references, like Topical
 * Study's seed list. */
function groupArtifacts(artifacts: ArtifactLink[]): ArtifactGroup[] {
  const groups: ArtifactGroup[] = []
  for (const link of artifacts) {
    const last = groups[groups.length - 1]
    // Only pair a book_context onto a real reading link, never onto
    // another book_context — a message with several boxed verses (e.g. the
    // AI fallback citing more than one) can emit several book_context
    // pills back to back with nothing else between them, and without this
    // check the second would wrongly swallow into the first's group.
    if (link.type === 'book_context' && last && last.primary.type !== 'book_context' && !last.bookContext) {
      last.bookContext = link
    } else {
      groups.push({ primary: link })
    }
  }
  return groups
}

export function ChatPane({ sessionId, onNavigateToSession }: Props) {
  const session = useSessionsStore((s) => s.sessions[sessionId])
  const createSession = useSessionsStore((s) => s.createSession)
  const appendMessage = useSessionsStore((s) => s.appendMessage)
  const updateMessage = useSessionsStore((s) => s.updateMessage)
  const updateModeParams = useSessionsStore((s) => s.updateModeParams)
  const truncateMessagesFrom = useSessionsStore((s) => s.truncateMessagesFrom)
  const setReadingPlanProgress = useReadingPlanStore((s) => s.setProgress)
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [markingComplete, setMarkingComplete] = useState(false)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [resolvingChoiceId, setResolvingChoiceId] = useState<string | null>(null)
  const [tellingStory, setTellingStory] = useState(false)
  const [storySubmitting, setStorySubmitting] = useState(false)
  // Which theme-derivation message (by id) is currently being retried —
  // null when none is. Keyed by message id (not a bare boolean) since a
  // session can only ever have one live derivation prompt, but this keeps
  // the retry button's own loading state scoped to that message.
  const [storyThemesRetrying, setStoryThemesRetrying] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Set by the voice hook's onTranscript immediately before it calls
  // sendMessage, and consumed (and cleared) at the very top of sendMessage.
  // Non-null means "this turn came from speech"; `delegationId` is the id
  // that turn's transcript actually arrived with, carried explicitly
  // because the hook's own notion of "current delegation" can be
  // superseded by a later utterance before this turn's answer is ready.
  // Kept as one object so the flag and the id can never drift apart.
  const pendingVoiceTurnRef = useRef<{ delegationId: string } | null>(null)
  const voiceModeRef = useRef<UseVoiceModeResult | null>(null)
  // Which session the devotional generation has already auto-fired for.
  // A single <ChatPane> instance is reused across sessions (no `key` in
  // App.tsx), so this must be keyed by session id, not a bare boolean —
  // otherwise a second system-source devotional opened from the sidebar
  // never auto-fires.
  const devotionalAutoFired = useRef<string | null>(null)

  // Any in-flight backend round-trip that leaves the message area idle —
  // a new question, a regenerate, a choice being resolved, a day being
  // marked complete, or a "Tell a Story" trigger reading this conversation
  // for themes. Drives the "thinking" indicator — without it, that last
  // case in particular (an up-to-120s LLM call with no other UI change
  // until the new story session is ready) reads as the app hanging.
  const isBusy = loading || !!regeneratingId || !!resolvingChoiceId || markingComplete || tellingStory

  // Only the devotional generation leg of `isBusy` runs long enough (~10s+)
  // that the plain dots read as frozen — narrow the rotating status text to
  // that case so a quick regenerate/mark-complete doesn't flash a phrase.
  const devotionalPending = loading && session?.mode === 'devotional' && !session.modeParams.delivered
  const [devotionalStatusIndex, setDevotionalStatusIndex] = useState(0)
  useEffect(() => {
    if (!devotionalPending) {
      setDevotionalStatusIndex(0)
      return
    }
    const interval = setInterval(() => {
      setDevotionalStatusIndex((i) => (i + 1) % DEVOTIONAL_STATUS_PHRASES.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [devotionalPending])

  // Keep the latest message in view as the conversation grows — a new
  // message, a choice prompt resolving, or its options finishing a fetch
  // all change the messages array and should pull the view down to it.
  // `isBusy` is included so the view also follows the thinking indicator
  // as it appears and disappears.
  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [session?.messages, isBusy])

  // Streams an assistant reply into place: the message isn't created until
  // the first token chunk lands, so a turn that never streams at all (a
  // deterministic match, a mode primer, Topical Study's wiki Q&A — none of
  // those involve a live LLM generation) still just pops in complete, the
  // same as the old plain postChat() flow.
  const streamAssistantReply = useCallback(
    async (
      assistantId: string,
      payload: Parameters<typeof postChatStream>[0],
      opts?: { devotional?: boolean; openAiApiKey?: string }
    ) => {
      let started = false
      const put = (patch: Partial<SessionMessage>) => {
        if (!started) {
          started = true
          appendMessage(sessionId, { id: assistantId, role: 'assistant', text: '', ...patch })
        } else {
          updateMessage(sessionId, assistantId, patch)
        }
      }
      try {
        // A devotional generating turn streams over SSE only to keep the
        // connection alive through a multi-minute generation — the body
        // text must not land in the chat bubble (it opens from a link in
        // the artifact pane). So no onChunk: the message is created once,
        // complete, from the final payload; the typing indicator covers
        // the wait.
        // Only pass a third argument at all when there's an override key —
        // an explicit `undefined` is still an argument, and tests/mocks
        // elsewhere assert postChatStream's exact call shape for the
        // (far more common) non-voice-override path.
        const collected: PhaseResult[] = []
        const handlers = opts?.devotional
          ? {}
          : {
              onChunk: (text: string) => put({ text }),
              onPhase: (phase: PhaseResult) => {
                collected.push(phase)
                put({ phases: [...collected] })
              },
              onPassage: (reference: string) => put({ passageReference: reference }),
            }
        const response = opts?.openAiApiKey
          ? await postChatStream(payload, handlers, opts.openAiApiKey)
          : await postChatStream(payload, handlers)
        put({
          text: response.message,
          type: response.type,
          data: response.data ?? undefined,
          artifacts: response.artifacts,
          followUpQuestions: response.follow_up_questions,
          trace: response.trace,
        })
        return response
      } catch (err) {
        put({ text: 'Sorry, something went wrong: ' + errorMessage(err) })
        return null
      }
    },
    [sessionId, appendMessage, updateMessage]
  )

  // The devotional generating turn. Used both by the auto-fire effect
  // (source: 'system', empty message) and — via sendMessage — by a typed
  // verse/theme (source: 'user'). `delivered` is set only on a successful
  // result so an error leaves the session retryable.
  const runDevotionalTurn = useCallback(
    async (message: string) => {
      if (!session) return
      const history = toHistory(session.messages.slice(-6))

      // "Pick one for me" = system source + no typed verse/theme. Deal the
      // next verse from the per-browser rotation deck. Inject the (seed,
      // cursor) slot here (covers both the choice-prompt flow and a
      // sidebar-opened session), persist it so an errored retry reuses the
      // same slot instead of skipping a verse, and only advance the cursor
      // once the turn succeeds. The injection is guarded by
      // `rotationSeed == null` so a retry after an errored turn reuses the
      // already-persisted slot (carried on the wire from the session) rather
      // than re-claiming a new one — but `advance()` still keys off the
      // unguarded `isRotationPick`, so a successful retry after an error
      // (which never advanced) advances the cursor exactly once.
      const isRotationPick =
        session.modeParams.source === 'system' && message.trim() === ''
      let modeParams = { ...session.modeParams }
      // An abandoned pick (errored and never retried) leaves its cursor
      // unclaimed — `advance()` only runs on success — so a fresh session
      // simply re-deals that same card. Intentional: no verse is burned on
      // an error.
      if (isRotationPick && modeParams.rotationSeed == null) {
        const rotationSeed = useDevotionalRotationStore.getState().ensureSeed()
        const rotationCursor = useDevotionalRotationStore.getState().cursor
        modeParams = { ...modeParams, rotationSeed, rotationCursor }
        updateModeParams(sessionId, { rotationSeed, rotationCursor })
      }

      setLoading(true)
      try {
        const response = await streamAssistantReply(
          genId(),
          { message, history, mode: 'devotional', mode_params: modeParams },
          { devotional: true }
        )
        if (response && response.type !== 'error') {
          updateModeParams(sessionId, { delivered: true })
          const fromDailyCache = response.data?.from_daily_cache === true
          if (isRotationPick && !fromDailyCache) {
            useDevotionalRotationStore.getState().advance()
          }
        }
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, streamAssistantReply, updateModeParams]
  )

  const sendMessage = useCallback(
    async (text: string) => {
      // Claim the voice-turn marker before ANY early return. It is set by
      // onTranscript just before this call, so a path that leaves it in
      // place would both strand the voice hook at 'thinking' (nothing ever
      // calls speak() for that turn) and make the *next* turn — even a
      // typed one — speak its answer against a stale delegation id.
      const voiceTurn = pendingVoiceTurnRef.current
      pendingVoiceTurnRef.current = null

      if (!text.trim() || !session) {
        // Clearing the marker above is the whole recovery here: the hook
        // already drops empty/whitespace transcripts before calling
        // onTranscript, and it only exists while a session is rendered, so
        // a voice-originated call realistically can't reach this guard —
        // and if one did there'd be no answer worth speaking anyway.
        return
      }
      // Enter submits the form directly, bypassing the disabled Send
      // button — without this guard, pressing it during an in-flight
      // generation (the multi-minute devotional turn especially) starts a
      // second one.
      if (loading) {
        // GPT-Live is full-duplex, so it keeps listening while the previous
        // answer is still generating and a second utterance lands right
        // here. Say so out loud (against this turn's own delegation id) so
        // the hook returns to 'listening' instead of sitting at 'thinking'
        // for an utterance that will never be answered.
        if (voiceTurn) {
          voiceModeRef.current?.speak(
            "One moment — I'm still finishing the last answer.",
            voiceTurn.delegationId
          )
        }
        return
      }
      const userMessage: SessionMessage = { id: genId(), role: 'user', text }
      appendMessage(sessionId, userMessage)
      setInput('')

      if (session.mode === 'devotional' && !session.modeParams.delivered) {
        // The devotional turn's answer is a ~600-word document that opens
        // from the artifact pane, not something to read aloud, so a
        // voice-originated devotional isn't spoken back. Still close the
        // turn out loud so the hook leaves 'thinking'.
        if (voiceTurn) {
          voiceModeRef.current?.speak(
            "I'm writing your devotional — it'll open on screen when it's ready.",
            voiceTurn.delegationId
          )
        }
        await runDevotionalTurn(text)
        return
      }

      const history = toHistory(session.messages.slice(-6))
      // Voice mode's BYOK override only ever applies to a voice-originated
      // turn — a typed message never carries it, even with the setting on,
      // since the toggle's whole premise is "the answer GPT-Live is about
      // to speak back".
      const { openaiApiKey, useOpenAiForResponses } = useVoiceSettingsStore.getState()
      const useOpenAiLlm = !!voiceTurn && useOpenAiForResponses && !!openaiApiKey
      setLoading(true)
      try {
        const response = await streamAssistantReply(
          genId(),
          {
            message: text,
            history,
            mode: session.mode,
            mode_params: { ...session.modeParams },
            ...(useOpenAiLlm && { use_openai_llm: true }),
          },
          useOpenAiLlm ? { openAiApiKey: openaiApiKey ?? undefined } : undefined
        )
        if (session.mode === 'socratic') {
          const ref = socraticReference(response?.data)
          if (ref) updateModeParams(sessionId, { reference: ref })
        }
        if (session.mode === 'hermeneutics') {
          updateModeParams(sessionId, hermeneuticsParams(response?.data))
        }
        if (voiceTurn) {
          // Against the id captured when THIS turn's transcript arrived —
          // another utterance may have opened a newer delegation while this
          // answer was generating.
          voiceModeRef.current?.speak(
            response?.message ?? 'Sorry, something went wrong.',
            voiceTurn.delegationId
          )
        }
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, loading, appendMessage, streamAssistantReply, runDevotionalTurn, updateModeParams]
  )

  const voiceMode = useVoiceMode({
    onTranscript: (text, delegationId) => {
      pendingVoiceTurnRef.current = { delegationId }
      void sendMessage(text)
    },
    hasHistory: !!session && session.messages.length > 0,
  })

  useEffect(() => {
    voiceModeRef.current = voiceMode
  })

  // A voice session belongs to the conversation it was started in (the
  // design spec puts carrying one across a session switch out of scope).
  // This ChatPane instance is reused across sidebar switches (no `key` in
  // App.tsx), so the hook and its WebRTC connection survive a sessionId
  // change unless stopped explicitly. This cleanup runs both right before
  // the effect re-runs for a new sessionId and on true unmount, covering
  // both cases; stop() is idempotent and null-safe, so it's harmless when
  // voice mode was never started.
  useEffect(() => {
    return () => {
      voiceModeRef.current?.stop()
    }
  }, [sessionId])

  // "Pick one for me" devotional: once the pill has resolved (its ack is
  // the last message and the user hasn't typed anything), kick off the
  // generation automatically so there's no extra "generate" tap. Fires at
  // most once per session (not per mount — the instance is shared across
  // sessions); an errored generation is retried from the input, not
  // re-fired, because `devotionalAutoFired.current` stays set to this
  // session's id once it has fired.
  useEffect(() => {
    if (!session || session.mode !== 'devotional') return
    if (session.modeParams.source !== 'system' || session.modeParams.delivered) return
    if (devotionalAutoFired.current === sessionId || isBusy) return
    const hasUserQuestion = session.messages.some(
      (m) => m.role === 'user' && !m.text.startsWith('📖')
    )
    const last = session.messages[session.messages.length - 1]
    if (hasUserQuestion || !last || last.role !== 'assistant' || last.choicesStatus) return
    devotionalAutoFired.current = sessionId
    void runDevotionalTurn('')
  }, [session, sessionId, isBusy, runDevotionalTurn])

  // Re-asks the user message that produced this response, discarding the
  // old response first so the regenerated one takes its place rather than
  // stacking below it.
  const regenerate = useCallback(
    async (assistantMessageId: string) => {
      if (!session || regeneratingId) return
      const idx = session.messages.findIndex((m) => m.id === assistantMessageId)
      const userMessage = idx > 0 ? session.messages[idx - 1] : undefined
      if (!userMessage || userMessage.role !== 'user') return
      const history = session.messages.slice(0, idx - 1).slice(-6).map((m) => ({ role: m.role, text: m.text }))
      // Regenerating a Deep Study report must re-run it: sent with the
      // digest that report itself produced, the backend would treat the
      // same request as a follow-up and replace the report with a
      // paragraph answered from its own findings.
      const target = session.messages[idx]
      const isReport =
        !!target.phases?.length || !!target.artifacts?.some((a) => a.type === 'hermeneutics_report')
      const modeParams = { ...session.modeParams }
      if (session.mode === 'hermeneutics' && isReport) delete modeParams.runDigest
      setRegeneratingId(assistantMessageId)
      truncateMessagesFrom(sessionId, assistantMessageId)
      try {
        const response = await streamAssistantReply(genId(), {
          message: userMessage.text,
          history,
          mode: session.mode,
          mode_params: modeParams,
        })
        if (session.mode === 'socratic') {
          const ref = socraticReference(response?.data)
          if (ref) updateModeParams(sessionId, { reference: ref })
        }
        if (session.mode === 'hermeneutics') {
          updateModeParams(sessionId, hermeneuticsParams(response?.data))
        }
      } finally {
        setRegeneratingId(null)
      }
    },
    [session, sessionId, regeneratingId, truncateMessagesFrom, streamAssistantReply, updateModeParams]
  )

  // Finalizes a "which option?" prompt: merges the picked modeParams into
  // the session, marks the prompt as answered so its pills render disabled
  // instead of vanishing, then fetches the real primer response for it.
  const resolveChoice = useCallback(
    async (promptMessageId: string, choice: MessageChoice) => {
      if (!session || resolvingChoiceId) return
      const nextModeParams = { ...session.modeParams, ...choice.modeParams }
      setResolvingChoiceId(promptMessageId)
      updateMessage(sessionId, promptMessageId, { resolvedChoiceLabel: choice.label })
      updateModeParams(sessionId, choice.modeParams)
      // Remember the plan choice (Chronological/Canonical) across sessions
      // so reopening "Bible in a Year" later doesn't ask again.
      if (session.mode === 'reading_plan' && choice.modeParams.plan) {
        setReadingPlanProgress({
          plan: choice.modeParams.plan,
          dayIndex: choice.modeParams.dayIndex ?? nextModeParams.dayIndex ?? 0,
          completedDays: choice.modeParams.completedDays ?? nextModeParams.completedDays ?? [],
        })
      }
      try {
        const response = await postChat({ message: '', mode: session.mode, mode_params: nextModeParams })
        // Topical Study's series step responds with a list of concepts to
        // pick from next, not a finished answer — render it as a new
        // choices prompt (like the series list itself) instead of plain text.
        const concepts = (response.data as { concepts?: { slug: string; title: string }[] } | undefined)?.concepts
        if (session.mode === 'topic' && concepts) {
          appendMessage(sessionId, {
            id: genId(),
            role: 'assistant',
            text: response.message,
            choicesStatus: 'ready',
            choices: concepts.map((c) => ({ label: c.title, modeParams: { conceptSlug: c.slug } })),
          })
        } else {
          appendMessage(sessionId, {
            id: genId(),
            role: 'assistant',
            text: response.message,
            type: response.type,
            data: response.data ?? undefined,
            artifacts: response.artifacts,
            followUpQuestions: response.follow_up_questions,
            trace: response.trace,
          })
          if (session.mode === 'socratic') {
            const ref = socraticReference(response.data)
            if (ref) updateModeParams(sessionId, { reference: ref })
          }
          if (session.mode === 'hermeneutics') {
            updateModeParams(sessionId, hermeneuticsParams(response.data, { fromPrimer: true }))
          }
        }
      } catch (err) {
        appendMessage(sessionId, {
          id: genId(),
          role: 'assistant',
          text: 'Sorry, something went wrong: ' + errorMessage(err),
        })
      } finally {
        setResolvingChoiceId(null)
      }
    },
    [session, sessionId, resolvingChoiceId, updateMessage, updateModeParams, appendMessage, setReadingPlanProgress]
  )

  const handleTellAStory = useCallback(async () => {
    if (!session || tellingStory) return
    setTellingStory(true)
    try {
      const newId = await startTellAStory({ createSession, appendMessage, updateModeParams }, session)
      onNavigateToSession?.(newId)
    } catch (err) {
      // startTellAStory catches its own internal errors (appending them to
      // the new session it creates) and normally never rejects. This is
      // defense-in-depth for the case where it throws before that session
      // exists — there's nothing to append the error to but the current one.
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: 'Sorry, something went wrong: ' + errorMessage(err),
      })
    } finally {
      setTellingStory(false)
    }
  }, [session, sessionId, tellingStory, createSession, appendMessage, updateModeParams, onNavigateToSession])

  const toggleStoryTheme = useCallback(
    (themeId: string) => {
      if (!session) return
      const current = session.modeParams.storySelectedThemeIds ?? []
      const next = current.includes(themeId)
        ? current.filter((id) => id !== themeId)
        : [...current, themeId]
      updateModeParams(sessionId, { storySelectedThemeIds: next })
    },
    [session, sessionId, updateModeParams]
  )

  const setStoryAgeRange = useCallback(
    (age: StoryAgeRange) => updateModeParams(sessionId, { storyAgeRange: age }),
    [sessionId, updateModeParams]
  )

  const submitStory = useCallback(async () => {
    if (!session || storySubmitting) return
    const { storyThemes, storyDigest, storySelectedThemeIds, storyAgeRange } = session.modeParams
    if (!storySelectedThemeIds?.length) return
    setStorySubmitting(true)
    try {
      const response = await postChat({
        message: '',
        mode: 'story',
        mode_params: { storyThemes, storyDigest, storySelectedThemeIds, storyAgeRange: storyAgeRange ?? '3-6' },
      })
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: response.message,
        type: response.type,
        artifacts: response.artifacts,
      })
    } catch (err) {
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: 'Sorry, something went wrong: ' + errorMessage(err),
      })
    } finally {
      setStorySubmitting(false)
    }
  }, [session, sessionId, storySubmitting, appendMessage])

  // Re-runs theme derivation in place against the *live* source
  // conversation (`storySourceSessionId`, re-read fresh from the store —
  // it may have grown since this story session was created) when the
  // primer's own attempt either failed outright or genuinely found
  // nothing (`data.themesRetry`, set by story_mode._themes_turn for both
  // cases). Updates the same prompt message on success/failure rather
  // than appending a new one, so ThemePicker then mounts under it exactly
  // as it would have on the first successful attempt.
  const retryStoryThemes = useCallback(
    async (promptMessageId: string) => {
      if (!session || storyThemesRetrying) return
      const sourceId = session.modeParams.storySourceSessionId
      const sourceSession = sourceId ? useSessionsStore.getState().sessions[sourceId] : undefined
      const sourceMessages = sourceSession
        ? toHistory(sourceSession.messages).slice(-MAX_STORY_SOURCE_MESSAGES)
        : []
      setStoryThemesRetrying(promptMessageId)
      try {
        const response = await deriveStoryThemes(sourceMessages)
        updateMessage(sessionId, promptMessageId, {
          text: response.message,
          type: response.type,
          data: response.data ?? undefined,
        })
        const data = response.data as { themes?: { id: string; label: string; description: string }[]; digest?: string } | undefined
        if (data?.themes?.length) {
          updateModeParams(sessionId, {
            storyThemes: data.themes,
            storyDigest: data.digest,
            storySelectedThemeIds: [],
            storyAgeRange: '3-6',
          })
        }
      } catch (err) {
        updateMessage(sessionId, promptMessageId, {
          text: 'Sorry, something went wrong: ' + errorMessage(err),
        })
      } finally {
        setStoryThemesRetrying(null)
      }
    },
    [session, sessionId, storyThemesRetrying, updateMessage, updateModeParams]
  )

  // Only Parable Study and Topical Study fetch their choices, so only
  // those two know how to reload after a failed fetch.
  const retryChoices = useCallback(
    async (promptMessageId: string) => {
      if (!session) return
      updateMessage(sessionId, promptMessageId, { choicesStatus: 'loading', choicesError: undefined })
      try {
        const choices: MessageChoice[] =
          session.mode === 'parable'
            ? (await listParables()).map((p) => ({ label: `${p.name} (${p.reference})`, modeParams: { parableId: p.id } }))
            : (await listStudyWikis()).map((s) => ({ label: `${s.title} — ${s.speaker}`, modeParams: { seriesId: s.id } }))
        updateMessage(sessionId, promptMessageId, { choicesStatus: 'ready', choices })
      } catch (err) {
        updateMessage(sessionId, promptMessageId, { choicesStatus: 'error', choicesError: errorMessage(err) })
      }
    },
    [session, sessionId, updateMessage]
  )

  async function copyMessage(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    } catch {
      // Clipboard access can be denied by the browser; there's nothing
      // useful to do beyond leaving the copy affordance unconfirmed.
    }
  }

  const markDayComplete = useCallback(async () => {
    if (!session) return
    const dayIndex = session.modeParams.dayIndex ?? 0
    const completedDays = [...(session.modeParams.completedDays ?? []), dayIndex]
    const nextModeParams = { ...session.modeParams, dayIndex: dayIndex + 1, completedDays }
    updateModeParams(sessionId, { dayIndex: dayIndex + 1, completedDays })
    // Mirror the advance into cross-session progress so the next time the
    // user opens "Bible in a Year" (a fresh session), it picks up on the
    // next unread day instead of restarting at this one.
    if (session.modeParams.plan) {
      setReadingPlanProgress({ plan: session.modeParams.plan, dayIndex: dayIndex + 1, completedDays })
    }
    setMarkingComplete(true)
    try {
      const response = await postChat({ message: '', mode: session.mode, mode_params: nextModeParams })
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: response.message,
        type: response.type,
        data: response.data ?? undefined,
        artifacts: response.artifacts,
        followUpQuestions: response.follow_up_questions,
        trace: response.trace,
      })
    } catch (err) {
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: 'Sorry, something went wrong: ' + errorMessage(err),
      })
    } finally {
      setMarkingComplete(false)
    }
  }, [session, sessionId, updateModeParams, appendMessage, setReadingPlanProgress])

  // Verse references linked into chat text (wiki_qa runs
  // resolve_scripture_refs over LLM answers, producing /explorer?reference=
  // anchors) open the original-language interlinear view — the same
  // interception WikiPageBubble applies inside wiki pages, applied here to
  // every assistant message's rendered text.
  function handleVerseLinkClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href?.startsWith('/explorer?reference=')) return
    e.preventDefault()
    const reference = decodeURIComponent(href.slice('/explorer?reference='.length))
    openArtifact({
      type: 'interlinear',
      label: `${anchor?.textContent ?? reference} ▸`,
      params: { reference },
    })
  }

  if (!session) return null

  const lastMessage = session.messages[session.messages.length - 1]
  // Only once a plan has actually been picked (the choice prompt resolved)
  // is there a day loaded to mark complete.
  const showMarkComplete = session.mode === 'reading_plan' && !!session.modeParams.plan && !!lastMessage
  const showReadingPlanProgress = session.mode === 'reading_plan' && !!session.modeParams.plan
  const readingPlanDayIndex = session.modeParams.dayIndex ?? 0
  const readingPlanPercent = Math.round(
    ((session.modeParams.completedDays?.length ?? 0) / READING_PLAN_TOTAL_DAYS) * 100
  )
  const lastAssistantId = [...session.messages].reverse().find((m) => m.role === 'assistant')?.id

  // The synthetic "💬 Ask Anything" bubble a mode starter posts as the
  // first message isn't a real question — strip a leading emoji and
  // compare to the mode label to tell it apart from something the user
  // actually typed. Suggested starters show only until a real question
  // has been asked.
  const hasUserTurn = session.messages.some(
    (m) => m.role === 'user' && m.text.replace(/^\p{Emoji}\s*/u, '').trim() !== MODE_LABELS[session.mode]
  )
  const starterPrompts = SUGGESTED_PROMPTS[session.mode]
  const showStarters = !hasUserTurn && !!starterPrompts && !isBusy

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end lg:justify-between gap-3 px-4 py-2.5 border-b border-[var(--color-theme-border)]">
        <h2 className="hidden lg:block text-sm font-semibold truncate min-w-0">{session.title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <ChatNotesMenu sessionId={session.id} />
          <button
            onClick={() => setShareOpen(true)}
            disabled={session.messages.length === 0}
            title={session.messages.length === 0 ? 'Nothing to share yet' : undefined}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <Share2 className="w-3 h-3" aria-hidden="true" />
            Share
          </button>
          {session.mode !== 'story' && (
            <button
              onClick={handleTellAStory}
              disabled={session.messages.length === 0 || tellingStory}
              title={session.messages.length === 0 ? 'Nothing to turn into a story yet' : undefined}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {tellingStory ? (
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : (
                <Wand2 className="w-3 h-3" aria-hidden="true" />
              )}
              {tellingStory ? 'Reading…' : 'Tell a Story'}
            </button>
          )}
          <button
            onClick={() => setReportOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <Flag className="w-3 h-3" aria-hidden="true" />
            Report an issue
          </button>
          {showReadingPlanProgress && (
            <span
              className="hidden lg:inline-flex shrink-0 items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)]"
              title={`${session.modeParams.completedDays?.length ?? 0} of ${READING_PLAN_TOTAL_DAYS} days completed`}
            >
              <CalendarDays className="w-3 h-3" aria-hidden="true" />
              Day {readingPlanDayIndex + 1} of {READING_PLAN_TOTAL_DAYS} · {readingPlanPercent}% complete
            </span>
          )}
          <span className="hidden lg:inline-block shrink-0 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)]">
            {session.imported ? 'Imported' : MODE_LABELS[session.mode]}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {session.messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'user' ? (
              <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]">
                {msg.text}
              </div>
            ) : (
              <div className="max-w-[85%] flex flex-col gap-1.5">
                <div
                  className="text-sm whitespace-pre-wrap text-[var(--color-text-primary)]"
                  onClick={handleVerseLinkClick}
                >
                  {renderMarkdown(msg.text)}
                  {msg.type === 'verse' && msg.data && <VerseBubble data={msg.data} />}
                  {msg.type === 'verses' && Array.isArray(msg.data?.verses) && (
                    <VerseGroupBubble verses={msg.data.verses as VerseBubbleData[]} />
                  )}
                  {msg.type === 'strongs' && msg.data && <StrongsBubble data={msg.data} />}
                  {msg.type === 'study' && msg.data && <StudyBubble data={msg.data} />}
                  {msg.artifacts && msg.artifacts.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {groupArtifacts(msg.artifacts).map((group, i) =>
                        group.primary.type === 'chapter' ? (
                          <div key={i} className="flex flex-wrap items-center gap-1.5">
                            <ChapterReadingBubble link={group.primary} />
                            {group.bookContext && (
                              <button onClick={() => openArtifact(group.bookContext!)} className={ARTIFACT_PILL}>
                                {group.bookContext.label}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div key={i} className="flex flex-wrap gap-1.5">
                            <button onClick={() => openArtifact(group.primary)} className={ARTIFACT_PILL}>
                              {group.primary.label}
                            </button>
                            {group.bookContext && (
                              <button onClick={() => openArtifact(group.bookContext!)} className={ARTIFACT_PILL}>
                                {group.bookContext.label}
                              </button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  )}
                  {msg.choicesStatus === 'loading' && (
                    <div className="mt-2 text-xs text-[var(--color-text-secondary)]">Loading options…</div>
                  )}
                  {msg.choicesStatus === 'error' && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-red-600">{msg.choicesError}</span>
                      <button
                        onClick={() => retryChoices(msg.id)}
                        className="text-xs px-2 py-1 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {msg.choicesStatus === 'ready' && msg.choices && msg.choices.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(msg.resolvedChoiceLabel
                        ? msg.choices.filter((choice) => choice.label === msg.resolvedChoiceLabel)
                        : msg.choices
                      ).map((choice, i) => {
                        const answered = !!msg.resolvedChoiceLabel
                        const selected = msg.resolvedChoiceLabel === choice.label
                        return (
                          <button
                            key={i}
                            onClick={() => resolveChoice(msg.id, choice)}
                            disabled={answered || resolvingChoiceId === msg.id}
                            className={`text-sm px-3.5 py-2 rounded-full border transition-colors ${
                              selected
                                ? 'border-[var(--color-theme-accent)] bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]'
                                : 'border-[var(--color-theme-border)] bg-[var(--color-surface)]'
                            } ${!answered ? 'hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)]' : ''}`}
                          >
                            {choice.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {(() => {
                    const needsThemesRetry = (msg.data as { themesRetry?: boolean } | undefined)?.themesRetry
                    return (
                      session.mode === 'story' &&
                      msg.role === 'assistant' &&
                      needsThemesRetry && (
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() => retryStoryThemes(msg.id)}
                            disabled={storyThemesRetrying === msg.id}
                            className="text-xs px-2 py-1 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50"
                          >
                            {storyThemesRetrying === msg.id ? 'Retrying…' : 'Retry'}
                          </button>
                        </div>
                      )
                    )
                  })()}
                  {(() => {
                    const storyThemes = (msg.data as { themes?: { id: string; label: string; description: string }[] } | undefined)?.themes
                    return (
                      session.mode === 'story' &&
                      Array.isArray(storyThemes) &&
                      storyThemes.length > 0 && (
                        <ThemePicker
                          themes={storyThemes}
                          selectedIds={session.modeParams.storySelectedThemeIds ?? []}
                          ageRange={session.modeParams.storyAgeRange ?? '3-6'}
                          onToggleTheme={toggleStoryTheme}
                          onChangeAgeRange={setStoryAgeRange}
                          onSubmit={submitStory}
                          submitting={storySubmitting}
                          hasStory={session.messages.some((m) => m.artifacts?.some((a) => a.type === 'story'))}
                        />
                      )
                    )
                  })()}
                </div>
                {!!msg.passageReference && <PassageVerseBox reference={msg.passageReference} />}
                {!!msg.phases?.length && <PhaseList phases={msg.phases} />}
                {!msg.choicesStatus && (
                  <div className="flex items-center gap-0.5 text-[var(--color-text-secondary)]">
                    <button
                      onClick={() => copyMessage(msg.id, msg.text)}
                      aria-label="Copy response"
                      title="Copy"
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-[var(--color-green)]" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                    {msg.id === lastAssistantId &&
                      !msg.artifacts?.some((a) => a.type === 'devotional') && (
                      <button
                        onClick={() => regenerate(msg.id)}
                        disabled={regeneratingId === msg.id}
                        aria-label="Regenerate response"
                        title="Regenerate"
                        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${regeneratingId === msg.id ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </div>
                )}
                {/* Backend follow-up suggestions, only under the latest
                 * assistant reply so they don't stack up the transcript.
                 * Suppressed while the freeform starters are showing, to
                 * avoid two chip rows under the opening greeting. */}
                {msg.id === lastAssistantId &&
                  !msg.choicesStatus &&
                  !showStarters &&
                  msg.followUpQuestions &&
                  msg.followUpQuestions.length > 0 && (
                    <PromptChips prompts={msg.followUpQuestions} onPick={sendMessage} disabled={isBusy} />
                  )}
              </div>
            )}
          </div>
        ))}
        {showStarters && starterPrompts && (
          <PromptChips label="Try asking…" prompts={starterPrompts} onPick={sendMessage} />
        )}
        {isBusy && (
          <div
            className="flex justify-start"
            role="status"
            aria-live="polite"
            aria-label={
              devotionalPending
                ? DEVOTIONAL_STATUS_PHRASES[devotionalStatusIndex]
                : tellingStory
                  ? TELLING_STORY_STATUS
                  : 'Assistant is thinking'
            }
          >
            <div className="max-w-[85%] px-3.5 py-3 rounded-2xl rounded-bl-sm bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)] flex items-center gap-2">
              {devotionalPending && (
                <span key={devotionalStatusIndex} className="chat-typing-status text-sm" aria-hidden="true">
                  {DEVOTIONAL_STATUS_PHRASES[devotionalStatusIndex]}
                </span>
              )}
              {tellingStory && (
                <span className="chat-typing-status text-sm" aria-hidden="true">
                  {TELLING_STORY_STATUS}
                </span>
              )}
              <div className="chat-typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
        {showMarkComplete && (
          <button
            onClick={markDayComplete}
            disabled={markingComplete}
            className="self-start text-xs px-3 py-1.5 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-50"
          >
            {markingComplete ? 'Marking complete…' : 'Mark day complete'}
          </button>
        )}
        <div ref={bottomRef} />
      </div>

      {voiceMode.status === 'error' && voiceMode.errorMessage && (
        <div className="px-4 pb-1 text-xs text-[var(--color-danger)]">{voiceMode.errorMessage}</div>
      )}
      {voiceMode.liveCaption && (
        <div className="px-4 pb-1 text-xs italic text-[var(--color-text-secondary)]">{voiceMode.liveCaption}</div>
      )}

      <form
        className="flex items-center gap-2 mx-3 mt-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] rounded-2xl border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-4 py-3 shadow-sm focus-within:border-[var(--color-theme-accent)] transition-colors"
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a verse..."
          className="flex-1 bg-transparent outline-none text-sm"
        />
        <button
          type="button"
          onClick={voiceMode.toggle}
          aria-pressed={voiceMode.status !== 'idle' && voiceMode.status !== 'error'}
          aria-label={
            voiceMode.status === 'idle' || voiceMode.status === 'error'
              ? 'Start voice input'
              : VOICE_STATUS_LABEL[voiceMode.status]
          }
          title={
            voiceMode.status === 'idle' || voiceMode.status === 'error'
              ? 'Start voice input'
              : VOICE_STATUS_LABEL[voiceMode.status]
          }
          className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-full border transition-colors ${
            voiceMode.status === 'error'
              ? 'border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
              : voiceMode.status === 'idle'
                ? 'border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]'
                : 'border-transparent bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]'
          }`}
        >
          {voiceMode.status === 'connecting' ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : voiceMode.status === 'idle' || voiceMode.status === 'error' ? (
            <Mic className="w-4 h-4" aria-hidden="true" />
          ) : (
            <AudioLines
              className={`w-4 h-4 ${voiceMode.status === 'listening' ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
          )}
        </button>
        <button
          type="submit"
          aria-label="Send"
          disabled={loading || !input.trim()}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] transition-opacity disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUp className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
      </form>

      <ReportIssueDialog session={session} open={reportOpen} onOpenChange={setReportOpen} />
      <ShareDialog session={session} open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  )
}
