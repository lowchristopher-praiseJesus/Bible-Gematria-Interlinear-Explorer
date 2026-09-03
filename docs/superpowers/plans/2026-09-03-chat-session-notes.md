# Chat Session Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach up to 5 free-text notes to a chat session, edited in the right-hand pane, listed as indented rows under the conversation in the sidebar and via a note-icon menu in the chat header.

**Architecture:** Notes are stored on the `Session` object in the existing `localStorage`-backed `useSessionsStore` (Zustand `persist`), so they inherit the session's lifecycle for free. The right-hand pane's store (`useArtifactStore`) gains one mutually-exclusive extra mode, `activeNote`, and `ArtifactPane` renders a new `NoteEditor` when it is set. A new note is written to the store only on its first Save; while drafting it lives solely in `NoteEditor` local state.

**Tech Stack:** React 19, TypeScript, Zustand 5 (`persist`), Radix UI (`@radix-ui/react-popover`), Tailwind v4, `lucide-react`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-03-chat-session-notes-design.md`

## Global Constraints

- **Frontend-only.** No Flask, FastAPI, or database change. All commands run from `frontend/`.
- **Note cap: 5 per session.** Exported as `MAX_NOTES_PER_SESSION = 5` from `useSessionsStore.ts`; every entry point and `addNote` itself enforce it.
- **Persistence:** notes live only in `localStorage` under the existing key `bible-explorer-sessions`; bump the `persist` `version` from `2` to `3`.
- **Note actions never change `session.updatedAt`** — note-taking must not reorder the sidebar.
- **A new note enters the store only on first Save.** `activeNote.noteId === ''` is the "unsaved draft" sentinel.
- **`activeArtifact` and `activeNote` are never both non-null** in `useArtifactStore`.
- **Styling:** reader-shell convention only — plain Tailwind utilities + `var(--color-theme-*)` / `var(--color-text-*)` / `var(--color-surface*)` tokens + inline `lucide-react` icons. Do **not** use the admin `ui/` primitives (`IconButton`, `ConfirmDialog`, …); those are scoped to `/admin`.
- **Test runner:** `npm test` (`vitest run`). Single file: `npx vitest run src/<path>.test.tsx`. Also keep `npm run lint` and `npm run build` green.
- **Commit after every task.** Commit message trailer:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6
  ```

---

### Task 1: Note data model + sessions-store actions + persistence

**Files:**
- Modify: `frontend/src/types/session.ts`
- Modify: `frontend/src/store/useSessionsStore.ts`
- Test: `frontend/src/store/useSessionsStore.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `interface Note { id: string; createdAt: number; updatedAt: number; body: string }` (in `types/session.ts`)
  - `Session` gains `notes: Note[]` (length 0–5, creation order)
  - `export const MAX_NOTES_PER_SESSION = 5` (from `useSessionsStore.ts`)
  - `useSessionsStore` actions:
    - `addNote(sessionId: string, body: string): Note | null` — returns `null` if the session is unknown or already has 5 notes; otherwise appends `{ id, createdAt: now, updatedAt: now, body }` and returns it. Does not touch `session.updatedAt`.
    - `updateNote(sessionId: string, noteId: string, body: string): void` — sets `body` + `updatedAt` on the matching note; no-op if the session/note is unknown.
    - `deleteNote(sessionId: string, noteId: string): void` — removes the matching note; no-op if unknown.
  - `createSession` now returns a `Session` with `notes: []`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/store/useSessionsStore.test.ts`, change the existing version assertion and add the new cases:

```ts
// CHANGE the existing test:
it('persists at version 3', () => {
  expect(useSessionsStore.persist.getOptions().version).toBe(3)
})

// ADD:
it('createSession starts with an empty notes array', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  expect(session.notes).toEqual([])
})

it('addNote appends a note, returns it, and does not bump session.updatedAt', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  const before = useSessionsStore.getState().sessions[session.id].updatedAt
  const note = useSessionsStore.getState().addNote(session.id, 'first thought')
  expect(note).not.toBeNull()
  expect(note!.body).toBe('first thought')
  const stored = useSessionsStore.getState().sessions[session.id]
  expect(stored.notes).toEqual([note])
  expect(stored.updatedAt).toBe(before)
})

it('addNote returns null and does not mutate once a session has 5 notes', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  for (let i = 0; i < 5; i++) useSessionsStore.getState().addNote(session.id, `n${i}`)
  const sixth = useSessionsStore.getState().addNote(session.id, 'n6')
  expect(sixth).toBeNull()
  expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(5)
})

it('addNote returns null for an unknown session', () => {
  expect(useSessionsStore.getState().addNote('nope', 'x')).toBeNull()
})

it('updateNote replaces the body and bumps only the note updatedAt', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  const note = useSessionsStore.getState().addNote(session.id, 'draft')!
  const sessionUpdatedAt = useSessionsStore.getState().sessions[session.id].updatedAt
  useSessionsStore.getState().updateNote(session.id, note.id, 'revised')
  const stored = useSessionsStore.getState().sessions[session.id]
  expect(stored.notes[0].body).toBe('revised')
  expect(stored.notes[0].updatedAt).toBeGreaterThanOrEqual(note.updatedAt)
  expect(stored.updatedAt).toBe(sessionUpdatedAt)
})

it('deleteNote removes the matching note only', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  const a = useSessionsStore.getState().addNote(session.id, 'a')!
  const b = useSessionsStore.getState().addNote(session.id, 'b')!
  useSessionsStore.getState().deleteNote(session.id, a.id)
  const notes = useSessionsStore.getState().sessions[session.id].notes
  expect(notes.map((n) => n.id)).toEqual([b.id])
})

it('normalises a persisted session whose notes are missing or malformed', async () => {
  localStorage.setItem(
    'bible-explorer-sessions',
    JSON.stringify({
      state: {
        sessions: {
          noNotes: {
            id: 'noNotes', mode: 'freeform', modeParams: {}, title: 'Ask Anything',
            messages: [], createdAt: 1, updatedAt: 1,
          },
          messyNotes: {
            id: 'messyNotes', mode: 'freeform', modeParams: {}, title: 'Ask Anything',
            messages: [], createdAt: 1, updatedAt: 1,
            notes: [
              { id: 'n1', body: 'keep me', createdAt: 2, updatedAt: 2 },
              'not-an-object',
              { id: 5, body: 'bad id' },
              { id: 'n2', body: 'no timestamps' },
            ],
          },
        },
        activeSessionId: 'noNotes',
      },
      version: 2,
    })
  )
  await useSessionsStore.persist.rehydrate()
  const state = useSessionsStore.getState()
  expect(state.sessions.noNotes.notes).toEqual([])
  const kept = state.sessions.messyNotes.notes
  expect(kept.map((n) => n.id)).toEqual(['n1', 'n2'])
  expect(typeof kept[1].createdAt).toBe('number')
})

it('trims a persisted notes array longer than 5 to the first 5', async () => {
  const notes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, body: `${i}`, createdAt: i, updatedAt: i }))
  localStorage.setItem('bible-explorer-sessions', JSON.stringify({
    state: {
      sessions: { s: { id: 's', mode: 'freeform', modeParams: {}, title: 'Ask Anything', messages: [], createdAt: 1, updatedAt: 1, notes } },
      activeSessionId: 's',
    },
    version: 3,
  }))
  await useSessionsStore.persist.rehydrate()
  expect(useSessionsStore.getState().sessions.s.notes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4'])
})
```

Delete the old `it('persists at version 2', ...)` test (replaced above).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/store/useSessionsStore.test.ts`
Expected: FAIL — `addNote`/`updateNote`/`deleteNote` are `undefined`; version is `2`; `session.notes` is `undefined`.

- [ ] **Step 3: Add the `Note` type**

In `frontend/src/types/session.ts`, add the interface (near `Session`) and the field:

```ts
export interface Note {
  id: string
  createdAt: number
  updatedAt: number
  body: string
}

export interface Session {
  id: string
  createdAt: number
  updatedAt: number
  mode: SessionMode
  modeParams: ModeParams
  title: string
  messages: SessionMessage[]
  notes: Note[]
}
```

- [ ] **Step 4: Implement the store changes**

In `frontend/src/store/useSessionsStore.ts`:

Update the type import:
```ts
import type { ModeParams, Note, Session, SessionMessage, SessionMode } from '@/types/session'
```

Add the cap constant next to `MODE_LABELS`:
```ts
export const MAX_NOTES_PER_SESSION = 5
```

Add a note-id generator next to `genId`:
```ts
let noteIdCounter = 0
function genNoteId(): string {
  return `note-${Date.now()}-${++noteIdCounter}`
}
```

Add the three action signatures to `interface SessionsState` (after `truncateMessagesFrom`):
```ts
  addNote: (sessionId: string, body: string) => Note | null
  updateNote: (sessionId: string, noteId: string, body: string) => void
  deleteNote: (sessionId: string, noteId: string) => void
```

In `createSession`, add `notes: []` to the new `session` object.

Add the action implementations inside the store object (after `truncateMessagesFrom`):
```ts
      addNote: (sessionId, body) => {
        const existing = get().sessions[sessionId]
        if (!existing || existing.notes.length >= MAX_NOTES_PER_SESSION) return null
        const now = Date.now()
        const note: Note = { id: genNoteId(), createdAt: now, updatedAt: now, body }
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: { ...existing, notes: [...existing.notes, note] },
          },
        }))
        return note
      },

      updateNote: (sessionId, noteId, body) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                notes: existing.notes.map((n) =>
                  n.id === noteId ? { ...n, body, updatedAt: Date.now() } : n
                ),
              },
            },
          }
        }),

      deleteNote: (sessionId, noteId) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...existing, notes: existing.notes.filter((n) => n.id !== noteId) },
            },
          }
        }),
```

Add note sanitisation helpers next to `isValidSession` / `sanitizeSessions`:
```ts
function isValidNote(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.body === 'string'
}

function sanitizeNotes(notes: unknown): Note[] {
  if (!Array.isArray(notes)) return []
  const out: Note[] = []
  for (const value of notes) {
    if (!isValidNote(value)) continue
    const candidate = value as Record<string, unknown>
    out.push({
      id: candidate.id as string,
      body: candidate.body as string,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
    })
    if (out.length === MAX_NOTES_PER_SESSION) break
  }
  return out
}
```

In `sanitizeSessions`, attach a clean `notes` array to every kept session:
```ts
    if (isValidSession(value)) {
      const raw = value as Session & { notes?: unknown }
      out[id] = { ...raw, notes: sanitizeNotes(raw.notes) }
    }
```

Bump the persist `version` from `2` to `3`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/store/useSessionsStore.test.ts`
Expected: PASS (all cases, including the two rehydration cases).

- [ ] **Step 6: Run the full suite, lint, and build**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: PASS. (The existing `createSession` `toEqual` test still passes because both sides now carry `notes: []`.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/store/useSessionsStore.ts frontend/src/store/useSessionsStore.test.ts
git commit -m "feat(notes): add Note model and sessions-store note actions

Notes live on the Session object (max 5, creation order), persisted with
the sessions store at version 3. addNote/updateNote/deleteNote leave
session.updatedAt untouched. Rehydration normalises missing/malformed
notes arrays and trims to 5.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6"
```

---

### Task 2: `activeNote` mode on the artifact store

**Files:**
- Modify: `frontend/src/store/useArtifactStore.ts`
- Test: `frontend/src/store/useArtifactStore.test.ts`

**Interfaces:**
- Consumes: nothing (holds only `sessionId` / `noteId` strings).
- Produces on `useArtifactStore`:
  - state `activeNote: { sessionId: string; noteId: string } | null` (initial `null`)
  - `openNote(sessionId: string, noteId: string): void` — sets `activeNote = { sessionId, noteId }`; clears `activeArtifact`, `history`, `data`, `error`; `status = 'idle'`.
  - `openNewNote(sessionId: string): void` — same, with `noteId = ''`.
  - `openArtifact`, `goBack`, `close` additionally set `activeNote = null`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/store/useArtifactStore.test.ts`, update the `beforeEach` reset and add cases:

```ts
// CHANGE beforeEach to include activeNote:
  beforeEach(() => {
    useArtifactStore.setState({
      activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null,
    })
  })

// ADD:
it('openNote sets activeNote and clears any active artifact and history', async () => {
  vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
  await useArtifactStore.getState().openArtifact({ type: 'strongs', label: '', params: { id: 'G26' } })
  useArtifactStore.getState().openNote('session-1', 'note-1')
  const s = useArtifactStore.getState()
  expect(s.activeNote).toEqual({ sessionId: 'session-1', noteId: 'note-1' })
  expect(s.activeArtifact).toBeNull()
  expect(s.history).toEqual([])
  expect(s.status).toBe('idle')
})

it('openNewNote sets activeNote with an empty noteId sentinel', () => {
  useArtifactStore.getState().openNewNote('session-1')
  expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: 'session-1', noteId: '' })
})

it('openArtifact clears an active note', async () => {
  vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
  useArtifactStore.getState().openNote('s1', 'n1')
  await useArtifactStore.getState().openArtifact({ type: 'strongs', label: '', params: { id: 'G26' } })
  expect(useArtifactStore.getState().activeNote).toBeNull()
})

it('close clears an active note', () => {
  useArtifactStore.getState().openNote('s1', 'n1')
  useArtifactStore.getState().close()
  expect(useArtifactStore.getState().activeNote).toBeNull()
})

it('goBack clears an active note while returning to the previous artifact', async () => {
  const verseLink = { type: 'interlinear' as const, label: 'v', params: { versenumber: 1 } }
  const strongsLink = { type: 'strongs' as const, label: 's', params: { id: 'G26' } }
  vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue({
    verse: {}, navigation: { previous: 1, next: 2 }, kjvWords: [], originalWords: [], strongsDefinitions: {},
  } as never)
  vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
  await useArtifactStore.getState().openArtifact(verseLink)
  await useArtifactStore.getState().openArtifact(strongsLink)
  useArtifactStore.setState({ activeNote: { sessionId: 's1', noteId: 'n1' } })
  await useArtifactStore.getState().goBack()
  expect(useArtifactStore.getState().activeNote).toBeNull()
  expect(useArtifactStore.getState().activeArtifact).toEqual(verseLink)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/store/useArtifactStore.test.ts`
Expected: FAIL — `openNote` / `openNewNote` undefined; `activeNote` undefined.

- [ ] **Step 3: Implement**

In `frontend/src/store/useArtifactStore.ts`:

Add to `interface ArtifactState` (after `activeArtifact`):
```ts
  activeNote: { sessionId: string; noteId: string } | null
```
and the action signatures (after `openArtifact`):
```ts
  openNote: (sessionId: string, noteId: string) => void
  openNewNote: (sessionId: string) => void
```

Set the initial value (next to `activeArtifact: null`):
```ts
  activeNote: null,
```

In `openArtifact`, add `activeNote: null` to the `set({ activeArtifact: link, history, ... })` call.

In `goBack`, add `activeNote: null` to the `set({ activeArtifact: previous, ... })` call.

In `close`, add `activeNote: null` to its `set({ ... })` call.

Add the two new actions (after `openArtifact`):
```ts
  openNote: (sessionId, noteId) =>
    set({
      activeNote: { sessionId, noteId },
      activeArtifact: null,
      history: [],
      status: 'idle',
      data: null,
      error: null,
    }),

  openNewNote: (sessionId) =>
    set({
      activeNote: { sessionId, noteId: '' },
      activeArtifact: null,
      history: [],
      status: 'idle',
      data: null,
      error: null,
    }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/store/useArtifactStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useArtifactStore.ts frontend/src/store/useArtifactStore.test.ts
git commit -m "feat(notes): add activeNote mode to the artifact store

openNote/openNewNote put the right pane into note mode and clear any
active artifact; openArtifact/goBack/close clear activeNote. The two
modes are mutually exclusive.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6"
```

---

### Task 3: `noteLabel` helper

**Files:**
- Create: `frontend/src/lib/noteLabel.ts`
- Test: `frontend/src/lib/noteLabel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function noteLabel(note: { body: string }): string` — the first non-empty, trimmed line of `note.body`; `"Untitled note"` for an empty/whitespace-only body. No truncation (callers truncate with CSS).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/noteLabel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { noteLabel } from './noteLabel'

describe('noteLabel', () => {
  it('returns the first line of a single-line body, trimmed', () => {
    expect(noteLabel({ body: '  Thoughts on grace  ' })).toBe('Thoughts on grace')
  })

  it('skips leading blank lines and returns the first line with content', () => {
    expect(noteLabel({ body: '\n\n   \nReal content\nmore' })).toBe('Real content')
  })

  it('falls back to "Untitled note" for an empty body', () => {
    expect(noteLabel({ body: '' })).toBe('Untitled note')
  })

  it('falls back to "Untitled note" for a whitespace-only body', () => {
    expect(noteLabel({ body: '   \n\t\n  ' })).toBe('Untitled note')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/noteLabel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/noteLabel.ts`:

```ts
/**
 * The label shown for a note in lists — its first non-empty line, trimmed.
 * Falls back to "Untitled note" for an empty or whitespace-only body.
 * Callers truncate with CSS (`truncate`) so the full text stays available
 * to `title` and assistive tech.
 */
export function noteLabel(note: { body: string }): string {
  for (const line of note.body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return 'Untitled note'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/noteLabel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/noteLabel.ts frontend/src/lib/noteLabel.test.ts
git commit -m "feat(notes): add noteLabel helper for list rows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6"
```

---

### Task 4: `NoteEditor` component

**Files:**
- Create: `frontend/src/components/shell/NoteEditor.tsx`
- Test: `frontend/src/components/shell/NoteEditor.test.tsx`

**Interfaces:**
- Consumes: `useSessionsStore` (`addNote`, `updateNote`, `deleteNote`, and `sessions[sessionId].notes`), `useArtifactStore` (`openNote`, `close`), `formatSessionTimestamp` from `@/lib/formatTimestamp`.
- Produces: `export function NoteEditor({ sessionId, noteId }: { sessionId: string; noteId: string }): JSX.Element`. `noteId === ''` ⇒ unsaved draft (opens in edit mode). The consumer (`ArtifactPane`, Task 5) mounts it with `key={`${sessionId}:${noteId}`}` so switching identity resets its local state.
  - Accessible names it relies on: the textarea has `aria-label="Note text"`; buttons read `Save`, `Cancel`, `Edit`, `Delete`, and (armed) `Click again to confirm`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/shell/NoteEditor.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteEditor } from './NoteEditor'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'

function newSession() {
  return useSessionsStore.getState().createSession('freeform', {})
}

describe('NoteEditor', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({
      activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null,
    })
  })

  it('a draft opens in edit mode and Save creates the note', async () => {
    const session = newSession()
    render(<NoteEditor sessionId={session.id} noteId="" />)
    await userEvent.type(screen.getByLabelText('Note text'), 'A fresh thought')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const notes = useSessionsStore.getState().sessions[session.id].notes
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toBe('A fresh thought')
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId: notes[0].id })
  })

  it('Cancel on a draft closes the pane and persists nothing', async () => {
    const session = newSession()
    render(<NoteEditor sessionId={session.id} noteId="" />)
    await userEvent.type(screen.getByLabelText('Note text'), 'discard me')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(0)
    expect(useArtifactStore.getState().activeNote).toBeNull()
  })

  it('a saved note opens read-only; Edit then Save updates it', async () => {
    const session = newSession()
    const note = useSessionsStore.getState().addNote(session.id, 'original')!
    render(<NoteEditor sessionId={session.id} noteId={note.id} />)

    expect(screen.getByText('original')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByLabelText('Note text')
    await userEvent.clear(box)
    await userEvent.type(box, 'updated body')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(useSessionsStore.getState().sessions[session.id].notes[0].body).toBe('updated body')
    expect(screen.getByText('updated body')).toBeInTheDocument()
  })

  it('Delete needs a second click, then removes the note and closes the pane', async () => {
    const session = newSession()
    const note = useSessionsStore.getState().addNote(session.id, 'kill me')!
    useArtifactStore.getState().openNote(session.id, note.id)
    render(<NoteEditor sessionId={session.id} noteId={note.id} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /click again to confirm/i }))
    expect(useSessionsStore.getState().sessions[session.id].notes).toHaveLength(0)
    expect(useArtifactStore.getState().activeNote).toBeNull()
  })

  it('shows an unavailable message for a note id that does not exist', () => {
    const session = newSession()
    render(<NoteEditor sessionId={session.id} noteId="ghost" />)
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
  })

  it('shows an "edited" marker once a note updatedAt is ahead of createdAt', () => {
    const session = newSession()
    const note = useSessionsStore.getState().addNote(session.id, 'v1')!
    useSessionsStore.setState((state) => {
      const s = state.sessions[session.id]
      return {
        sessions: {
          ...state.sessions,
          [session.id]: { ...s, notes: s.notes.map((n) => ({ ...n, createdAt: 1000, updatedAt: 2000 })) },
        },
      }
    })
    render(<NoteEditor sessionId={session.id} noteId={note.id} />)
    expect(screen.getByText(/edited/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/shell/NoteEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/shell/NoteEditor.tsx`:

```tsx
import { useState } from 'react'
import { NotebookPen } from 'lucide-react'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { formatSessionTimestamp } from '@/lib/formatTimestamp'

interface Props {
  sessionId: string
  /** Empty string means "a new, unsaved note". */
  noteId: string
}

const PILL_PRIMARY =
  'text-sm px-3 py-1.5 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-40'
const PILL_SECONDARY =
  'text-sm px-3 py-1.5 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)] transition-colors'

export function NoteEditor({ sessionId, noteId }: Props) {
  const isDraft = noteId === ''
  const note = useSessionsStore((s) => {
    const session = s.sessions[sessionId]
    return session ? session.notes.find((n) => n.id === noteId) : undefined
  })
  const addNote = useSessionsStore((s) => s.addNote)
  const updateNote = useSessionsStore((s) => s.updateNote)
  const deleteNote = useSessionsStore((s) => s.deleteNote)
  const openNote = useArtifactStore((s) => s.openNote)
  const close = useArtifactStore((s) => s.close)

  const [mode, setMode] = useState<'view' | 'edit'>(isDraft ? 'edit' : 'view')
  const [draft, setDraft] = useState(note?.body ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [limitHit, setLimitHit] = useState(false)
  const [openedAt] = useState(() => Date.now())

  if (!isDraft && !note) {
    return (
      <div className="text-sm text-[var(--color-text-secondary)] italic">
        This note is no longer available.
      </div>
    )
  }

  const createdAt = note?.createdAt ?? openedAt
  const edited = !!note && note.updatedAt > note.createdAt

  function handleSaveDraft() {
    const created = addNote(sessionId, draft)
    if (!created) {
      setLimitHit(true)
      return
    }
    openNote(sessionId, created.id)
  }

  function handleSaveEdit() {
    updateNote(sessionId, noteId, draft)
    setMode('view')
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    deleteNote(sessionId, noteId)
    close()
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] shrink-0">
        <NotebookPen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{formatSessionTimestamp(createdAt)}</span>
        {edited && <span className="opacity-70">· edited {formatSessionTimestamp(note!.updatedAt)}</span>}
      </div>

      {mode === 'edit' ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write your note…"
          aria-label="Note text"
          className="flex-1 min-h-[12rem] w-full resize-none rounded-lg border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] p-3 text-sm outline-none focus:border-[var(--color-theme-accent)] transition-colors"
        />
      ) : (
        <div className="flex-1 text-sm whitespace-pre-wrap text-[var(--color-text-primary)]">
          {note!.body || <span className="italic text-[var(--color-text-secondary)]">Empty note.</span>}
        </div>
      )}

      {limitHit && (
        <div className="text-xs text-red-600 shrink-0">This conversation already has 5 notes.</div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        {mode === 'edit' ? (
          <>
            <button className={PILL_PRIMARY} onClick={isDraft ? handleSaveDraft : handleSaveEdit}>
              Save
            </button>
            <button
              className={PILL_SECONDARY}
              onClick={() => {
                if (isDraft) {
                  close()
                } else {
                  setDraft(note!.body)
                  setMode('view')
                }
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className={PILL_SECONDARY}
              onClick={() => {
                setDraft(note!.body)
                setMode('edit')
              }}
            >
              Edit
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded-full text-red-600 hover:bg-[var(--color-surface-alt)] transition-colors"
              onClick={handleDelete}
            >
              {confirmingDelete ? 'Click again to confirm' : 'Delete'}
            </button>
            {confirmingDelete && (
              <button
                className="text-xs px-2 py-1 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/shell/NoteEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/NoteEditor.tsx frontend/src/components/shell/NoteEditor.test.tsx
git commit -m "feat(notes): add NoteEditor for the artifact pane

Fixed non-editable timestamp header, view/edit modes, explicit Save, and
a two-click inline Delete confirm (matching SettingsPanel's clear-all).
A draft is persisted only on first Save.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6"
```

---

### Task 5: Render `NoteEditor` in `ArtifactPane` and show the pane from `App`

**Files:**
- Modify: `frontend/src/components/shell/ArtifactPane.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/components/shell/ArtifactPane.test.tsx`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `useArtifactStore.activeNote` (Task 2), `NoteEditor` (Task 4), `useSessionsStore` (tests only).
- Produces: when `activeNote` is set, `ArtifactPane` renders `<NoteEditor key={`${activeNote.sessionId}:${activeNote.noteId}`} .../>` in its scroll body and shows the header title `Note`. `App` shows the right pane at `lg` and brings it forward on narrow viewports for `activeArtifact || activeNote`, and its session-switch cleanup keeps an `activeNote` whose `sessionId` matches the newly selected session.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/shell/ArtifactPane.test.tsx`, add the sessions-store import and reset, and two cases:

```tsx
// ADD import:
import { useSessionsStore } from '@/store/useSessionsStore'

// CHANGE beforeEach:
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({
      activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null,
    })
  })

// ADD:
it('renders the note editor when a note is active', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  const note = useSessionsStore.getState().addNote(session.id, 'my note body')!
  useArtifactStore.setState({ activeNote: { sessionId: session.id, noteId: note.id } })
  render(<ArtifactPane />)
  expect(screen.getByText('my note body')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
})

it('titles the pane "Note" while a note is active', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  const note = useSessionsStore.getState().addNote(session.id, 'x')!
  useArtifactStore.setState({ activeNote: { sessionId: session.id, noteId: note.id } })
  render(<ArtifactPane />)
  expect(screen.getByText('Note')).toBeInTheDocument()
})
```

In `frontend/src/App.test.tsx`, add `activeNote: null` to the `beforeEach` artifact reset, then add:

```tsx
it('opening a note brings the Artifact pane forward', async () => {
  vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
  await screen.findByText('Ask me anything.')
  const sid = useSessionsStore.getState().activeSessionId!
  const note = useSessionsStore.getState().addNote(sid, 'a note')!

  useArtifactStore.getState().openNote(sid, note.id)

  expect(await screen.findByRole('button', { name: 'Artifact' })).toHaveAttribute('aria-current', 'true')
})

it('a note belonging to the newly selected session survives the switch', async () => {
  vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
  await screen.findByText('Ask me anything.')
  const other = useSessionsStore.getState().createSession('topic', { conceptSlug: 'grace' })
  const note = useSessionsStore.getState().addNote(other.id, 'carry me over')!

  // Simulate the sidebar note click: open the note, then select its session.
  useArtifactStore.getState().openNote(other.id, note.id)
  await userEvent.click(screen.getByRole('button', { name: 'Sessions' }))
  await userEvent.click(screen.getByText('carry me over'))

  expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: other.id, noteId: note.id })
})
```

Note: the second App test depends on the sidebar note row from Task 6. If Task 6 is not yet implemented, mark this test `it.todo(...)` and convert it in Task 6. (Subagent-driven execution runs tasks in order, so implement it here only if Task 6 is already done; otherwise leave `it.todo`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/shell/ArtifactPane.test.tsx src/App.test.tsx`
Expected: FAIL — no note editor branch; pane not brought forward for `activeNote`.

- [ ] **Step 3: Implement `ArtifactPane`**

In `frontend/src/components/shell/ArtifactPane.tsx`:

Add the import:
```ts
import { NoteEditor } from '@/components/shell/NoteEditor'
```

Destructure `activeNote`:
```ts
  const { activeArtifact, activeNote, history, status, data, error, close, goBack } = useArtifactStore()
```

Change the header title span to:
```tsx
          <span className="font-semibold text-sm truncate">
            {activeNote ? 'Note' : activeArtifact?.label ?? 'Artifact'}
          </span>
```

Wrap the scroll-body content so a note takes over the whole body:
```tsx
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeNote ? (
          <NoteEditor
            key={`${activeNote.sessionId}:${activeNote.noteId}`}
            sessionId={activeNote.sessionId}
            noteId={activeNote.noteId}
          />
        ) : (
          <>
            {status === 'idle' && (
              <div className="text-sm text-[var(--color-text-secondary)] italic">
                Click a link in the chat to see details here.
              </div>
            )}
            {status === 'loading' && <div className="text-sm text-[var(--color-text-secondary)]">Loading…</div>}
            {status === 'error' && <div className="text-sm text-red-600">{error}</div>}
            {status === 'ready' && activeArtifact && !!data && (
              <>
                {activeArtifact.type === 'interlinear' && <InterlinearArtifact data={data as ExplorerResponse} />}
                {activeArtifact.type === 'strongs' && <StrongsArtifact data={data as StrongsResponse} />}
                {activeArtifact.type === 'book_context' && <BookContextArtifact data={data as BookContextResponse} />}
                {activeArtifact.type === 'gematria' && <GematriaArtifact data={data as GematriaResponse} />}
                {activeArtifact.type === 'english_search' && <EnglishSearchArtifact data={data as EnglishResponse} />}
              </>
            )}
          </>
        )}
      </div>
```

- [ ] **Step 4: Implement `App`**

In `frontend/src/App.tsx`:

Add the selector:
```ts
  const activeNote = useArtifactStore((s) => s.activeNote)
```

Guard the session-switch cleanup effect:
```tsx
  useEffect(() => {
    const artifact = useArtifactStore.getState()
    if (!artifact.activeNote || artifact.activeNote.sessionId !== sessionId) {
      artifact.close()
    }
    setActivePane('chat')
  }, [sessionId])
```

Extend the pane-forward effect:
```tsx
  useEffect(() => {
    if (activeArtifact || activeNote) setActivePane('artifact')
  }, [activeArtifact, activeNote])
```

Change the right-pane wrapper's `lg` visibility:
```tsx
        <div
          className={`w-full lg:w-96 shrink-0 ${activePane === 'artifact' ? 'block' : 'hidden'} ${activeArtifact || activeNote ? 'lg:block' : 'lg:hidden'}`}
        >
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/shell/ArtifactPane.test.tsx src/App.test.tsx`
Expected: PASS (the "survives the switch" test remains `it.todo` until Task 6 if the sidebar row isn't built yet).

- [ ] **Step 6: Full suite, lint, build**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shell/ArtifactPane.tsx frontend/src/App.tsx frontend/src/components/shell/ArtifactPane.test.tsx frontend/src/App.test.tsx
git commit -m "feat(notes): show NoteEditor in the artifact pane

ArtifactPane renders NoteEditor (keyed by session:note) when activeNote
is set and titles the pane 'Note'. App shows and forwards the right pane
for activeNote, and keeps a note open across a session switch when the
note belongs to the session being selected.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6"
```

---

### Task 6: Indented note rows in `SessionsPane`

**Files:**
- Modify: `frontend/src/components/shell/SessionsPane.tsx`
- Test: `frontend/src/components/shell/SessionsPane.test.tsx`

**Interfaces:**
- Consumes: `session.notes` (Task 1), `useArtifactStore.getState().openNote` (Task 2), `noteLabel` (Task 3), `formatSessionTimestamp`, `StickyNote` from `lucide-react`.
- Produces: under each session row, one `<button>` per note (indented, first-line label + created timestamp). Clicking it selects the parent session (via `onSelectSession`, if not already active) and calls `openNote(session.id, note.id)`. Note rows sit inside the mode section, so collapsing the section hides them.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/shell/SessionsPane.test.tsx`, add `activeNote: null` to the `beforeEach` artifact reset, then add:

```tsx
it("renders a session's notes as indented rows beneath it", () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  useSessionsStore.getState().addNote(session.id, 'Note about mercy')
  render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
  expect(screen.getByText('Note about mercy')).toBeInTheDocument()
})

it('clicking a note row opens it in the artifact store', async () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  const note = useSessionsStore.getState().addNote(session.id, 'Open me')!
  render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
  await userEvent.click(screen.getByText('Open me'))
  expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId: note.id })
})

it('selects the parent session when a note from an inactive session is clicked', async () => {
  const active = useSessionsStore.getState().createSession('freeform', {})
  const other = useSessionsStore.getState().createSession('parable', { parableId: 'lost_sheep' })
  const note = useSessionsStore.getState().addNote(other.id, 'from the other one')!
  const onSelectSession = vi.fn()
  render(<SessionsPane activeSessionId={active.id} onSelectSession={onSelectSession} onNewSession={() => {}} />)
  await userEvent.click(screen.getByText('from the other one'))
  expect(onSelectSession).toHaveBeenCalledWith(other.id)
  expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: other.id, noteId: note.id })
})

it('hides note rows when their mode section is collapsed', async () => {
  const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
  useSessionsStore.getState().addNote(session.id, 'collapsible note')
  render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
  expect(screen.getByText('collapsible note')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Parable Study/ }))
  expect(screen.queryByText('collapsible note')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/shell/SessionsPane.test.tsx`
Expected: FAIL — note text is not rendered.

- [ ] **Step 3: Implement**

In `frontend/src/components/shell/SessionsPane.tsx`:

Add to the `lucide-react` import list: `StickyNote`. Add imports:
```ts
import { noteLabel } from '@/lib/noteLabel'
```
(`useArtifactStore` and `formatSessionTimestamp` are already imported.)

Replace the session-row `.map(...)` body so each session and its notes share a wrapper. The current code is:

```tsx
              {!isCollapsed &&
                grouped[mode]!.map((session) => (
                  <div
                    key={session.id}
                    className={`group flex items-start justify-between gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                      session.id === activeSessionId ? 'bg-[var(--color-surface-alt)] font-medium' : 'hover:bg-[var(--color-surface-alt)]'
                    }`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    {/* ...existing session-row inner content... */}
                  </div>
                ))}
```

Change it to:

```tsx
              {!isCollapsed &&
                grouped[mode]!.map((session) => (
                  <div key={session.id}>
                    <div
                      className={`group flex items-start justify-between gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                        session.id === activeSessionId ? 'bg-[var(--color-surface-alt)] font-medium' : 'hover:bg-[var(--color-surface-alt)]'
                      }`}
                      onClick={() => onSelectSession(session.id)}
                    >
                      {/* ...existing session-row inner content, unchanged... */}
                    </div>
                    {session.notes.map((note) => (
                      <button
                        key={note.id}
                        onClick={() => {
                          if (session.id !== activeSessionId) onSelectSession(session.id)
                          useArtifactStore.getState().openNote(session.id, note.id)
                        }}
                        className="w-full flex flex-col items-start gap-0.5 pl-9 pr-3 py-1.5 text-left text-xs hover:bg-[var(--color-surface-alt)] transition-colors"
                      >
                        <span className="flex items-center gap-1.5 max-w-full">
                          <StickyNote className="h-3 w-3 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                          <span className="truncate">{noteLabel(note)}</span>
                        </span>
                        <span className="pl-[1.125rem] text-[10px] text-[var(--color-text-secondary)]">
                          {formatSessionTimestamp(note.createdAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
```

Keep the existing session-row inner content (the `min-w-0 flex flex-col` block and the delete `<button>`) exactly as it is — only the wrapping element and the added note buttons are new.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/shell/SessionsPane.test.tsx`
Expected: PASS. Also re-run the existing SessionsPane suite to confirm the delete-scope tests still pass (the `.closest('div').parentElement` lookups still resolve to the `group` row).

- [ ] **Step 5: Convert the deferred App test**

If Task 5 left `it('a note belonging to the newly selected session survives the switch', ...)` as `it.todo`, convert it to a real `it(...)` now (the body is already written in Task 5, Step 1). Run:
`cd frontend && npx vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full suite, lint, build**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shell/SessionsPane.tsx frontend/src/components/shell/SessionsPane.test.tsx frontend/src/App.test.tsx
git commit -m "feat(notes): list session notes as indented sidebar rows

Each note renders under its conversation as an indented row (first-line
label + created time). Clicking selects the parent session and opens the
note in the artifact pane. Rows collapse with their mode section.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6"
```

---

### Task 7: `ChatNotesMenu` in the chat header

**Files:**
- Create: `frontend/src/components/shell/ChatNotesMenu.tsx`
- Modify: `frontend/src/components/shell/ChatPane.tsx`
- Test: `frontend/src/components/shell/ChatNotesMenu.test.tsx`
- Test: `frontend/src/components/shell/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `useSessionsStore` (`sessions[sessionId].notes`), `MAX_NOTES_PER_SESSION` (Task 1), `useArtifactStore` (`openNote`, `openNewNote`), `noteLabel` (Task 3), `formatSessionTimestamp`, `@radix-ui/react-popover`, `NotebookPen` / `Plus` / `StickyNote` from `lucide-react`.
- Produces: `export function ChatNotesMenu({ sessionId }: { sessionId: string }): JSX.Element`. Renders one icon button, accessible name `Notes`, with a count badge when `notes.length > 0`. With 0 notes a click calls `openNewNote(sessionId)` and opens no menu; with ≥1 note a click opens a Radix popover (anchored, self-controlled `open`) listing the notes plus a `New note` action, replaced by a `Maximum of 5 notes` line at the cap.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/shell/ChatNotesMenu.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatNotesMenu } from './ChatNotesMenu'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'

describe('ChatNotesMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({
      activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null,
    })
  })

  it('with no notes, clicking the icon opens a new draft and no menu', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatNotesMenu sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId: '' })
    expect(screen.queryByText('New note')).not.toBeInTheDocument()
  })

  it('with notes, clicking the icon opens a menu that lists them', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().addNote(session.id, 'Grace and works')
    render(<ChatNotesMenu sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    await userEvent.click(screen.getByText('Grace and works'))
    const noteId = useSessionsStore.getState().sessions[session.id].notes[0].id
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId })
  })

  it('the "New note" action opens a fresh draft', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().addNote(session.id, 'existing')
    render(<ChatNotesMenu sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    await userEvent.click(screen.getByText('New note'))
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: session.id, noteId: '' })
  })

  it('replaces "New note" with a limit message at 5 notes', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    for (let i = 0; i < 5; i++) useSessionsStore.getState().addNote(session.id, `n${i}`)
    render(<ChatNotesMenu sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.queryByText('New note')).not.toBeInTheDocument()
    expect(screen.getByText(/maximum of 5 notes/i)).toBeInTheDocument()
  })

  it('shows a count badge equal to the number of notes', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().addNote(session.id, 'a')
    useSessionsStore.getState().addNote(session.id, 'b')
    render(<ChatNotesMenu sessionId={session.id} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

In `frontend/src/components/shell/ChatPane.test.tsx`, add:

```tsx
it('shows the notes control in the header', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  render(<ChatPane sessionId={session.id} />)
  expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/shell/ChatNotesMenu.test.tsx src/components/shell/ChatPane.test.tsx`
Expected: FAIL — module not found; no `Notes` button in the ChatPane header.

- [ ] **Step 3: Implement `ChatNotesMenu`**

Create `frontend/src/components/shell/ChatNotesMenu.tsx`:

```tsx
import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { NotebookPen, Plus, StickyNote } from 'lucide-react'
import { MAX_NOTES_PER_SESSION, useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { noteLabel } from '@/lib/noteLabel'
import { formatSessionTimestamp } from '@/lib/formatTimestamp'
import type { Note } from '@/types/session'

interface Props {
  sessionId: string
}

const EMPTY_NOTES: Note[] = []

export function ChatNotesMenu({ sessionId }: Props) {
  const notes = useSessionsStore((s) => s.sessions[sessionId]?.notes ?? EMPTY_NOTES)
  const openNote = useArtifactStore((s) => s.openNote)
  const openNewNote = useArtifactStore((s) => s.openNewNote)
  const [open, setOpen] = useState(false)

  const atLimit = notes.length >= MAX_NOTES_PER_SESSION

  function handleTriggerClick() {
    if (notes.length === 0) {
      openNewNote(sessionId)
      return
    }
    setOpen((v) => !v)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <button
          type="button"
          aria-label="Notes"
          title="Notes"
          onClick={handleTriggerClick}
          className="relative shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
        >
          <NotebookPen className="h-4 w-4" aria-hidden="true" />
          {notes.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[10px] leading-none bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]">
              {notes.length}
            </span>
          )}
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 flex w-64 flex-col gap-1 rounded-lg border border-[var(--color-theme-border)] bg-[var(--color-surface)] p-2 shadow-lg"
        >
          <div className="px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
            Notes ({notes.length}/{MAX_NOTES_PER_SESSION})
          </div>
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => {
                openNote(sessionId, note.id)
                setOpen(false)
              }}
              className="flex items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{noteLabel(note)}</span>
                <span className="text-[10px] text-[var(--color-text-secondary)]">
                  {formatSessionTimestamp(note.createdAt)}
                </span>
              </span>
            </button>
          ))}
          <div className="mt-1 border-t border-[var(--color-theme-border)] pt-1">
            {atLimit ? (
              <div className="px-2 py-1.5 text-xs text-[var(--color-text-secondary)]">
                Maximum of {MAX_NOTES_PER_SESSION} notes
              </div>
            ) : (
              <button
                onClick={() => {
                  openNewNote(sessionId)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-[var(--color-theme-accent)] transition-colors hover:bg-[var(--color-surface-alt)]"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                New note
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
```

- [ ] **Step 4: Mount it in `ChatPane`**

In `frontend/src/components/shell/ChatPane.tsx`, add the import:
```ts
import { ChatNotesMenu } from './ChatNotesMenu'
```

In the header row (the `div` with `flex items-center justify-between gap-3 px-4 py-2.5`), insert the menu immediately before the "Report an issue" `<button>`:
```tsx
        <ChatNotesMenu sessionId={session.id} />
        <button
          onClick={() => setReportOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] transition-colors"
        >
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/shell/ChatNotesMenu.test.tsx src/components/shell/ChatPane.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full suite, lint, build**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shell/ChatNotesMenu.tsx frontend/src/components/shell/ChatNotesMenu.test.tsx frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "feat(notes): add the chat-header notes menu

A note icon (with a count badge) in the ChatPane header: 0 notes opens a
fresh draft directly, 1+ notes opens a Radix popover listing them with a
'New note' action that becomes a limit line at 5.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6"
```

---

### Task 8: UI-UX consistency pass

**Files:**
- Possibly modify: `frontend/src/components/shell/NoteEditor.tsx`, `frontend/src/components/shell/ChatNotesMenu.tsx`, `frontend/src/components/shell/SessionsPane.tsx`
- Possibly modify: any of the above test files if an accessible name changes (keep names stable if at all possible)

**Interfaces:**
- Consumes: the finished components from Tasks 4, 6, 7.
- Produces: no API change — only visual/consistency adjustments. Accessible names (`Notes`, `Save`, `Cancel`, `Edit`, `Delete`, `Note text`) must stay the same so the existing tests keep passing.

- [ ] **Step 1: Invoke the UI-UX skill**

Invoke `ui-ux-pro-max` in review/fix mode against the three touch points:
1. the chat-header note trigger + count badge (`ChatNotesMenu`),
2. the note popover list rows,
3. the sidebar indented note rows (`SessionsPane`),
4. the `NoteEditor` header/footer.

Ask it specifically to confirm, against the existing reader shell:
- the lucide glyph choice (`NotebookPen` for the trigger, `StickyNote` for list/sidebar rows, `Plus` for "New note") and icon sizes (`h-4 w-4` for the header control to match `Settings`/`Flag`, `h-3–3.5` for secondary rows),
- that the header control sits correctly relative to the "Report an issue" pill and the mode-label pill (spacing, order, vertical alignment),
- the count-badge size/offset/contrast in all four themes (`scholarly`, `illuminated`, `midnight`, `papyrus`),
- indentation and type scale of the sidebar note rows against the session rows,
- the NoteEditor button hierarchy (primary Save vs secondary Edit/Cancel vs destructive Delete).

- [ ] **Step 2: Apply the recommendations**

Make the concrete class/token adjustments the skill recommends. Constraints: reader-shell tokens only; no admin `ui/` primitives; do not rename any accessible label used by a test; do not change component props or store calls.

- [ ] **Step 3: Manual check in the running app**

Run: `cd frontend && npm run dev`
Verify in the browser, cycling the theme via the Settings popover:
- create a note from the chat header (0-note path) → editor opens with a timestamp header,
- save it → indented row appears under the conversation in the sidebar; badge shows `1`,
- add up to 5 → the header menu shows "Maximum of 5 notes" and the sidebar shows all 5,
- open a note from the sidebar and from the header menu,
- edit → "· edited …" appears; delete → two-click confirm, pane closes,
- narrow the window → the note opens in the Artifact tab and the tab bar switches to it.

- [ ] **Step 4: Full suite, lint, build**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "style(notes): align note icons and layout with the reader shell

Applied ui-ux-pro-max review: glyph/size/placement of the chat-header
notes control and badge, sidebar note-row indentation and type scale,
and NoteEditor button hierarchy, checked across all four themes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EFGFu3Sb1YEY6bo88D8BE6"
```

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| `Note` type; `notes: Note[]` on `Session` | 1 |
| `addNote` / `updateNote` / `deleteNote`; cap of 5; `session.updatedAt` untouched | 1 |
| persist `version` 2→3; `sanitizeNotes` (missing→`[]`, drop malformed, trim to 5); v2 migration | 1 |
| `MAX_NOTES_PER_SESSION` export | 1 |
| `useArtifactStore.activeNote`; `openNote` / `openNewNote`; cleared by `openArtifact` / `goBack` / `close`; mutual exclusion | 2 |
| `noteLabel` first-non-empty-line / "Untitled note" | 3 |
| `NoteEditor`: fixed timestamp header, "· edited", view/edit modes, draft opens in edit, Save-creates-on-first-save, inline two-click Delete, "no longer available", "Empty note." | 4 |
| Draft persisted only on Save; Cancel/close discards | 4 (Cancel), 2+5 (close clears `activeNote`; nothing persisted) |
| `ArtifactPane` renders `NoteEditor` (keyed) and titles pane "Note" | 5 |
| `App` pane visibility + forward for `activeNote`; session-switch guard keeps same-session note | 5 |
| `SessionsPane` indented note rows: first-line label, created time, click selects session + opens note, collapse hides rows, no per-row delete | 6 |
| `ChatNotesMenu`: header icon + count badge; 0 notes → new draft, no menu; ≥1 → popover list + "New note"; limit line at 5; controlled Radix popover via `Anchor` | 7 |
| Mounted left of "Report an issue" in `ChatPane` header | 7 |
| `ui-ux-pro-max` pass for glyph/size/placement consistency across the 4 themes | 8 |
| Frontend-only; no backend | all (no server files touched) |

No gaps.

**2. Placeholder scan**

No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step has literal code. Task 8 is inherently a review task; its steps enumerate the exact review questions and the exact constraints on changes, and it ends with a concrete verification + commit.

**3. Type / name consistency**

- `Note` fields `id` / `createdAt` / `updatedAt` / `body` — identical in Tasks 1, 3, 4, 7.
- `addNote(sessionId, body) => Note | null` — defined Task 1; called with that arity in Task 4 (`addNote(sessionId, draft)`), Task 7 (via `openNewNote`, not `addNote` directly). Consistent.
- `openNote(sessionId, noteId)` / `openNewNote(sessionId)` — defined Task 2; called in Tasks 4, 5 (tests), 6, 7 with matching arity.
- `activeNote` shape `{ sessionId: string; noteId: string }` with `noteId === ''` sentinel — identical across Tasks 2, 4, 5, 6, 7.
- `MAX_NOTES_PER_SESSION` — exported Task 1, imported Task 7. Used numerically as `5` in test copy ("Maximum of 5 notes", "already has 5 notes") consistent with the constant.
- Accessible names (`Notes`, `Save`, `Cancel`, `Edit`, `Delete`, `Note text`, `Click again to confirm`) — introduced in Tasks 4/7, frozen by the Task 8 constraint.
- `noteLabel(note: { body: string })` — signature identical in Tasks 3, 6, 7.
- `formatSessionTimestamp(timestamp: number)` — existing helper, called with `note.createdAt` / `note.updatedAt` (both `number`). Consistent.

No mismatches found.
