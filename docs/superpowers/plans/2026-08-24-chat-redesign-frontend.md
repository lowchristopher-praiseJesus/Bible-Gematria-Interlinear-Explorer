# Chat-Centric Redesign — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-page frontend (`ExplorerPage`/`StrongsPage`/`GematriaPage`/`EnglishPage` + slide-out `ChatSidebar`) with a three-pane chat-first shell (sessions | chat | artifact panel), four selectable study modes, localStorage-persisted sessions, and four switchable visual themes.

**Architecture:** Zustand stores (`useSessionsStore`, `useArtifactStore`, `useThemeStore`) replace `ChatContext`. `App.tsx` collapses to a single-route three-pane layout. The artifact panel fetches on demand from a mix of existing Flask JSON endpoints (`/api/explorer`, `/api/strongs`, `/api/gematria`, `/api/english`) and the backend plan's new FastAPI endpoints (`/api/bible-chat/book_context/{book}`, `/api/bible-chat/parables`, `/api/bible-chat/topics`).

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 (CSS-first `@theme` config, no `tailwind.config.js`), react-router-dom 7, Zustand, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-24-chat-centric-redesign-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-24-chat-redesign-backend.md` — every task in this plan that fetches from `/api/bible-chat/...` assumes that plan is already implemented and the FastAPI backend is mounted and running (`python myproject.py`, per this project's README).

## Global Constraints

- Chat-side verse references are USFM-coded (`"JHN 3:16"`); Flask's `/api/explorer?reference=...` expects a full book name (`"John 3:16"`). Always convert with `usfmToFullRef()` (Task 2) before calling `/api/explorer`.
- Sessions persist to `localStorage` only — no backend session storage, no auth (per spec).
- A session is locked to one mode for its lifetime; switching modes means creating a new session (per spec).
- `BibleChatWidget.tsx`, `components/chatbot/index.ts`, `components/chatbot/types.ts`, `components/chatbot/BibleChatWidget.css`, and `vite.lib.config.ts` are a **separate, independent embeddable-widget build** (see `frontend/vite.lib.config.ts`) — do not modify or delete them in this plan.
- Tailwind v4 has no `tailwind.config.js`; all theme tokens are defined in `src/index.css` via `@theme` and plain CSS custom properties.

---

## Task 1: Test tooling (Vitest + Testing Library)

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/lib/utils.test.ts`

**Interfaces:**
- Produces: `npm run test` (Vitest, jsdom environment, Testing Library `jest-dom` matchers available in every later task's `*.test.tsx`).

- [ ] **Step 1: Install dev dependencies**

Run: `cd frontend && npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`

- [ ] **Step 2: Add the `test` block to `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5000',
      '/LC_': 'http://localhost:5000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
```

- [ ] **Step 3: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Add the `test` script to `package.json`**

In `frontend/package.json`'s `"scripts"` block, add:

```json
"test": "vitest run"
```

- [ ] **Step 5: Write a smoke test**

```ts
// src/lib/utils.test.ts
import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges class names and resolves Tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-sm', false && 'hidden', 'font-bold')).toBe('text-sm font-bold')
  })
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npm run test`
Expected: 1 passed

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/test/setup.ts frontend/src/lib/utils.test.ts
git commit -m "test: add Vitest and Testing Library tooling"
```

---

## Task 2: `lib/usfm.ts` — USFM/full-name reference conversion

**Files:**
- Create: `frontend/src/lib/usfm.ts`
- Test: `frontend/src/lib/usfm.test.ts`

**Interfaces:**
- Produces: `usfmToFullRef(ref: string): string` — converts a USFM-coded reference (`"MAT 20:1"`) to the full-name format Flask's `/api/explorer` expects (`"Matthew 20:1"`); unrecognized codes pass through unchanged. Used by Task 5 (`lib/chatApi.ts`) and Task 7 (`ChatPane`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/usfm.test.ts
import { describe, expect, it } from 'vitest'
import { usfmToFullRef } from './usfm'

describe('usfmToFullRef', () => {
  it('converts a USFM book code + chapter:verse to full name', () => {
    expect(usfmToFullRef('MAT 20:1')).toBe('Matthew 20:1')
    expect(usfmToFullRef('1CO 13:4')).toBe('1 Corinthians 13:4')
  })

  it('passes through references it does not recognize', () => {
    expect(usfmToFullRef('XYZ 1:1')).toBe('XYZ 1:1')
  })

  it('passes through a reference with no chapter:verse', () => {
    expect(usfmToFullRef('MAT')).toBe('MAT')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- usfm`
Expected: FAIL — `Cannot find module './usfm'`

- [ ] **Step 3: Implement `src/lib/usfm.ts`**

Ported from the `USFM_TO_BOOK` map and `usfmToFullRef` function previously in `ChatSidebar.tsx` (which this redesign deletes in Task 10 of this plan).

```ts
const USFM_TO_BOOK: Record<string, string> = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers',
  DEU: 'Deuteronomy', JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth',
  '1SA': '1 Samuel', '2SA': '2 Samuel', '1KI': '1 Kings', '2KI': '2 Kings',
  '1CH': '1 Chronicles', '2CH': '2 Chronicles', EZR: 'Ezra', NEH: 'Nehemiah',
  EST: 'Esther', JOB: 'Job', PSA: 'Psalm', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah',
  LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOL: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah',
  NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah', HAG: 'Haggai',
  ZEC: 'Zechariah', MAL: 'Malachi', MAT: 'Matthew', MRK: 'Mark',
  LUK: 'Luke', JHN: 'John', ACT: 'Acts', ROM: 'Romans',
  '1CO': '1 Corinthians', '2CO': '2 Corinthians', GAL: 'Galatians',
  EPH: 'Ephesians', PHP: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy',
  '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews',
  JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John',
  '2JN': '2 John', '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
}

export function usfmToFullRef(ref: string): string {
  const m = ref.match(/^(\S+)\s+(.+)$/)
  if (!m) return ref
  const fullBook = USFM_TO_BOOK[m[1].toUpperCase()] ?? m[1]
  return `${fullBook} ${m[2]}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- usfm`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/usfm.ts frontend/src/lib/usfm.test.ts
git commit -m "feat: add USFM-to-full-name reference conversion helper"
```

---

## Task 3: Theme system

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/index.css`
- Create: `frontend/src/store/useThemeStore.ts`
- Create: `frontend/src/components/shell/SettingsPanel.tsx`
- Test: `frontend/src/store/useThemeStore.test.ts`
- Test: `frontend/src/components/shell/SettingsPanel.test.tsx`

**Interfaces:**
- Produces: `useThemeStore()` → `{ theme: ThemeId, setTheme: (t: ThemeId) => void }`, persisted to `localStorage` key `bible-explorer-theme`; `ThemeId = 'illuminated' | 'scholarly' | 'midnight' | 'papyrus'`. `<SettingsPanel />` — a popover with one button per theme.

- [ ] **Step 1: Install Zustand**

Run: `cd frontend && npm install zustand`

- [ ] **Step 2: Write the failing store test**

```ts
// src/store/useThemeStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from './useThemeStore'

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: 'scholarly' })
  })

  it('defaults to scholarly', () => {
    expect(useThemeStore.getState().theme).toBe('scholarly')
  })

  it('setTheme updates state and persists to localStorage', () => {
    useThemeStore.getState().setTheme('midnight')
    expect(useThemeStore.getState().theme).toBe('midnight')
    const stored = JSON.parse(localStorage.getItem('bible-explorer-theme') ?? '{}')
    expect(stored.state.theme).toBe('midnight')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm run test -- useThemeStore`
Expected: FAIL — `Cannot find module './useThemeStore'`

- [ ] **Step 4: Implement `src/store/useThemeStore.ts`**

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeId = 'illuminated' | 'scholarly' | 'midnight' | 'papyrus'

interface ThemeState {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'scholarly',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'bible-explorer-theme' }
  )
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test -- useThemeStore`
Expected: 2 passed

- [ ] **Step 6: Add theme tokens to `src/index.css`**

Insert after the existing `@theme { ... }` block (leave `--font-hebrew`, `--font-greek`, `--color-green`, `--color-gold` untouched — those are content-specific, not theme-switched):

```css
@theme {
  --color-surface: var(--surface);
  --color-surface-alt: var(--surface-alt);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-theme-accent: var(--theme-accent);
  --color-theme-accent-contrast: var(--theme-accent-contrast);
  --color-theme-border: var(--theme-border);
}

/* Modern Scholarly — default */
:root,
:root[data-theme='scholarly'] {
  --surface: #ffffff;
  --surface-alt: #f8fafc;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --theme-accent: #4338ca;
  --theme-accent-contrast: #ffffff;
  --theme-border: #e2e8f0;
}

:root[data-theme='illuminated'] {
  --surface: #faf3e6;
  --surface-alt: #f3e6cc;
  --text-primary: #4a3520;
  --text-secondary: #7a5c3a;
  --theme-accent: #5a1f2e;
  --theme-accent-contrast: #f3e6cc;
  --theme-border: #e0cba0;
}

:root[data-theme='midnight'] {
  --surface: #1a1a2e;
  --surface-alt: #16162a;
  --text-primary: #d8d8e8;
  --text-secondary: #8a8aa8;
  --theme-accent: #e8c874;
  --theme-accent-contrast: #1a1a2e;
  --theme-border: #2a2a45;
}

:root[data-theme='papyrus'] {
  --surface: #fdfbf7;
  --surface-alt: #f5efe4;
  --text-primary: #2d2926;
  --text-secondary: #6b5d4f;
  --theme-accent: #a34a2f;
  --theme-accent-contrast: #fdfbf7;
  --theme-border: #e0d3bd;
}
```

Also change the existing `body` rule's hardcoded colors to the new tokens:

```css
body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--color-surface);
  color: var(--color-text-primary);
}
```

- [ ] **Step 7: Write the failing `SettingsPanel` test**

```tsx
// src/components/shell/SettingsPanel.test.tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from './SettingsPanel'
import { useThemeStore } from '@/store/useThemeStore'

describe('SettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: 'scholarly' })
    document.documentElement.removeAttribute('data-theme')
  })

  it('opens and lists all four themes', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('button', { name: /illuminated manuscript/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modern scholarly/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /midnight study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /papyrus editorial/i })).toBeInTheDocument()
  })

  it('selecting a theme updates the store and the document attribute', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    await userEvent.click(screen.getByRole('button', { name: /midnight study/i }))
    expect(useThemeStore.getState().theme).toBe('midnight')
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight')
  })
})
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd frontend && npm run test -- SettingsPanel`
Expected: FAIL — `Cannot find module './SettingsPanel'`

- [ ] **Step 9: Implement `src/components/shell/SettingsPanel.tsx`**

```tsx
import { useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useThemeStore, type ThemeId } from '@/store/useThemeStore'

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'illuminated', label: 'Illuminated Manuscript' },
  { id: 'scholarly', label: 'Modern Scholarly' },
  { id: 'midnight', label: 'Midnight Study' },
  { id: 'papyrus', label: 'Papyrus Editorial' },
]

export function SettingsPanel() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button aria-label="Settings" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          ⚙︎
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-[var(--color-surface)] border border-[var(--color-theme-border)] rounded-lg shadow-lg p-2 flex flex-col gap-1 w-56"
          sideOffset={6}
        >
          <div className="text-xs font-medium text-[var(--color-text-secondary)] px-2 py-1">Theme</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`text-left text-sm px-2 py-1.5 rounded ${
                theme === t.id
                  ? 'bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]'
                  : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-alt)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd frontend && npm run test -- SettingsPanel`
Expected: 2 passed

- [ ] **Step 11: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/index.css frontend/src/store/useThemeStore.ts frontend/src/store/useThemeStore.test.ts frontend/src/components/shell/SettingsPanel.tsx frontend/src/components/shell/SettingsPanel.test.tsx
git commit -m "feat: add four-theme system with a Settings panel switcher"
```

---

## Task 4: Sessions store

**Files:**
- Create: `frontend/src/types/session.ts`
- Create: `frontend/src/store/useSessionsStore.ts`
- Test: `frontend/src/store/useSessionsStore.test.ts`

**Interfaces:**
- Produces: `Session`, `SessionMode`, `ModeParams`, `ArtifactLink`, `SessionMessage` types; `useSessionsStore()` → `{ sessions: Record<string, Session>, activeSessionId: string | null, createSession(mode, modeParams): Session, setActiveSessionId(id): void, appendMessage(sessionId, message): void, updateModeParams(sessionId, patch): void, deleteSession(sessionId): void, listSessions(): Session[] }`. Used by Task 6 (`ModePickerScreen`), Task 7 (`ChatPane`), Task 9 (`SessionsPane`).

- [ ] **Step 1: Write the failing test**

```ts
// src/store/useSessionsStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionsStore } from './useSessionsStore'

describe('useSessionsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })

  it('createSession creates a session with a derived title and sets it active', () => {
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    expect(session.mode).toBe('parable')
    expect(session.modeParams).toEqual({ parableId: 'prodigal_son' })
    expect(session.messages).toEqual([])
    expect(useSessionsStore.getState().activeSessionId).toBe(session.id)
    expect(useSessionsStore.getState().sessions[session.id]).toEqual(session)
  })

  it('appendMessage adds a message and bumps updatedAt', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    const before = useSessionsStore.getState().sessions[session.id].updatedAt
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'user', text: 'hi' })
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0].text).toBe('hi')
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('updateModeParams merges into the existing modeParams', () => {
    const session = useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 0 })
    useSessionsStore.getState().updateModeParams(session.id, { dayIndex: 1, completedDays: [0] })
    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.modeParams).toEqual({ plan: 'chronological', dayIndex: 1, completedDays: [0] })
  })

  it('deleteSession removes it and clears activeSessionId if it was active', () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().deleteSession(session.id)
    expect(useSessionsStore.getState().sessions[session.id]).toBeUndefined()
    expect(useSessionsStore.getState().activeSessionId).toBeNull()
  })

  it('listSessions returns sessions newest-updated first', () => {
    const a = useSessionsStore.getState().createSession('freeform', {})
    const b = useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().appendMessage(a.id, { id: 'm1', role: 'user', text: 'later' })
    const list = useSessionsStore.getState().listSessions()
    expect(list[0].id).toBe(a.id)
    expect(list[1].id).toBe(b.id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- useSessionsStore`
Expected: FAIL — `Cannot find module './useSessionsStore'`

- [ ] **Step 3: Implement `src/types/session.ts`**

```ts
import type { ChatMessage } from '@/components/chatbot/types'

export type SessionMode = 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform'

export interface ModeParams {
  plan?: 'chronological' | 'canonical'
  dayIndex?: number
  completedDays?: number[]
  parableId?: string
  topicId?: string
  reference?: string
}

export interface ArtifactLink {
  type: 'interlinear' | 'strongs' | 'book_context' | 'gematria' | 'english_search'
  label: string
  params: Record<string, unknown>
}

export interface SessionMessage extends ChatMessage {
  artifacts?: ArtifactLink[]
}

export interface Session {
  id: string
  createdAt: number
  updatedAt: number
  mode: SessionMode
  modeParams: ModeParams
  title: string
  messages: SessionMessage[]
}
```

- [ ] **Step 4: Implement `src/store/useSessionsStore.ts`**

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModeParams, Session, SessionMessage, SessionMode } from '@/types/session'

interface SessionsState {
  sessions: Record<string, Session>
  activeSessionId: string | null
  createSession: (mode: SessionMode, modeParams: ModeParams) => Session
  setActiveSessionId: (id: string | null) => void
  appendMessage: (sessionId: string, message: SessionMessage) => void
  updateModeParams: (sessionId: string, patch: Partial<ModeParams>) => void
  deleteSession: (sessionId: string) => void
  listSessions: () => Session[]
}

const MODE_LABELS: Record<SessionMode, string> = {
  reading_plan: 'Bible in a Year',
  parable: 'Parable Study',
  verse: 'Verse of the Day',
  topic: 'Topical Study',
  freeform: 'Ask Anything',
}

function deriveTitle(mode: SessionMode, modeParams: ModeParams): string {
  if (mode === 'reading_plan') return `Bible in a Year — ${modeParams.plan === 'canonical' ? 'Canonical' : 'Chronological'}`
  if (mode === 'parable' && modeParams.parableId) return `Parable Study — ${modeParams.parableId.replace(/_/g, ' ')}`
  if (mode === 'topic' && modeParams.topicId) return `Topical Study — ${modeParams.topicId.replace(/_/g, ' ')}`
  return MODE_LABELS[mode]
}

let idCounter = 0
function genId(): string {
  return `session-${Date.now()}-${++idCounter}`
}

export const useSessionsStore = create<SessionsState>()(
  persist(
    (set, get) => ({
      sessions: {},
      activeSessionId: null,

      createSession: (mode, modeParams) => {
        const now = Date.now()
        const session: Session = {
          id: genId(),
          createdAt: now,
          updatedAt: now,
          mode,
          modeParams,
          title: deriveTitle(mode, modeParams),
          messages: [],
        }
        set((state) => ({
          sessions: { ...state.sessions, [session.id]: session },
          activeSessionId: session.id,
        }))
        return session
      },

      setActiveSessionId: (id) => set({ activeSessionId: id }),

      appendMessage: (sessionId, message) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                messages: [...existing.messages, message],
                updatedAt: Date.now(),
              },
            },
          }
        }),

      updateModeParams: (sessionId, patch) =>
        set((state) => {
          const existing = state.sessions[sessionId]
          if (!existing) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                modeParams: { ...existing.modeParams, ...patch },
                updatedAt: Date.now(),
              },
            },
          }
        }),

      deleteSession: (sessionId) =>
        set((state) => {
          const { [sessionId]: _removed, ...rest } = state.sessions
          return {
            sessions: rest,
            activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
          }
        }),

      listSessions: () => Object.values(get().sessions).sort((a, b) => b.updatedAt - a.updatedAt),
    }),
    { name: 'bible-explorer-sessions' }
  )
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test -- useSessionsStore`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/store/useSessionsStore.ts frontend/src/store/useSessionsStore.test.ts
git commit -m "feat: add localStorage-backed sessions store"
```

---

## Task 5: API client and artifact store

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/lib/chatApi.ts`
- Create: `frontend/src/store/useArtifactStore.ts`
- Test: `frontend/src/lib/chatApi.test.ts`
- Test: `frontend/src/store/useArtifactStore.test.ts`

**Interfaces:**
- Consumes: `usfmToFullRef` (Task 2), `ArtifactLink` (Task 4).
- Produces: `postChat(payload)`, `fetchInterlinear(reference)`, `fetchStrongsEntry(id)`, `fetchBookContext(book)`, `fetchGematria(value)`, `fetchEnglishSearch(query)` (all `lib/chatApi.ts`, all `async`); `useArtifactStore()` → `{ activeArtifact: ArtifactLink | null, status: 'idle' | 'loading' | 'ready' | 'error', data: unknown, error: string | null, openArtifact(link: ArtifactLink): Promise<void>, close(): void }`. Used by Task 7 (`ChatPane`) and Task 8 (`ArtifactPane`).

- [ ] **Step 1: Add `BookContextResponse` to `src/types/api.ts`**

Append to `frontend/src/types/api.ts`:

```ts
export interface BookContextResponse {
  book: string
  book_name: string
  sections: Record<string, string | null>
}
```

- [ ] **Step 2: Write the failing `chatApi` test**

```ts
// src/lib/chatApi.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBookContext,
  fetchEnglishSearch,
  fetchGematria,
  fetchInterlinear,
  fetchStrongsEntry,
  postChat,
} from './chatApi'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
  )
}

describe('chatApi', () => {
  it('postChat posts to /api/bible-chat/chat', async () => {
    mockFetchOnce({ type: 'chat', message: 'hi' })
    const result = await postChat({ message: 'hello' })
    expect(result.message).toBe('hi')
    expect(fetch).toHaveBeenCalledWith(
      '/api/bible-chat/chat',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('fetchInterlinear converts USFM reference to full name before calling /api/explorer', async () => {
    mockFetchOnce({ verse: { ref: 'Matthew 6:28' } })
    await fetchInterlinear('MAT 6:28')
    expect(fetch).toHaveBeenCalledWith('/api/explorer?reference=Matthew%206%3A28')
  })

  it('fetchStrongsEntry calls /api/strongs', async () => {
    mockFetchOnce({ definition: null, verses: [], resultSummary: 'No results' })
    await fetchStrongsEntry('G26')
    expect(fetch).toHaveBeenCalledWith('/api/strongs?strongsnumber=G26')
  })

  it('fetchBookContext calls the bible-chat book_context endpoint', async () => {
    mockFetchOnce({ book: 'MAT', book_name: 'Matthew', sections: {} })
    await fetchBookContext('MAT')
    expect(fetch).toHaveBeenCalledWith('/api/bible-chat/book_context/MAT')
  })

  it('fetchGematria calls /api/gematria', async () => {
    mockFetchOnce({ wordResults: [], verseResults: [], strongsDefinitions: {}, resultSummaryWords: '', resultSummaryVerses: '' })
    await fetchGematria(777)
    expect(fetch).toHaveBeenCalledWith('/api/gematria?value=777')
  })

  it('fetchEnglishSearch calls /api/english', async () => {
    mockFetchOnce({ searchTerm: 'love', results: [], resultSummary: 'No results' })
    await fetchEnglishSearch('love')
    expect(fetch).toHaveBeenCalledWith('/api/english?words=love')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm run test -- chatApi`
Expected: FAIL — `Cannot find module './chatApi'`

- [ ] **Step 4: Implement `src/lib/chatApi.ts`**

```ts
import { usfmToFullRef } from './usfm'
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
} from '@/types/api'

const CHAT_API = '/api/bible-chat'

interface ChatPayload {
  message: string
  history?: { role: 'user' | 'assistant'; text: string }[]
  page_context?: string
  mode?: string
  mode_params?: Record<string, unknown>
}

interface ChatApiResponse {
  type: string
  message: string
  data?: Record<string, unknown> | null
  route?: string
  follow_up_questions?: string[]
  artifacts?: { type: string; label: string; params: Record<string, unknown> }[]
}

export async function postChat(payload: ChatPayload): Promise<ChatApiResponse> {
  const res = await fetch(`${CHAT_API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function fetchInterlinear(reference: string): Promise<ExplorerResponse> {
  const res = await fetch(`/api/explorer?reference=${encodeURIComponent(usfmToFullRef(reference))}`)
  return res.json()
}

export async function fetchStrongsEntry(id: string): Promise<StrongsResponse> {
  const res = await fetch(`/api/strongs?strongsnumber=${encodeURIComponent(id)}`)
  return res.json()
}

export async function fetchBookContext(book: string): Promise<BookContextResponse> {
  const res = await fetch(`${CHAT_API}/book_context/${encodeURIComponent(book)}`)
  return res.json()
}

export async function fetchGematria(value: number): Promise<GematriaResponse> {
  const res = await fetch(`/api/gematria?value=${value}`)
  return res.json()
}

export async function fetchEnglishSearch(query: string): Promise<EnglishResponse> {
  const res = await fetch(`/api/english?words=${encodeURIComponent(query)}`)
  return res.json()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test -- chatApi`
Expected: 6 passed

- [ ] **Step 6: Write the failing `useArtifactStore` test**

```ts
// src/store/useArtifactStore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtifactStore } from './useArtifactStore'
import * as chatApi from '@/lib/chatApi'

describe('useArtifactStore', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('openArtifact sets loading then ready with fetched data for a strongs link', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({
      definition: null,
      verses: [],
      resultSummary: 'No results',
    })
    const link = { type: 'strongs' as const, label: "Strong's ▸", params: { id: 'G26' } }
    const promise = useArtifactStore.getState().openArtifact(link)
    expect(useArtifactStore.getState().status).toBe('loading')
    await promise
    expect(useArtifactStore.getState().status).toBe('ready')
    expect(useArtifactStore.getState().activeArtifact).toEqual(link)
  })

  it('openArtifact sets an error state when the fetch throws', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockRejectedValue(new Error('network down'))
    const link = { type: 'strongs' as const, label: "Strong's ▸", params: { id: 'G26' } }
    await useArtifactStore.getState().openArtifact(link)
    expect(useArtifactStore.getState().status).toBe('error')
    expect(useArtifactStore.getState().error).toBe('network down')
  })

  it('close resets to idle', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    await useArtifactStore.getState().openArtifact({ type: 'strongs', label: '', params: { id: 'G26' } })
    useArtifactStore.getState().close()
    expect(useArtifactStore.getState().status).toBe('idle')
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npm run test -- useArtifactStore`
Expected: FAIL — `Cannot find module './useArtifactStore'`

- [ ] **Step 8: Implement `src/store/useArtifactStore.ts`**

```ts
import { create } from 'zustand'
import {
  fetchBookContext,
  fetchEnglishSearch,
  fetchGematria,
  fetchInterlinear,
  fetchStrongsEntry,
} from '@/lib/chatApi'
import type { ArtifactLink } from '@/types/session'

type ArtifactStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ArtifactState {
  activeArtifact: ArtifactLink | null
  status: ArtifactStatus
  data: unknown
  error: string | null
  openArtifact: (link: ArtifactLink) => Promise<void>
  close: () => void
}

async function fetchForLink(link: ArtifactLink): Promise<unknown> {
  switch (link.type) {
    case 'interlinear':
      return fetchInterlinear(link.params.reference as string)
    case 'strongs':
      return fetchStrongsEntry(link.params.id as string)
    case 'book_context':
      return fetchBookContext(link.params.book as string)
    case 'gematria':
      return fetchGematria(link.params.value as number)
    case 'english_search':
      return fetchEnglishSearch(link.params.query as string)
    default:
      throw new Error(`Unknown artifact type: ${link.type}`)
  }
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  activeArtifact: null,
  status: 'idle',
  data: null,
  error: null,

  openArtifact: async (link) => {
    set({ activeArtifact: link, status: 'loading', data: null, error: null })
    try {
      const data = await fetchForLink(link)
      set({ status: 'ready', data })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  close: () => set({ activeArtifact: null, status: 'idle', data: null, error: null }),
}))
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npm run test -- useArtifactStore`
Expected: 3 passed

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/lib/chatApi.ts frontend/src/lib/chatApi.test.ts frontend/src/store/useArtifactStore.ts frontend/src/store/useArtifactStore.test.ts
git commit -m "feat: add chat API client and artifact store"
```

---

## Task 6: `ModePickerScreen`

**Files:**
- Create: `frontend/src/lib/modeData.ts`
- Create: `frontend/src/components/shell/ModePickerScreen.tsx`
- Test: `frontend/src/components/shell/ModePickerScreen.test.tsx`

**Interfaces:**
- Consumes: `useSessionsStore` (Task 4), `postChat` (Task 5).
- Produces: `<ModePickerScreen onSessionStarted={(sessionId: string) => void} />` — renders mode cards; for `reading_plan` shows a chronological/canonical sub-choice; for `parable`/`topic` fetches `/api/bible-chat/parables` / `/api/bible-chat/topics` and shows the curated list; for `verse` shows "Surprise me" and a reference input. Selecting a final option creates a session (`useSessionsStore.createSession`), calls `postChat({ message: '', mode, mode_params })` to seed the primer turn, appends the primer response as the first `SessionMessage`, then calls `onSessionStarted`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/ModePickerScreen.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModePickerScreen } from './ModePickerScreen'
import { useSessionsStore } from '@/store/useSessionsStore'
import * as chatApi from '@/lib/chatApi'

describe('ModePickerScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows all four mode cards plus Ask Anything', () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    expect(screen.getByRole('button', { name: /bible in a year/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /parable study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /verse of the day/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /topical study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ask anything/i })).toBeInTheDocument()
  })

  it('selecting Ask Anything creates a freeform session immediately', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    expect(onSessionStarted).toHaveBeenCalled()
    const sessions = Object.values(useSessionsStore.getState().sessions)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].mode).toBe('freeform')
    expect(sessions[0].messages[0].text).toBe('Ask me anything.')
  })

  it('selecting Bible in a Year requires a chronological/canonical sub-choice', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Day 1' })
    const onSessionStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
    await userEvent.click(screen.getByRole('button', { name: /bible in a year/i }))
    expect(screen.getByRole('button', { name: /chronological/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /canonical/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /chronological/i }))
    expect(onSessionStarted).toHaveBeenCalled()
    const sessions = Object.values(useSessionsStore.getState().sessions)
    expect(sessions[0].modeParams).toEqual({ plan: 'chronological', dayIndex: 0, completedDays: [] })
  })

  it('selecting Parable Study fetches and lists curated parables', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ parables: [{ id: 'prodigal_son', name: 'The Prodigal Son', reference: 'Luke 15:11-32' }] }),
    } as Response)
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /parable study/i }))
    expect(await screen.findByRole('button', { name: /the prodigal son/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- ModePickerScreen`
Expected: FAIL — `Cannot find module './ModePickerScreen'`

- [ ] **Step 3: Implement `src/lib/modeData.ts`**

```ts
export interface ParableEntry {
  id: string
  name: string
  reference: string
}

export interface TopicEntry {
  id: string
  name: string
  seed_references: string[]
}

export async function listParables(): Promise<ParableEntry[]> {
  const res = await fetch('/api/bible-chat/parables')
  const body = await res.json()
  return body.parables
}

export async function listTopics(): Promise<TopicEntry[]> {
  const res = await fetch('/api/bible-chat/topics')
  const body = await res.json()
  return body.topics
}
```

- [ ] **Step 4: Implement `src/components/shell/ModePickerScreen.tsx`**

```tsx
import { useState } from 'react'
import { postChat } from '@/lib/chatApi'
import { listParables, listTopics, type ParableEntry, type TopicEntry } from '@/lib/modeData'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { ModeParams, SessionMessage, SessionMode } from '@/types/session'

interface Props {
  onSessionStarted: (sessionId: string) => void
}

type Screen = 'root' | 'reading_plan' | 'parable' | 'topic' | 'verse'

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

export function ModePickerScreen({ onSessionStarted }: Props) {
  const [screen, setScreen] = useState<Screen>('root')
  const [parables, setParables] = useState<ParableEntry[] | null>(null)
  const [topics, setTopics] = useState<TopicEntry[] | null>(null)
  const [verseRef, setVerseRef] = useState('')
  const createSession = useSessionsStore((s) => s.createSession)
  const appendMessage = useSessionsStore((s) => s.appendMessage)

  async function startSession(mode: SessionMode, modeParams: ModeParams) {
    const session = createSession(mode, modeParams)
    const response = await postChat({ message: '', mode, mode_params: modeParams })
    const message: SessionMessage = {
      id: genId(),
      role: 'assistant',
      text: response.message,
      type: response.type,
      data: response.data ?? undefined,
      artifacts: response.artifacts,
      followUpQuestions: response.follow_up_questions,
    }
    appendMessage(session.id, message)
    onSessionStarted(session.id)
  }

  if (screen === 'reading_plan') {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold">Bible in a Year</h2>
        <button
          className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
          onClick={() => startSession('reading_plan', { plan: 'chronological', dayIndex: 0, completedDays: [] })}
        >
          Chronological
        </button>
        <button
          className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
          onClick={() => startSession('reading_plan', { plan: 'canonical', dayIndex: 0, completedDays: [] })}
        >
          Canonical (book order)
        </button>
      </div>
    )
  }

  if (screen === 'parable') {
    if (!parables) {
      listParables().then(setParables)
      return <div className="p-6 text-[var(--color-text-secondary)]">Loading parables…</div>
    }
    return (
      <div className="flex flex-col gap-2 p-6 max-h-[70vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-2">Parable Study</h2>
        {parables.map((p) => (
          <button
            key={p.id}
            className="text-left px-4 py-2 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
            onClick={() => startSession('parable', { parableId: p.id })}
          >
            {p.name} <span className="text-[var(--color-text-secondary)] text-sm">({p.reference})</span>
          </button>
        ))}
      </div>
    )
  }

  if (screen === 'topic') {
    if (!topics) {
      listTopics().then(setTopics)
      return <div className="p-6 text-[var(--color-text-secondary)]">Loading topics…</div>
    }
    return (
      <div className="flex flex-col gap-2 p-6 max-h-[70vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-2">Topical Study</h2>
        {topics.map((t) => (
          <button
            key={t.id}
            className="text-left px-4 py-2 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
            onClick={() => startSession('topic', { topicId: t.id })}
          >
            {t.name}
          </button>
        ))}
      </div>
    )
  }

  if (screen === 'verse') {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold">Verse of the Day</h2>
        <button
          className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
          onClick={() => startSession('verse', {})}
        >
          Surprise me
        </button>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (verseRef.trim()) startSession('verse', { reference: verseRef.trim() })
          }}
        >
          <input
            value={verseRef}
            onChange={(e) => setVerseRef(e.target.value)}
            placeholder="e.g. John 3:16"
            className="flex-1 border border-[var(--color-theme-border)] rounded px-3 py-2"
          />
          <button type="submit" className="px-4 py-2 rounded bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]">
            Go
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-semibold">Start a new session</h2>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => setScreen('reading_plan')}
      >
        Bible in a Year
      </button>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => setScreen('parable')}
      >
        Parable Study
      </button>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => setScreen('verse')}
      >
        Verse of the Day
      </button>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => setScreen('topic')}
      >
        Topical Study
      </button>
      <button
        className="text-left px-4 py-3 rounded border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        onClick={() => startSession('freeform', {})}
      >
        Ask Anything
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test -- ModePickerScreen`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/modeData.ts frontend/src/components/shell/ModePickerScreen.tsx frontend/src/components/shell/ModePickerScreen.test.tsx
git commit -m "feat: add mode picker screen"
```

---

## Task 7: `ChatPane`

**Files:**
- Create: `frontend/src/components/shell/ChatPane.tsx`
- Test: `frontend/src/components/shell/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `useSessionsStore` (Task 4), `useArtifactStore` (Task 5), `postChat` (Task 5).
- Produces: `<ChatPane sessionId={string} />` — renders the active session's messages as compact bubbles with artifact-link chips, an input box, and (for `reading_plan` sessions) a "Mark day complete" action on the latest reading-plan message.

**Note:** `ChatSidebar.tsx` and `ChatContext.tsx` are not deleted in this task even though `ChatPane` supersedes them — `App.tsx` still imports both until Task 10 rewrites it, so deleting them here would leave the app unbuildable between this task and Task 10. Task 10 deletes them alongside the old page routes, at the point where `App.tsx` actually stops referencing them.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/ChatPane.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPane } from './ChatPane'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import * as chatApi from '@/lib/chatApi'

describe('ChatPane', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('shows a "Mark day complete" action for reading_plan sessions', () => {
    const session = useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 0, completedDays: [] })
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Day 1 reading' })

    render(<ChatPane sessionId={session.id} />)
    expect(screen.getByRole('button', { name: /mark day complete/i })).toBeInTheDocument()
  })

  it('marking a day complete advances dayIndex and records it', async () => {
    const session = useSessionsStore.getState().createSession('reading_plan', { plan: 'chronological', dayIndex: 2, completedDays: [0, 1] })
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'assistant', text: 'Day 3 reading' })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.click(screen.getByRole('button', { name: /mark day complete/i }))

    const updated = useSessionsStore.getState().sessions[session.id]
    expect(updated.modeParams.completedDays).toEqual([0, 1, 2])
    expect(updated.modeParams.dayIndex).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- ChatPane`
Expected: FAIL — `Cannot find module './ChatPane'`

- [ ] **Step 3: Implement `src/components/shell/ChatPane.tsx`**

```tsx
import { useCallback, useState } from 'react'
import { postChat } from '@/lib/chatApi'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { ArtifactLink, SessionMessage } from '@/types/session'

interface Props {
  sessionId: string
}

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

export function ChatPane({ sessionId }: Props) {
  const session = useSessionsStore((s) => s.sessions[sessionId])
  const appendMessage = useSessionsStore((s) => s.appendMessage)
  const updateModeParams = useSessionsStore((s) => s.updateModeParams)
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !session) return
      const history = session.messages.slice(-6).map((m) => ({ role: m.role, text: m.text }))
      const userMessage: SessionMessage = { id: genId(), role: 'user', text }
      appendMessage(sessionId, userMessage)
      setInput('')
      setLoading(true)
      try {
        const response = await postChat({ message: text, history, mode: session.mode, mode_params: session.modeParams })
        appendMessage(sessionId, {
          id: genId(),
          role: 'assistant',
          text: response.message,
          type: response.type,
          data: response.data ?? undefined,
          artifacts: response.artifacts,
          followUpQuestions: response.follow_up_questions,
        })
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, appendMessage]
  )

  const markDayComplete = useCallback(() => {
    if (!session) return
    const dayIndex = session.modeParams.dayIndex ?? 0
    const completedDays = [...(session.modeParams.completedDays ?? []), dayIndex]
    updateModeParams(sessionId, { dayIndex: dayIndex + 1, completedDays })
  }, [session, sessionId, updateModeParams])

  if (!session) return null

  const lastMessage = session.messages[session.messages.length - 1]
  const showMarkComplete = session.mode === 'reading_plan' && !!lastMessage

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {session.messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] rounded-br-sm'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text-primary)] rounded-bl-sm'
              }`}
            >
              {msg.text}
              {msg.artifacts && msg.artifacts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.artifacts.map((link: ArtifactLink, i: number) => (
                    <button
                      key={i}
                      onClick={() => openArtifact(link)}
                      className="text-xs px-2 py-1 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface)]"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {showMarkComplete && (
          <button
            onClick={markDayComplete}
            className="self-start text-xs px-3 py-1.5 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]"
          >
            Mark day complete
          </button>
        )}
      </div>
      <form
        className="flex gap-2 p-3 border-t border-[var(--color-theme-border)]"
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a verse..."
          className="flex-1 border border-[var(--color-theme-border)] rounded-full px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- ChatPane`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "feat: add ChatPane with compact bubbles, artifact links, and reading-plan progress"
```

---

## Task 8: Artifact panel

**Files:**
- Create: `frontend/src/components/artifacts/InterlinearArtifact.tsx`
- Create: `frontend/src/components/artifacts/StrongsArtifact.tsx`
- Create: `frontend/src/components/artifacts/BookContextArtifact.tsx`
- Create: `frontend/src/components/artifacts/GematriaArtifact.tsx`
- Create: `frontend/src/components/artifacts/EnglishSearchArtifact.tsx`
- Create: `frontend/src/components/shell/ArtifactPane.tsx`
- Test: `frontend/src/components/shell/ArtifactPane.test.tsx`

**Interfaces:**
- Consumes: `useArtifactStore` (Task 5), `ExplorerResponse`/`StrongsResponse`/`GematriaResponse`/`EnglishResponse`/`BookContextResponse` (`types/api.ts`).
- Produces: `<ArtifactPane />` — renders the idle/loading/error states, then dispatches to the matching artifact component by `activeArtifact.type`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/ArtifactPane.test.tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ArtifactPane } from './ArtifactPane'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { ExplorerResponse, StrongsResponse } from '@/types/api'

const explorerFixture: ExplorerResponse = {
  verse: {
    id: 1, ref: 'Genesis 1:1', bnum: 1, cnum: 1, vnum: 1, Ch: '', wordnum: 0, letternum: 0,
    total: 2701, text1769: 'In the beginning...', textAV1611: 'In the beginning...',
    language: 'Hebrew', originalText: '', stephanusText: null, stephanusTotal: null,
    lcFiles: ['gen001.jpg'], hasQere: false, code: null, alert: null,
  },
  navigation: { previous: 31102, next: 2 },
  kjvWords: [],
  originalWords: [],
  strongsDefinitions: {},
}

const strongsFixture: StrongsResponse = {
  definition: {
    strongsNumber: 'G26', root: 'ἀγάπη', transliteration: 'agape', transliteration1: 'agape',
    transliteration2: 'agape', partOfSpeech: 'Noun', meaning: 'love', strongsDefinition: 'love',
    outline: null, note: null, usageCount: 100, verseCount: 90, bookCount: 20, value: 6,
  },
  verses: [],
  resultSummary: '90 verses found in 20 books',
}

describe('ArtifactPane', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

  it('shows an empty state when nothing is active', () => {
    render(<ArtifactPane />)
    expect(screen.getByText(/click a link in the chat/i)).toBeInTheDocument()
  })

  it('shows a loading state', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'strongs', label: '', params: {} }, status: 'loading' })
    render(<ArtifactPane />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows an error state', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'strongs', label: '', params: {} }, status: 'error', error: 'network down' })
    render(<ArtifactPane />)
    expect(screen.getByText(/network down/i)).toBeInTheDocument()
  })

  it('renders the interlinear artifact when ready', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'interlinear', label: '', params: {} }, status: 'ready', data: explorerFixture })
    render(<ArtifactPane />)
    expect(screen.getByText('Genesis 1:1')).toBeInTheDocument()
  })

  it('renders the strongs artifact when ready', () => {
    useArtifactStore.setState({ activeArtifact: { type: 'strongs', label: '', params: {} }, status: 'ready', data: strongsFixture })
    render(<ArtifactPane />)
    expect(screen.getByText('G26')).toBeInTheDocument()
    expect(screen.getByText('love')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- ArtifactPane`
Expected: FAIL — `Cannot find module './ArtifactPane'`

- [ ] **Step 3: Implement `src/components/artifacts/InterlinearArtifact.tsx`**

```tsx
import { useState } from 'react'
import type { ExplorerResponse } from '@/types/api'

interface Props {
  data: ExplorerResponse
}

export function InterlinearArtifact({ data }: Props) {
  const [tab, setTab] = useState<'text' | 'manuscript'>('text')
  const { verse, kjvWords, originalWords } = data

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">{verse.ref}</div>
      <div className="flex gap-1 border-b border-[var(--color-theme-border)]">
        <button
          onClick={() => setTab('text')}
          className={`text-xs px-3 py-1.5 ${tab === 'text' ? 'border-b-2 border-[var(--color-theme-accent)] font-medium' : 'text-[var(--color-text-secondary)]'}`}
        >
          Text
        </button>
        <button
          onClick={() => setTab('manuscript')}
          className={`text-xs px-3 py-1.5 ${tab === 'manuscript' ? 'border-b-2 border-[var(--color-theme-accent)] font-medium' : 'text-[var(--color-text-secondary)]'}`}
        >
          Manuscript
        </button>
      </div>

      {tab === 'text' && (
        <div className="flex flex-col gap-3">
          <div
            className="text-lg leading-loose"
            style={{
              fontFamily: verse.language === 'Hebrew' ? 'TaameyFrank, serif' : 'inherit',
              direction: verse.language === 'Hebrew' ? 'rtl' : 'ltr',
            }}
            dangerouslySetInnerHTML={{ __html: verse.originalText }}
          />
          <div className="flex flex-col gap-1">
            {kjvWords.map((w, i) => (
              <div key={i} className="flex items-baseline gap-2 text-xs border-b border-[var(--color-theme-border)] pb-1">
                <span className="font-mono px-1 rounded bg-[var(--color-surface-alt)]">{w.strongsNumber}</span>
                <span
                  dangerouslySetInnerHTML={{
                    __html: w.kjvText.replace(/<st SN="[^"]*">/g, '').replace(/<\/st>/g, ''),
                  }}
                />
              </div>
            ))}
          </div>
          {originalWords.length === 0 && kjvWords.length === 0 && (
            <div className="text-xs text-[var(--color-text-secondary)] italic">No word-level data for this verse.</div>
          )}
        </div>
      )}

      {tab === 'manuscript' && (
        <div className="flex flex-col gap-2">
          {verse.lcFiles.length === 0 ? (
            <div className="text-xs text-[var(--color-text-secondary)] italic">No manuscript images for this verse.</div>
          ) : (
            verse.lcFiles.map((f, i) => (
              <img key={i} src={`/LC_/${f}`} alt={`Leningrad Codex page ${i + 1} for ${verse.ref}`} className="rounded border border-[var(--color-theme-border)]" />
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Implement `src/components/artifacts/StrongsArtifact.tsx`**

```tsx
import type { StrongsResponse } from '@/types/api'

interface Props {
  data: StrongsResponse
}

export function StrongsArtifact({ data }: Props) {
  const { definition, verses, resultSummary } = data
  if (!definition) {
    return <div className="text-sm text-[var(--color-text-secondary)] italic">{resultSummary}</div>
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold">{definition.strongsNumber}</div>
      <div className="text-lg">{definition.root}</div>
      <div className="text-xs text-[var(--color-text-secondary)]">{definition.transliteration1} — {definition.partOfSpeech}</div>
      <div className="text-sm font-medium">{definition.meaning}</div>
      <div className="text-sm" dangerouslySetInnerHTML={{ __html: definition.strongsDefinition }} />
      <div className="text-xs text-[var(--color-text-secondary)]">{resultSummary}</div>
      <div className="flex flex-col gap-1 mt-2">
        {verses.map((group) => (
          <div key={group.book} className="text-xs">
            <span className="font-medium">{group.book}</span>: {group.refs.map((r) => r.ref).join(', ')}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Implement `src/components/artifacts/BookContextArtifact.tsx`**

```tsx
import type { BookContextResponse } from '@/types/api'

interface Props {
  data: BookContextResponse
}

const SECTION_LABELS: Record<string, string> = {
  historical_setting: 'Historical Setting',
  cultural_background: 'Cultural Background',
  author_and_audience: 'Author & Audience',
  literary_context: 'Literary Context',
  genre_and_style: 'Genre & Style',
  language_and_translation: 'Language & Translation',
  theological_themes: 'Theological Themes',
  immediate_purpose: 'Immediate Purpose',
}

export function BookContextArtifact({ data }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">{data.book_name} — Book Context</div>
      {Object.entries(data.sections)
        .filter(([, value]) => value)
        .map(([key, value]) => (
          <div key={key}>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              {SECTION_LABELS[key] ?? key}
            </div>
            <div className="text-sm mt-0.5">{value}</div>
          </div>
        ))}
    </div>
  )
}
```

- [ ] **Step 6: Implement `src/components/artifacts/GematriaArtifact.tsx`**

```tsx
import type { GematriaResponse } from '@/types/api'

interface Props {
  data: GematriaResponse
}

export function GematriaArtifact({ data }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">Gematria Results</div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummaryWords}</div>
        <div className="flex flex-col gap-1 mt-1">
          {data.wordResults.map((w, i) => (
            <div key={i} className="text-xs flex items-center gap-2">
              <span className="font-mono">{w.strongsNumber}</span>
              <span>{w.ref}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummaryVerses}</div>
        <div className="flex flex-col gap-1 mt-1">
          {data.verseResults.map((v, i) => (
            <div key={i} className="text-xs">{v.ref}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Implement `src/components/artifacts/EnglishSearchArtifact.tsx`**

```tsx
import type { EnglishResponse } from '@/types/api'

interface Props {
  data: EnglishResponse
}

export function EnglishSearchArtifact({ data }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{data.resultSummary}</div>
      {data.results.map((r, i) => (
        <div key={i} className="text-sm">
          <span className="font-medium">{r.ref}</span>: {r.text}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 8: Implement `src/components/shell/ArtifactPane.tsx`**

```tsx
import { useArtifactStore } from '@/store/useArtifactStore'
import { BookContextArtifact } from '@/components/artifacts/BookContextArtifact'
import { EnglishSearchArtifact } from '@/components/artifacts/EnglishSearchArtifact'
import { GematriaArtifact } from '@/components/artifacts/GematriaArtifact'
import { InterlinearArtifact } from '@/components/artifacts/InterlinearArtifact'
import { StrongsArtifact } from '@/components/artifacts/StrongsArtifact'
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
} from '@/types/api'

export function ArtifactPane() {
  const { activeArtifact, status, data, error } = useArtifactStore()

  return (
    <div className="h-full overflow-y-auto p-4">
      {status === 'idle' && (
        <div className="text-sm text-[var(--color-text-secondary)] italic">
          Click a link in the chat to see details here.
        </div>
      )}
      {status === 'loading' && <div className="text-sm text-[var(--color-text-secondary)]">Loading…</div>}
      {status === 'error' && <div className="text-sm text-red-600">{error}</div>}
      {status === 'ready' && activeArtifact && data && (
        <>
          {activeArtifact.type === 'interlinear' && <InterlinearArtifact data={data as ExplorerResponse} />}
          {activeArtifact.type === 'strongs' && <StrongsArtifact data={data as StrongsResponse} />}
          {activeArtifact.type === 'book_context' && <BookContextArtifact data={data as BookContextResponse} />}
          {activeArtifact.type === 'gematria' && <GematriaArtifact data={data as GematriaResponse} />}
          {activeArtifact.type === 'english_search' && <EnglishSearchArtifact data={data as EnglishResponse} />}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npm run test -- ArtifactPane`
Expected: 5 passed

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/artifacts frontend/src/components/shell/ArtifactPane.tsx frontend/src/components/shell/ArtifactPane.test.tsx
git commit -m "feat: add artifact panel with interlinear/strongs/book-context/gematria/english-search views"
```

---

## Task 9: `SessionsPane`

**Files:**
- Create: `frontend/src/components/shell/SessionsPane.tsx`
- Test: `frontend/src/components/shell/SessionsPane.test.tsx`

**Interfaces:**
- Consumes: `useSessionsStore` (Task 4).
- Produces: `<SessionsPane onSelectSession={(id: string) => void} onNewSession={() => void} activeSessionId={string | null} />` — lists sessions newest-first with delete buttons, a "+ New session" button.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/SessionsPane.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsPane } from './SessionsPane'
import { useSessionsStore } from '@/store/useSessionsStore'

describe('SessionsPane', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })

  it('lists sessions and calls onSelectSession when clicked', async () => {
    const session = useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    const onSelectSession = vi.fn()
    render(<SessionsPane activeSessionId={null} onSelectSession={onSelectSession} onNewSession={() => {}} />)
    await userEvent.click(screen.getByText(session.title))
    expect(onSelectSession).toHaveBeenCalledWith(session.id)
  })

  it('calls onNewSession when the new-session button is clicked', async () => {
    const onNewSession = vi.fn()
    render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={onNewSession} />)
    await userEvent.click(screen.getByRole('button', { name: /new session/i }))
    expect(onNewSession).toHaveBeenCalled()
  })

  it('deletes a session when its delete button is clicked', async () => {
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<SessionsPane activeSessionId={session.id} onSelectSession={() => {}} onNewSession={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /delete session/i }))
    expect(useSessionsStore.getState().sessions[session.id]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- SessionsPane`
Expected: FAIL — `Cannot find module './SessionsPane'`

- [ ] **Step 3: Implement `src/components/shell/SessionsPane.tsx`**

```tsx
import { useSessionsStore } from '@/store/useSessionsStore'

interface Props {
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
}

export function SessionsPane({ activeSessionId, onSelectSession, onNewSession }: Props) {
  const listSessions = useSessionsStore((s) => s.listSessions)
  const deleteSession = useSessionsStore((s) => s.deleteSession)
  const sessions = listSessions()

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[var(--color-theme-border)]">
        <button
          onClick={onNewSession}
          className="w-full text-sm px-3 py-2 rounded bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]"
        >
          + New session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`flex items-center justify-between px-3 py-2 cursor-pointer text-sm ${
              session.id === activeSessionId ? 'bg-[var(--color-surface-alt)] font-medium' : 'hover:bg-[var(--color-surface-alt)]'
            }`}
            onClick={() => onSelectSession(session.id)}
          >
            <span className="truncate">{session.title}</span>
            <button
              aria-label="Delete session"
              onClick={(e) => {
                e.stopPropagation()
                deleteSession(session.id)
              }}
              className="text-[var(--color-text-secondary)] hover:text-red-600 shrink-0 ml-2"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- SessionsPane`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/SessionsPane.tsx frontend/src/components/shell/SessionsPane.test.tsx
git commit -m "feat: add sessions list pane"
```

---

## Task 10: App shell assembly

**Files:**
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/pages/ExplorerPage.tsx`
- Delete: `frontend/src/pages/StrongsPage.tsx`
- Delete: `frontend/src/pages/GematriaPage.tsx`
- Delete: `frontend/src/pages/EnglishPage.tsx`
- Delete: `frontend/src/components/layout/AppLayout.tsx`
- Delete: `frontend/src/components/chatbot/ChatSidebar.tsx`
- Delete: `frontend/src/context/ChatContext.tsx`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `SessionsPane` (Task 9), `ModePickerScreen` (Task 6), `ChatPane` (Task 7), `ArtifactPane` (Task 8), `SettingsPanel` (Task 3), `useSessionsStore` (Task 4).
- Produces: the final `<App />` — single route `/`, `?session=<id>` query param, three-pane layout when a session is active, mode picker when not.

- [ ] **Step 1: Write the failing test**

```tsx
// src/App.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { useSessionsStore } from '@/store/useSessionsStore'
import * as chatApi from '@/lib/chatApi'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    window.history.pushState({}, '', '/')
  })

  it('shows the mode picker when there is no active session', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /ask anything/i })).toBeInTheDocument()
  })

  it('starting a session switches to the three-pane chat layout', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    expect(await screen.findByText('Ask me anything.')).toBeInTheDocument()
    expect(screen.getByText(/click a link in the chat/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- App.test`
Expected: FAIL — mode picker / three-pane assertions fail against the current route-switcher `App.tsx`

- [ ] **Step 3: Rewrite `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { ModePickerScreen } from '@/components/shell/ModePickerScreen'
import { ChatPane } from '@/components/shell/ChatPane'
import { ArtifactPane } from '@/components/shell/ArtifactPane'
import { SessionsPane } from '@/components/shell/SessionsPane'
import { SettingsPanel } from '@/components/shell/SettingsPanel'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useThemeStore } from '@/store/useThemeStore'

function useSessionIdParam(): [string | null, (id: string | null) => void] {
  const [sessionId, setSessionIdState] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('session')
  )

  function setSessionId(id: string | null) {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('session', id)
    else url.searchParams.delete('session')
    window.history.pushState({}, '', url)
    setSessionIdState(id)
  }

  return [sessionId, setSessionId]
}

export default function App() {
  const theme = useThemeStore((s) => s.theme)
  const [sessionId, setSessionId] = useSessionIdParam()
  const sessions = useSessionsStore((s) => s.sessions)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const activeSession = sessionId ? sessions[sessionId] : undefined

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <div className="w-64 shrink-0 border-r border-[var(--color-theme-border)] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-theme-border)]">
          <span className="font-semibold text-sm">Bible Explorer</span>
          <SettingsPanel />
        </div>
        <div className="flex-1 min-h-0">
          <SessionsPane
            activeSessionId={sessionId}
            onSelectSession={setSessionId}
            onNewSession={() => setSessionId(null)}
          />
        </div>
      </div>

      <div className="flex-1 min-w-0 border-r border-[var(--color-theme-border)]">
        {activeSession ? (
          <ChatPane sessionId={activeSession.id} />
        ) : (
          <ModePickerScreen onSessionStarted={setSessionId} />
        )}
      </div>

      <div className="w-96 shrink-0">
        <ArtifactPane />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- App.test`
Expected: 2 passed

- [ ] **Step 5: Delete superseded page components, layout, and the old chat sidebar**

```bash
git rm frontend/src/pages/ExplorerPage.tsx frontend/src/pages/StrongsPage.tsx frontend/src/pages/GematriaPage.tsx frontend/src/pages/EnglishPage.tsx frontend/src/components/layout/AppLayout.tsx frontend/src/components/chatbot/ChatSidebar.tsx frontend/src/context/ChatContext.tsx
```

`components/chatbot/{BibleChatWidget.tsx,index.ts,types.ts,BibleChatWidget.css}` are **not** touched — they're the separate embeddable-widget build (see Global Constraints).

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npm run test`
Expected: all tests passed (Tasks 1–10 combined)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat: assemble three-pane app shell; remove superseded page routes"
```

---

## Task 11: Cleanup and manual verification

**Files:**
- Delete (conditionally, see Step 1): `frontend/src/components/explorer/*`
- Delete: `frontend/src/hooks/usePreference.ts` (if Step 1 confirms it's unused)

**Interfaces:** none — this task only removes now-dead code and manually verifies the running app.

- [ ] **Step 1: Check whether the old `components/explorer/*` files and `usePreference` are still referenced**

Run: `cd frontend && grep -rln "components/explorer\|hooks/usePreference" src --include="*.tsx" --include="*.ts" | grep -v "src/components/explorer/\|src/hooks/usePreference.ts"`

If this prints nothing, every one of `InfoBox.tsx`, `KJVInterlinearTable.tsx`, `OriginalInterlinearTable.tsx`, `SearchForms.tsx`, `VerseDisplay.tsx`, and `usePreference.ts` is dead code (fully superseded by Tasks 6–10's new components) — delete them:

```bash
git rm -r frontend/src/components/explorer frontend/src/hooks/usePreference.ts
```

If the grep prints any file, stop and inspect it — something still depends on the old components and they should not be deleted yet.

- [ ] **Step 2: Type-check and build**

Run: `cd frontend && npm run build`
Expected: builds successfully with no TypeScript errors

- [ ] **Step 3: Run the full test suite one more time**

Run: `cd frontend && npm run test`
Expected: all tests passed

- [ ] **Step 4: Manual verification in the browser**

Start both backends (`python myproject.py` for Flask + the mounted FastAPI chatbot, per this project's existing run instructions) and the frontend dev server (`cd frontend && npm run dev`), then in a browser:

1. Confirm the mode picker appears with no active session.
2. Start a **Bible in a Year** session (try both Chronological and Canonical) — confirm the primer message shows Day 1's reading and a "Mark day complete" button that advances the day.
3. Start a **Parable Study** session — confirm the curated list loads and picking one seeds a primer about that parable.
4. Start a **Verse of the Day** session both ways — "Surprise me" and a typed reference (e.g. `John 3:16`).
5. Start a **Topical Study** session — confirm the topic list loads and seed references appear as artifact links.
6. Start an **Ask Anything** session and send a freeform message.
7. From any session, click an artifact link (verse/Strong's/book context) and confirm it opens in the right-hand panel; for a verse's interlinear artifact, confirm the **Manuscript** tab shows the Leningrad Codex image(s).
8. Open **Settings** and switch through all four themes; confirm the whole shell (sessions pane, chat bubbles, artifact panel) re-colors correctly in each, and that the choice survives a page reload.
9. Create two or more sessions, confirm they're listed newest-first in the left pane, switching between them restores their message history, and deleting one removes it from the list.
10. Refresh the browser mid-session and confirm the session and its messages are still there (localStorage persistence).

Report any visual or functional issues found during this pass before considering the redesign complete.

- [ ] **Step 5: Commit** (only if Step 1 resulted in deletions)

```bash
git add -u
git commit -m "chore: remove explorer-page components superseded by the artifact panel"
```

---

## Self-Review Notes

- **Spec coverage:** three-pane app shell (Task 10), sessions in localStorage (Task 4), four modes + mode picker (Task 6), compact chat bubbles with artifact links (Task 7), reading-plan "Mark day complete" progress (Task 7), artifact panel with all five artifact types (Task 8), gematria/English search reachable only as chat tools rather than dedicated modes (Task 5's `fetchGematria`/`fetchEnglishSearch` are only ever invoked via `ArtifactLink`s the chat backend returns, never from a standalone search UI), four switchable themes persisted across reload (Task 3), sessions pane with new/select/delete (Task 9) — every frontend item in the spec has a task.
- **Documented deviation — Manuscript tab:** the spec's design phase assumed `InfoBox.tsx` contained image-viewing logic to reuse for the interlinear artifact's "Manuscript" tab. Reading the actual code (`InfoBox.tsx`) during planning showed it only renders Strong's definitions — the old `ExplorerPage` displayed Leningrad Codex pages as plain new-tab links (`<a href="/LC_/{f}">`), not an inline viewer. Task 8's `InterlinearArtifact` Manuscript tab therefore renders `<img>` tags directly (an actual inline viewer, improving on the old link-only behavior) rather than reusing nonexistent `InfoBox` viewer logic.
- **Documented deviation — gematria/English-search fetch path:** per the backend plan's Task 4 note, the artifact panel fetches gematria and English-search results from Flask's existing `/api/gematria` and `/api/english` (not new FastAPI routes) — Task 5's `chatApi.ts` reflects this.
- **Type consistency checked:** `ArtifactLink`/`SessionMessage`/`Session` (Task 4) are used with the same shape in Tasks 5–10; `ChatApiResponse.artifacts` (Task 5) matches the backend plan's `ArtifactLink` schema field-for-field (`type`, `label`, `params`); `useArtifactStore`'s `ArtifactLink['type']` switch (Task 5) covers exactly the five types Task 8 implements components for.
