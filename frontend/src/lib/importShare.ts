import { fetchShare } from '@/lib/shareApi'
import { MODE_LABELS, useSessionsStore } from '@/store/useSessionsStore'

const IMPORTED_TOKENS_KEY = 'bible-explorer-imported-tokens'

// Tokens handled in this page load — guards against a StrictMode double
// invoke racing ahead of the store update.
const handledThisLoad = new Set<string>()

export type ImportResult =
  | { status: 'none' }
  | { status: 'imported'; sessionId: string }
  | { status: 'duplicate'; sessionId: string }
  | { status: 'error'; reason: 'not_found' | 'network' | 'bad_data' }

function readImportedTokens(): Set<string> {
  try {
    const raw = localStorage.getItem(IMPORTED_TOKENS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((t) => typeof t === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function rememberImportedToken(token: string): void {
  try {
    const tokens = readImportedTokens()
    tokens.add(token)
    localStorage.setItem(IMPORTED_TOKENS_KEY, JSON.stringify([...tokens]))
  } catch {
    /* private-mode storage — the in-memory guard still covers this load */
  }
}

function forgetImportedToken(token: string): void {
  try {
    const tokens = readImportedTokens()
    if (!tokens.delete(token)) return
    localStorage.setItem(IMPORTED_TOKENS_KEY, JSON.stringify([...tokens]))
  } catch {
    /* private-mode storage — nothing was persisted to forget */
  }
}

export async function consumeImportParam(): Promise<ImportResult> {
  const token = new URLSearchParams(window.location.search).get('import')
  if (!token) return { status: 'none' }

  const existing = Object.values(useSessionsStore.getState().sessions).find(
    (s) => s.imported?.token === token
  )
  if (existing) return { status: 'duplicate', sessionId: existing.id }

  // Imported before on this browser (persisted set, or already handled
  // this page load) but no live session carries the token — the user
  // deleted that session. Forget the stale marker and fall through to a
  // fresh fetch + import instead of dead-ending the link on `none`.
  if (handledThisLoad.has(token) || readImportedTokens().has(token)) {
    forgetImportedToken(token)
  }
  handledThisLoad.add(token)

  let payload
  try {
    payload = await fetchShare(token)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    return { status: 'error', reason: /\b404\b/.test(msg) ? 'not_found' : 'network' }
  }

  if (!payload || !Array.isArray(payload.messages) || typeof payload.mode !== 'string') {
    return { status: 'error', reason: 'bad_data' }
  }

  // The share was serialized by another browser: an unknown mode string
  // would post a bogus mode to /api/bible-chat on the next turn. Coerce
  // anything the app doesn't recognise to freeform.
  const mode = payload.mode in MODE_LABELS ? payload.mode : 'freeform'

  const session = useSessionsStore.getState().importSession({
    token,
    sharedAt: payload.shared_at,
    mode,
    modeParams: payload.modeParams ?? {},
    title: payload.title ?? '',
    messages: payload.messages,
    notes: Array.isArray(payload.notes) ? payload.notes : [],
  })
  rememberImportedToken(token)
  return { status: 'imported', sessionId: session.id }
}
