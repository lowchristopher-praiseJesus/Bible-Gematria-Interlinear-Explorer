import { postChat } from './chatApi'
import { toHistory } from './history'
import type { ModeParams, Session, SessionMessage } from '@/types/session'

// Mirrors chatbot/story_mode.py's MAX_STORY_SOURCE_MESSAGES — kept in
// sync by comment rather than shared code, since the two run in
// different languages/processes.
const MAX_STORY_SOURCE_MESSAGES = 60

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

interface StartTellAStoryDeps {
  createSession: (mode: 'story', modeParams: ModeParams) => Session
  appendMessage: (sessionId: string, message: SessionMessage) => void
  updateModeParams: (sessionId: string, patch: Partial<ModeParams>) => void
}

/**
 * Creates a new Tell a Story session sourced from `sourceSession`'s
 * transcript, fires the theme-derivation primer, and stores the derived
 * themes/digest into the new session's modeParams. Returns the new
 * session's id so the caller can navigate to it. Shared by the live
 * "Tell a Story from this conversation" trigger (ChatPane) and the
 * past-conversation picker (ModePickerScreen + SessionPickerScreen), so
 * both stay in lockstep with the backend contract.
 */
export async function startTellAStory(
  deps: StartTellAStoryDeps,
  sourceSession: Session
): Promise<string> {
  const { createSession, appendMessage, updateModeParams } = deps
  const session = createSession('story', {
    storySourceSessionId: sourceSession.id,
    storySourceLabel: sourceSession.title,
  })
  appendMessage(session.id, {
    id: genId(),
    role: 'user',
    text: `✨ Tell a Story from "${sourceSession.title}"`,
  })
  const sourceMessages = toHistory(sourceSession.messages).slice(-MAX_STORY_SOURCE_MESSAGES)
  try {
    const response = await postChat({
      message: '',
      mode: 'story',
      mode_params: { storySourceMessages: sourceMessages },
    })
    appendMessage(session.id, {
      id: genId(),
      role: 'assistant',
      text: response.message,
      type: response.type,
      data: response.data ?? undefined,
    })
    const data = response.data as { themes?: { id: string; label: string; description: string }[]; digest?: string } | undefined
    if (data?.themes?.length) {
      updateModeParams(session.id, {
        storyThemes: data.themes,
        storyDigest: data.digest,
        storySelectedThemeIds: [],
        storyAgeRange: '3-6',
      })
    }
  } catch (err) {
    appendMessage(session.id, {
      id: genId(),
      role: 'assistant',
      text: 'Sorry, something went wrong: ' + errorMessage(err),
    })
  }
  return session.id
}
