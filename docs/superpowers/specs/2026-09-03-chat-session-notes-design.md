# Chat Session Notes Design Spec

**Date:** 2026-09-03
**Status:** Approved for planning

## Purpose

Let a user attach their own written notes to a chat session. A note icon in
the chat window opens an empty note in the right-hand artifact pane, with a
fixed date/time header; the user writes their thoughts and presses **Save**.
Saved notes appear in the left sidebar as indented rows beneath the
conversation they belong to (like a sub-folder), and are reachable again from
a menu on the chat-window note icon. A conversation may hold **at most 5**
notes.

This is a **frontend-only** feature. Sessions are already persisted entirely
in `localStorage` via `useSessionsStore` (Zustand `persist`); notes ride the
same mechanism. No Flask, FastAPI, or database change.

## Scope

**In scope:**

- A `Note` type (`id`, `createdAt`, `updatedAt`, `body`) and a `notes: Note[]`
  array on each `Session`, capped at 5, ordered by creation.
- `addNote` / `updateNote` / `deleteNote` actions on `useSessionsStore`, plus
  a persist `version` bump (2 → 3) and sanitisation so malformed or
  over-length `notes` in stored state are normalised rather than crashing.
- A second display mode on `useArtifactStore` (`activeNote`) so the existing
  right-hand pane can render a note editor instead of a fetched artifact.
- A new `NoteEditor` component (fixed timestamp header, view/edit modes,
  explicit Save, inline-confirm Delete).
- A new `ChatNotesMenu` component in the `ChatPane` header: a note icon with
  a count badge that either creates the first note directly (0 notes) or
  opens a popover listing existing notes plus a "New note" action (≥1 note),
  disabled at 5.
- Indented note rows under each session in `SessionsPane`, labelled by the
  note's first non-empty line via a new `lib/noteLabel.ts` helper.
- `App.tsx` wiring so the right pane shows for `activeNote` as well as
  `activeArtifact`, on both desktop and narrow viewports.
- Unit/component tests for the store changes, `noteLabel`, `NoteEditor`,
  `ChatNotesMenu`, `SessionsPane` note rows, and the `ArtifactPane` branch.
- A `ui-ux-pro-max` pass during implementation to finalise the note icon
  (lucide glyph), its size, and its header position so it reads
  consistently with the existing `Flag` ("Report an issue") and `Settings`
  controls.

**Out of scope:**

- Note search, filtering, reordering, or pinning.
- Markdown / rich-text rendering inside a note — the body is plain text.
- Exporting, copying, or sharing notes; printing.
- Standalone notes not attached to a session; notes attached to an
  individual message rather than the whole conversation.
- Any server-side storage or sync of notes — they live only in the
  browser's `localStorage`, exactly like the sessions themselves.
- Raising or making configurable the 5-note limit.
- Undo for a deleted note (deletion is guarded by an inline confirm; that is
  the whole safety net).

## Architecture Overview

Notes are per-session data with the same lifecycle as their session, so they
are stored **on the `Session` object** in `useSessionsStore`. Deleting a
session (`deleteSession`) or clearing all history (`clearAllSessions`)
already drops the whole session object, so notes are removed with it — no
extra cleanup code, no orphans.

The right-hand pane is owned by `useArtifactStore` and rendered by
`ArtifactPane`. That store models *read-only fetched artifacts*
(`status` / `data` / `error` / `history`). Rather than pretend a note is a
fetched artifact, the store gains one explicit extra field, `activeNote`,
that is mutually exclusive with `activeArtifact`. `ArtifactPane` renders
`<NoteEditor>` when `activeNote` is set, otherwise its existing artifact
switch. The editor's draft/dirty state stays local to `NoteEditor` and never
enters the artifact store.

**A new note is written to `useSessionsStore` only on the first Save.** While
being drafted it exists solely as local state in `NoteEditor`, keyed in the
artifact store by a sentinel (`activeNote.noteId === ''`). Abandoning a draft
(Cancel, closing the pane, switching session) therefore needs no cleanup, and
`SessionsPane` only ever lists saved notes.

## Data Model

`frontend/src/types/session.ts`:

```ts
export interface Note {
  id: string
  createdAt: number   // epoch ms; drives the fixed header timestamp
  updatedAt: number   // epoch ms; === createdAt until first edit
  body: string        // plain text, may contain newlines
}

export interface Session {
  // ...existing fields unchanged...
  notes: Note[]        // creation order, length 0..5
}
```

- Note ids use the same `session-`/`msg-`-style generator pattern already in
  the codebase: `note-${Date.now()}-${++counter}`.
- `notes` is always present on a `Session` produced by `createSession`
  (initialised to `[]`).

## Store Changes

### `useSessionsStore.ts`

New actions (all no-op if `sessionId` is unknown, matching the existing
actions):

- **`addNote(sessionId: string, body: string): Note | null`**
  Returns `null` if `session.notes.length >= 5`. Otherwise creates
  `{ id, createdAt: now, updatedAt: now, body }`, appends it, and returns it.
  Does **not** change `session.updatedAt` — note-taking must not reorder the
  sidebar.
- **`updateNote(sessionId: string, noteId: string, body: string): void`**
  Replaces `body` and sets `updatedAt = Date.now()` on the matching note.
  Does not change `session.updatedAt`.
- **`deleteNote(sessionId: string, noteId: string): void`**
  Removes the matching note from the array.

`createSession` sets `notes: []` on the new session object.

### Persistence & sanitisation

- Bump `persist` `version` from `2` to `3`.
- `isValidSession` stays lenient — it does **not** require `notes` (an old
  session object without the field is still valid and usable).
- `sanitizeSessions` (called from both `migrate` and `merge`, so it runs on
  every hydration) is extended to normalise each session's `notes`:
  - missing / not an array → `[]`
  - drop any entry that is not an object with a string `id` and string
    `body`; coerce missing `createdAt` / `updatedAt` to `Date.now()`
  - if more than 5 valid entries survive, keep the first 5 (creation order)
- This mirrors the existing defensive posture (the comment in the store
  explains a real past incident where a bad write corrupted stored state);
  hand-edited or half-written `localStorage` must not crash `SessionsPane`
  or `ChatPane`.

### `useArtifactStore.ts`

New state:

```ts
activeNote: { sessionId: string; noteId: string } | null   // noteId === '' => unsaved draft
```

New / changed actions:

- **`openNote(sessionId: string, noteId: string): void`**
  Sets `activeNote = { sessionId, noteId }`; clears `activeArtifact`,
  `history`, `data`, `error`; sets `status = 'idle'`.
- **`openNewNote(sessionId: string): void`**
  Same as `openNote` with `noteId = ''`.
- **`openArtifact`** and **`goBack`**: additionally clear `activeNote` (so
  opening any artifact link supersedes a note, matching how they already
  supersede each other).
- **`close`**: additionally clear `activeNote`.

`activeArtifact` and `activeNote` are never both non-null.

## Components

### `NoteEditor.tsx` (new — `frontend/src/components/shell/`)

Props: `{ sessionId: string; noteId: string }` (`noteId === ''` ⇒ draft).

Reads the note (when `noteId` is set) from `useSessionsStore`. If the
referenced note no longer exists (e.g. deleted in another tab), it renders a
short "This note is no longer available." message with nothing else.

Local state: `mode: 'view' | 'edit'`, `draft: string`, `confirmingDelete: boolean`.

- **Header row (never editable):** note icon + a timestamp from
  `formatSessionTimestamp(note.createdAt)` → e.g. `Today, 2:15 PM`. When
  `updatedAt > createdAt`, a faint `· edited {formatSessionTimestamp(updatedAt)}`
  is appended. For a draft, the header shows the current time
  (`formatSessionTimestamp(Date.now())` captured once on mount).
- **Body:**
  - `view` mode → a `whitespace-pre-wrap` text block; empty body shows a
    faint "Empty note." placeholder.
  - `edit` mode → an auto-growing `<textarea>` bound to `draft`, focused on
    mount, themed with the same `var(--color-theme-*)` tokens and rounded
    border used by the `ChatPane` input.
- **Footer buttons:**
  - Draft (`noteId === ''`): starts in `edit` mode. **Save** → `addNote(sessionId, draft)`;
    on success, `openNote(sessionId, newNote.id)` and `mode = 'view'`. If
    `addNote` returns `null` (already 5 — shouldn't happen because the entry
    points gate it, but defended anyway), show an inline
    "This conversation already has 5 notes." and keep the draft. **Cancel** →
    `useArtifactStore.getState().close()`.
  - Saved, `view` mode: **Edit** → `draft = note.body`, `mode = 'edit'`.
    **Delete** → first click sets `confirmingDelete` and relabels to
    "Click again to confirm" (with a Cancel affordance), second click calls
    `deleteNote` then `close()`. Same interaction pattern as
    `SettingsPanel`'s clear-all, so no new dialog dependency.
  - Saved, `edit` mode: **Save** → `updateNote(sessionId, noteId, draft)`,
    `mode = 'view'`. **Cancel** → discard `draft`, `mode = 'view'`.

Primary button styling matches the accent pill buttons already in the shell;
Delete uses the same `text-red-600` treatment as `SettingsPanel` /
`SessionsPane`'s delete control.

### `ChatNotesMenu.tsx` (new — `frontend/src/components/shell/`)

Props: `{ sessionId: string }`. Reads `session.notes` from `useSessionsStore`.

Rendered in the `ChatPane` header, to the left of the "Report an issue"
button. A note icon button; when `notes.length > 0` a small count badge is
shown on it. Uses a **controlled** Radix `Popover` (same primitive and
styling as `SettingsPanel`):

- **0 notes:** the trigger's `onClick` calls
  `useArtifactStore.getState().openNewNote(sessionId)` directly and does
  **not** open the popover.
- **≥1 note:** the popover opens with:
  - a scrollable list of note rows — note icon + first-line label
    (`noteLabel(note)`) + faint `formatSessionTimestamp(note.createdAt)`;
    clicking a row calls `openNote(sessionId, note.id)` and closes the
    popover.
  - a footer **"New note"** button → `openNewNote(sessionId)` + close popover.
    When `notes.length >= 5` it is replaced by a muted, non-interactive
    "Maximum of 5 notes" line.

On narrow viewports, `openNote` / `openNewNote` bringing `activeNote` into
existence pulls the artifact pane forward via the `App.tsx` effect (below).

### `SessionsPane.tsx` (edit)

Within each session's block, after the session row, render one indented row
per `session.notes` entry:

- deeper left padding than the session row (sub-folder look), smaller text
- a note icon, then `noteLabel(note)` truncated to one line
- faint `formatSessionTimestamp(note.createdAt)` as secondary text, matching
  the session row's timestamp treatment
- click → if `session.id !== activeSessionId`, call `onSelectSession(session.id)`;
  then `useArtifactStore.getState().openNote(session.id, note.id)`

No per-row delete control in the sidebar — deletion is done from
`NoteEditor`, keeping a single confirm surface. Collapsing a mode section
(existing behaviour) also hides that section's note rows, since they are
nested inside the session rows it hides.

### `noteLabel.ts` (new — `frontend/src/lib/`)

```ts
export function noteLabel(note: { body: string }): string
```

Returns the first non-empty, trimmed line of `note.body`; if the body is
empty or whitespace-only, returns `"Untitled note"`. No truncation here —
callers truncate with CSS (`truncate`) so the full text stays available to
assistive tech and `title`.

### `App.tsx` (edit)

- The right-pane wrapper is shown at the `lg` breakpoint when
  `activeArtifact || activeNote` (currently only `activeArtifact`).
- The "bring the artifact pane forward on narrow viewports" effect
  additionally depends on `activeNote` and fires when it becomes non-null.
- The session-switch effect currently calls `useArtifactStore.getState().close()`
  on every `sessionId` change. Guard it so it does **not** close when the
  current `activeNote.sessionId === sessionId` — otherwise a cross-session
  note click from the sidebar (which selects the session, then opens the
  note) would be closed by this effect on the same render. Opening a note
  for the already-active session is unaffected either way.

## Data Flow

**Create the first note from the chat window**
1. User clicks the note icon in the `ChatPane` header; `session.notes` is empty.
2. `ChatNotesMenu` calls `openNewNote(sessionId)` → `activeNote = { sessionId, noteId: '' }`.
3. `App.tsx` shows the right pane (and, on narrow viewports, brings it forward).
4. `ArtifactPane` renders `<NoteEditor sessionId noteId="">` in `edit` mode with an empty `draft` and a header timestamp of "now".
5. User types, clicks **Save** → `addNote(sessionId, draft)` appends a `Note`; editor calls `openNote(sessionId, newNote.id)` and switches to `view` mode.
6. `SessionsPane` re-renders and now shows an indented row under that session.

**Reopen a saved note**
- From the sidebar row → `openNote`; or from the `ChatNotesMenu` popover list → `openNote`. `ArtifactPane` renders `<NoteEditor>` in `view` mode.

**Edit / delete**
- **Edit** → **Save** calls `updateNote`, bumps the note's `updatedAt`; the header gains "· edited …".
- **Delete** (two-click confirm) calls `deleteNote` then `close()`; the pane empties and the sidebar row disappears.

**Session deletion / clear-all**
- `deleteSession` / `clearAllSessions` are unchanged; the session object (with its `notes`) is dropped. `close()` is already called in those paths, clearing any `activeNote`.

## Error / Edge Handling

- **Cap reached:** every entry point that can create a note checks
  `session.notes.length >= 5` and disables/replaces the "New note" affordance;
  `addNote` also returns `null` as a backstop and `NoteEditor` shows an
  inline message.
- **Draft abandoned:** Cancel, the pane's close button, switching session, or
  selecting another artifact all just clear `activeNote`; nothing was
  persisted, so there is nothing to clean up.
- **Note deleted in another tab:** `NoteEditor` resolves the note from the
  store on each render; a missing note renders "This note is no longer
  available." `SessionsPane` / `ChatNotesMenu` naturally stop listing it.
- **Corrupt persisted `notes`:** normalised by `sanitizeSessions` on
  hydration (missing array → `[]`, bad entries dropped, > 5 trimmed).
- **Migration from `version: 2`:** `migrate` runs `sanitizePersistedState`,
  which yields sessions with `notes: []`.
- **Empty note saved:** allowed; it shows as "Untitled note" in lists and
  "Empty note." in the editor. (No forced validation — a user may want a
  placeholder to fill later, within the 5-note budget.)

## Testing Strategy

Vitest + Testing Library, matching existing test files.

- **`useSessionsStore.test.ts`**: `addNote` appends and returns the note;
  `addNote` returns `null` and does not mutate at 5; `updateNote` changes
  `body` + `updatedAt` only; `deleteNote` removes; note actions leave
  `session.updatedAt` untouched; `createSession` yields `notes: []`;
  persist round-trip keeps notes; `sanitizeSessions` coerces missing array,
  drops malformed entries, trims to 5; a `version: 2` blob migrates to
  `notes: []`.
- **`useArtifactStore.test.ts`**: `openNote` / `openNewNote` set `activeNote`
  and clear `activeArtifact` + `history`; `openArtifact` and `goBack` clear
  `activeNote`; `close` clears `activeNote`.
- **`noteLabel.test.ts`**: first non-empty line; leading blank lines skipped;
  whitespace-only and empty → "Untitled note"; single-line body returned
  as-is (trimmed).
- **`NoteEditor.test.tsx`**: draft opens in edit mode; Save calls `addNote`
  and flips to view; Cancel on a draft calls `close`; Edit → Save on a saved
  note calls `updateNote`; Delete requires a second click, then calls
  `deleteNote` and `close`; a non-existent `noteId` renders the unavailable
  message.
- **`ChatNotesMenu.test.tsx`**: 0 notes → click calls `openNewNote`, no
  popover; ≥1 note → popover lists notes and a row click calls `openNote`;
  "New note" calls `openNewNote`; at 5 notes the "New note" action is absent
  / shows the limit line; count badge reflects `notes.length`.
- **`SessionsPane.test.tsx`**: indented note rows render under their session;
  a row click opens the note in the artifact store (and selects the session
  when it isn't active); collapsing the mode section hides the note rows.
- **`ArtifactPane.test.tsx`**: renders `<NoteEditor>` when `activeNote` is
  set and the artifact switch when it isn't.

## Files

**New**

- `frontend/src/components/shell/NoteEditor.tsx` + `.test.tsx`
- `frontend/src/components/shell/ChatNotesMenu.tsx` + `.test.tsx`
- `frontend/src/lib/noteLabel.ts` + `.test.ts`

**Edited**

- `frontend/src/types/session.ts` — `Note` interface, `notes` on `Session`
- `frontend/src/store/useSessionsStore.ts` — `addNote` / `updateNote` /
  `deleteNote`, `createSession` init, `version` 3, `sanitizeSessions` notes
  normalisation
- `frontend/src/store/useArtifactStore.ts` — `activeNote`, `openNote`,
  `openNewNote`, clears in `openArtifact` / `goBack` / `close`
- `frontend/src/components/shell/ArtifactPane.tsx` — `NoteEditor` branch
- `frontend/src/components/shell/SessionsPane.tsx` — indented note rows
- `frontend/src/components/shell/ChatPane.tsx` — mount `ChatNotesMenu` in the
  header
- `frontend/src/App.tsx` — right-pane visibility + pane-forward effect +
  session-switch close guard

## Implementation Notes

- Run **`ui-ux-pro-max`** before finalising `ChatNotesMenu` / `NoteEditor`
  visuals to choose the lucide glyph (candidates: `NotebookPen` for the
  action trigger, `StickyNote` for list and sidebar rows), icon sizing, the
  count-badge treatment, and the exact header slot so the control lines up
  with `Flag` and `Settings`.
- Follow the reader-shell styling convention (plain Tailwind +
  `var(--color-theme-*)` + inline `lucide-react`), **not** the admin `ui/`
  primitives, which are scoped to `/admin`.
- Keep `ChatPane.tsx` from growing further — the notes trigger goes in as a
  small self-contained `ChatNotesMenu`, not inline JSX.
