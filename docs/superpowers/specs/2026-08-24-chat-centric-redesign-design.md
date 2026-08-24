# Chat-Centric Interface Redesign — Design Spec

**Date:** 2026-08-24
**Status:** Approved for planning

## Purpose

Replace the current multi-page app (Explorer / Strong's / Gematria / English search, with a slide-out chat widget) with a chat-first interface: a three-pane shell (session history | chat | artifact panel) where a chatbot drives Bible study through selectable modes, and all deep-dive content (interlinear text, Strong's entries, gematria/English search results, book context) is surfaced as "artifacts" opened from links in the conversation.

## Scope

**In scope:**
- Full frontend redesign: new app shell, session persistence, mode system, artifact panel, theming.
- Backend (`chatbot/` FastAPI sub-app) extensions: mode-aware chat, gematria/English-search as chat-callable tools, static reading-plan/parable/topic data.
- Retiring the old page-based frontend routes (`ExplorerPage`, `StrongsPage`, `GematriaPage`, `EnglishPage`, `AppLayout`) in favor of the new shell.

**Out of scope:**
- User accounts / authentication / cross-device sync (sessions are per-browser via localStorage).
- Retiring or migrating the Flask app (`myproject.py`) itself — it keeps running to serve `LC_/` manuscript images; its HTML-rendering routes simply become unused by the new frontend.
- Backend persistence of sessions (no new SQLite tables for chat history).

## Architecture — App Shell

`App.tsx` collapses from a route-switcher + slide-out chat to a single-route three-pane shell:

```
┌─────────────┬───────────────────────────┬──────────────────┐
│  Sessions    │   Chat (mode-primed)      │  Artifact Panel  │
│  (left)      │   (center)                │  (right)         │
│              │                           │                  │
│  + New       │  [mode picker OR          │  Empty state, or │
│  session     │   message thread]         │  interlinear /   │
│  list...     │                           │  Strong's /      │
│  ...         │  [input box]              │  search results  │
└─────────────┴───────────────────────────┴──────────────────┘
```

- Single route `/` plus `?session=<id>` query param so a session is bookmarkable/shareable within that browser.
- Three panes are all visible simultaneously on desktop. On narrow viewports, panes collapse to one visible at a time with a tab/back affordance (sessions ↔ chat ↔ artifact).
- All four old routes (`/explorer`, `/strongs`, `/gematria`, `/english`) and their page components are deleted; their functionality is absorbed into the artifact panel and chat tools.

## Frontend State Management

Replace `ChatContext.tsx` (React Context) with **Zustand** stores. Rationale: state here is heavily cross-cutting — any chat message can trigger the artifact panel from deep in the render tree, session switching must reset chat + artifact state together, and theme must be readable everywhere. A single store (or small set of stores) avoids provider nesting and prop drilling that Context would require for this shape of state.

- `useSessionsStore` — sessions list, active session, CRUD, localStorage sync.
- `useArtifactStore` — active artifact link, fetch/loading state.
- `useThemeStore` — current theme id, persisted.

## Sessions & Modes

**Data model** (localStorage key `bible-explorer-sessions`):

```ts
interface Session {
  id: string
  createdAt: number
  updatedAt: number
  mode: 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform'
  modeParams: {
    plan?: 'chronological' | 'canonical'   // reading_plan
    dayIndex?: number                       // reading_plan progress (current day)
    completedDays?: number[]                // reading_plan progress (for streak display)
    parableId?: string                      // parable
    topicId?: string                        // topic
    reference?: string                      // verse (if user-specified rather than random)
  }
  title: string          // derived, e.g. "Parable Study — The Prodigal Son"
  messages: ChatMessage[]
}
```

Reading-plan progress lives inside the session record itself (not a separate global store), since a user could run more than one reading-plan session (e.g. a fresh canonical read-through after finishing chronological).

**Modes** (locked per session — switching modes starts a new session):

1. **Bible in a Year** — sub-mode choice of **Chronological** or **Canonical** (book order) reading plan. No M'Cheyne option.
2. **Parable Study** — user picks from a curated list of the recognized parables.
3. **Verse of the Day** — user chooses "Surprise me" (random) or specifies a reference.
4. **Topical Study** — user picks from a curated, progressively-growing list of topics (e.g. "biblical holiness").
5. **Ask anything** (freeform) — implicit fifth option, no structured mode.

**New-session flow:** "+ New session" shows a mode-picker screen in the center pane (cards for the 4 modes + reading-plan sub-choice + "Ask anything"). Selecting a mode creates the `Session` record with `mode`/`modeParams` set, then sends an initial primer request to `/chat` so the assistant opens with mode-appropriate content (today's reading, the chosen parable's text, etc.) before the user types anything.

## Chat Pane

Chat bubbles stay compact — the earlier `VerseCard`/`StudyCard`/`StrongsCard` inline-detail rendering is replaced with lightweight bubbles plus artifact links:

- **Verse content**: reference, active-translation text, a translation switcher, and links `[Greek/Hebrew ▸]` `[Strong's ▸]` `[Book Context ▸]` that open the artifact panel.
- **Word-by-word commentary** (previously `StudyCard`'s accordion): a single `[Word Analysis ▸]` link per verse.
- **Strong's mentions**: an inline chip (e.g. `G2657 katamanthanō`) that opens the full entry in the panel on click.
- Follow-up question chips are unchanged.

Each artifact link carries minimal fetch metadata on the `ChatMessage` (e.g. `{type: 'strongs', id: 'G2657'}`, `{type: 'interlinear', reference: 'MAT 6:28'}`, `{type: 'book_context', book: 'Matthew'}`). Clicking sets `useArtifactStore`'s active artifact; the panel fetches independently (fetch-on-demand, not embedded in the message payload).

**Reading-plan mode specifics:** each assistant turn presenting the day's passage includes a "Mark day complete" action (updates `dayIndex`/`completedDays` on the session) alongside the normal per-word artifact links.

## Artifact Panel

Redesigned, compact, single-artifact-at-a-time components (not reused from the old pages):

| Type | Content |
|---|---|
| `interlinear` | Original-language word row + English gloss row for the requested verse (condensed from `KJVInterlinearTable`/`OriginalInterlinearTable`), plus a secondary **"Manuscript"** tab reusing the existing `InfoBox` image-viewer logic (Leningrad Codex page images, qere/ketiv toggle) |
| `strongs` | Lemma, transliteration, definition, occurrence count |
| `book_context` | The existing 8-section book-context accordion, ported as-is |
| `gematria` | Numeric-value search results (word/verse list) — replaces `GematriaPage` |
| `english_search` | KJV text search results list — replaces `EnglishPage` |

Panel shows an idle empty state ("Click a link in the chat to see details here") when nothing is active, and a loading skeleton while fetching. Only one artifact is shown at a time — switching sessions or clicking a new link replaces the current artifact, no stacking/history within the panel.

Gematria and English full-text search are **not** modes — they're available as chat tools the assistant can invoke from a freeform question (e.g. "find verses with gematria value 777"), surfaced as artifact links like any other tool result.

## Theming

Four presets, built from the mockups reviewed during brainstorming:

1. **Illuminated Manuscript** — warm parchment, deep burgundy, gold accents, serif type.
2. **Modern Scholarly** — clean white/gray, deep indigo accent, sans-serif.
3. **Midnight Study** — dark mode, charcoal/navy with warm amber text.
4. **Papyrus Editorial** — warm off-white paper, terracotta accent, serif scripture + sans UI.

Implemented as CSS custom-property sets switched via `data-theme="..."` on `<html>`. Tailwind config maps semantic tokens (`bg-surface`, `text-primary`, `accent`, etc.) to `var(--...)` rather than hardcoded colors, so no component hardcodes a palette. Switching happens from a Settings panel (gear icon in the sessions pane header) and persists via `useThemeStore` → localStorage.

## Backend Changes (`chatbot/`)

- **`schemas.py`**: `ChatRequest` gains `mode: Optional[str]` and `mode_params: Optional[Dict]`. `ChatResponse.data` gains `artifacts: List[ArtifactLink]` alongside existing fields, so the frontend doesn't have to reverse-engineer links from response shape.
- **`router.py`**: mode-conditional system-prompt/seed logic via a `MODE_PRIMERS` dict (keyed by mode, with sub-keys for `reading_plan`/`parable`/`topic`) that seeds the first assistant turn of a new session. Existing deterministic/Claude routing is unchanged for subsequent turns.
- **`tools.py`**: two new tool functions —
  - `search_gematria(value: int, scope: 'word' | 'verse')`
  - `search_english(query: str)`

  Both query `Complete.db` directly via `dataset`, porting the relevant query logic out of `myproject.py`'s `/gematria` and `/english` Flask routes (dropping the HTML-generation portions). The existing `ROW_RESULT_LIMIT = 20000` cap carries over to `search_english`.
- **New static data modules** under `chatbot/data/`:
  - `reading_plans.py` — two 365-entry lists (`chronological`, `canonical`), sourced from a public-domain plan.
  - `parables.py` — curated list (~40 entries) of `{id, name, reference}`.
  - `topics.py` — small initial curated list of `{id, name, seed_references}`, structured for easy incremental additions.

## Frontend Changes (`frontend/src/`)

- New `store/`: `useSessionsStore`, `useArtifactStore`, `useThemeStore` (Zustand).
- `App.tsx` becomes the three-pane shell.
- **Deleted**: `pages/ExplorerPage.tsx`, `pages/StrongsPage.tsx`, `pages/GematriaPage.tsx`, `pages/EnglishPage.tsx`, `components/layout/AppLayout.tsx`, `context/ChatContext.tsx`.
- New `components/shell/`: `SessionsPane`, `ChatPane`, `ArtifactPane`, `ModePickerScreen`, `SettingsPanel`.
- New `components/artifacts/`: one component per artifact type (`InterlinearArtifact`, `StrongsArtifact`, `BookContextArtifact`, `GematriaArtifact`, `EnglishSearchArtifact`).
- `ChatSidebar.tsx`'s message-sending logic (history snapshotting) is preserved and moved into `ChatPane`; the file itself is deleted along with `BibleChatWidget.tsx` if unused elsewhere.
- Existing `components/explorer/*` components (`KJVInterlinearTable`, `OriginalInterlinearTable`, `InfoBox`, `VerseDisplay`, `SearchForms`) are either condensed into the new artifact components or retired — final call made during implementation based on how much logic is reusable vs. needs a compact rewrite.

## Testing

- **Frontend**: mode picker → session creation → correct `modeParams`; artifact link click → correct fetch call and panel render; reading-plan day-complete → localStorage state update; theme switch → persisted and applied on reload.
- **Backend**: extend existing `router.py`/`tools.py` test patterns for `search_gematria`/`search_english` (query correctness against known `Complete.db` fixtures) and mode-primer seeding (given `mode` + `mode_params`, the seeded first turn matches expectations).
- **Manual**: run through each of the four modes end-to-end in the browser, plus a pass through all four themes, per this project's UI-change verification convention.

## Open Items Resolved During Brainstorming

- Old pages: retired, chat is the sole entry point.
- Session storage: localStorage only, no backend persistence, no auth.
- Reading plan: full plan + tracking, two sub-modes (chronological/canonical), no M'Cheyne.
- Modes: one per session; exactly the four described, no others in v1.
- Artifact panel: redesigned compact views, not reused old-page components.
- Gematria/English search: chat tools, not dedicated modes.
- Chat bubble detail: compact inline + links to expand in the artifact panel.
- Panel layout: three-pane, always visible on desktop.
- Visual theme: all four mockup directions ship as switchable presets, not a single locked-in theme.
- Manuscript image viewer: kept as a secondary tab within the `interlinear` artifact.
