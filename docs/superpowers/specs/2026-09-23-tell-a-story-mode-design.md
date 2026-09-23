# Tell a Story Mode Design Spec

**Date:** 2026-09-23
**Status:** Approved for planning

**Post-launch update (2026-09-23):** `ModePickerScreen`'s "Tell a Story"
tile no longer opens a `SessionPickerScreen` picking a past conversation
to derive themes from — that read as confusing when it's the very first
thing the user sees, before they've stated what the story should be
about. It now opens `StoryStarterScreen` (a few example lesson chips plus
free text), which needs no LLM derivation call: the user's own words
become the theme directly. The live in-conversation trigger in `ChatPane`
is unchanged and still derives themes from that conversation. Everywhere
below that describes `SessionPickerScreen` or "pick a past conversation"
as this tile's behavior reflects the original (now superseded) design;
see `CLAUDE.md`'s Tell a Story section for the current behavior.

## Purpose

"Tell a Story" (internal id `story`) turns an existing conversation — in
Socratic, Topical, Devotional, Deep Study, or Chat with a Character mode —
into a short, original children's story that illustrates a theme or lesson
drawn from that conversation. Unlike every other mode, it is never chosen
up front from an empty session: it is always launched *from* an
already-populated conversation, either the one the user is currently in or
a past one they pick.

End-to-end user experience:

1. From an existing conversation (live or past), the user asks for a
   story to be made from it.
2. The app reads that conversation, proposes up to three candidate
   themes/lessons drawn from it, and asks the user to pick one or more,
   alongside a target age range (3–6, 7–8, or 9–10).
3. Once the user picks, the app writes a single story, sized and written
   for the chosen age range, that illustrates the chosen theme(s), using
   original invented characters (never named biblical figures) rather
   than retelling the source passage or discussion directly.
4. The user can regenerate a fresh story from the same theme/age choice,
   or change either, without starting over.

### Naming

The user-facing label is "Tell a Story"; the internal `mode` id is
`story`. No alternative names were considered — this one is unambiguous
and matches the imperative style of no other mode label, but sits
naturally next to "Deep Study" and "Chat with a Character" on a tile.

## Scope

**In scope:**
- A new `mode: 'story'` session type, launched from (a) a toolbar button
  on an existing chat session, or (b) a new session-picker screen reached
  from `ModePickerScreen`.
- Backend theme derivation (1–3 themes) from a source conversation's
  transcript, and story generation sized to a user-chosen target age
  range, generic invented characters, multiple selected themes woven into
  one story.
- A configurable target age range — 3–6, 7–8, or 9–10 — selected in the
  same step as theme selection, with word-count target and vocabulary/
  plot complexity scaled to the chosen band (see Architecture).
- A bespoke multi-select theme-picker UI, distinct from the existing
  single-pick `MessageChoice` pills, that stays interactive after a story
  is delivered so the user can change their pick(s) or regenerate.
- Delivering the finished story as an inline artifact (`'story'` type),
  reusing the existing artifact-pane pattern.
- A new `SessionPickerScreen` for choosing a past conversation as the
  story's source.

**Out of scope:**
- Audio/Listen narration for the story (unlike devotional audio) — text
  only for v1.
- Retrying/repairing a story that leaks a named biblical figure via
  anything beyond prompt engineering — no automated detector/rewriter is
  built for this mode (character mode's persona-leak detector is not
  reused here).
- Any backend persistence beyond the existing `mode_params` round-trip
  convention — no new database table, no server-side session store.
- Editing or continuing the story conversationally after it's delivered
  (e.g. "make the fox a rabbit instead") — only "Try again" (regenerate)
  and "pick different themes" are supported.

## Approaches considered

**A — Story is a first-class new session, mode `story` (chosen).**
Both entry points create a *new* session with `mode: 'story'` whose
`modeParams` records where it came from (`storySourceSessionId`). Themes
and the story itself round-trip through `modeParams` exactly like Deep
Study's `runDigest`/`reference`. Every piece maps onto an existing, proven
pattern (primer, digest-in-modeParams, inline artifact) except the
multi-select picker and the session-picker screen, both small and bounded.
It also naturally supports "any past conversation" as a source, since a
`story` session never needs to mutate the conversation it was drawn from.

**B — Ephemeral overlay/modal, no new session.**
The trigger opens a modal over the current session; themes and story live
only in that modal, optionally "saved" as a session afterward. Rejected:
breaks this app's everything-is-a-session model (no reload persistence,
no share-link support per `docs/superpowers/specs/2026-09-07-conversation-sharing-design.md`,
which shares by session), and needs an entirely new UI surface with no
precedent in this codebase.

**C — Inline sub-flow inside the hosting session.**
Keep `session.mode` fixed and stash story state in the same session's
`modeParams`/messages. Rejected: there is no existing primitive for
"branch into another mode's request/response shape while keeping the
hosting mode's own routing," so this would require special-casing every
existing mode's backend routing to check for a pending story sub-flow,
and cannot represent generating a story from a *different*, past
conversation without mutating it.

## Architecture

### Mode lifecycle

1. **Trigger.** Either:
   - a "Tell a Story from this conversation" icon-button in `ChatPane`'s
     per-message toolbar (next to Copy/Regenerate), enabled only when
     `session.messages.length > 0`; or
   - `ModePickerScreen` → "Tell a Story" tile → new `SessionPickerScreen`
     listing past sessions with messages (excluding other `story`
     sessions) to pick as the source.
2. Frontend creates a new session (`useSessionsStore.createSession('story',
   { storySourceSessionId, storySourceLabel })`) and immediately fires the
   mode-primer convention every mode uses to open: a `POST /chat` (or
   `/chat/stream`) with `message: ''`, `mode: 'story'`, and a **one-time**
   `source_messages` field on the request carrying the source session's
   transcript, capped at `MAX_STORY_SOURCE_MESSAGES` (60).
3. `router.build_mode_primer` routes to `story_mode.derive_themes(source_messages)`:
   one LLM call returning up to 3 `{id, label, description}` themes and a
   compact **context digest** (2–4 sentences summarizing the source
   conversation). The digest exists so no later turn needs to resend the
   full transcript — mirrors Deep Study's `build_digest()`.
4. The primer's `ChatResponse` carries `story_themes` (the derived list).
   Frontend writes `storyThemes` and `storyDigest` into the new session's
   `modeParams` and renders the `ThemePicker` component in place of a
   normal assistant bubble. `ThemePicker` shows the theme checkboxes
   *and* an age-range selector (radio: 3–6 / 7–8 / 9–10, defaulting to
   3–6) in the same step.
5. User checks one or more themes, picks an age range, and clicks "Make
   my story." Frontend writes `storySelectedThemeIds` and
   `storyAgeRange` into `modeParams` and sends `POST /chat` with
   `message: ''`, `mode: 'story'`,
   `mode_params: { storyDigest, storyThemes, storySelectedThemeIds,
   storyAgeRange }` (no `source_messages` this time).
6. Backend's generation branch (distinguished from the primer branch by
   the presence of `storySelectedThemeIds` and the absence of
   `source_messages` — see Transport below) calls
   `story_mode.generate_story(digest, selected_themes, age_range)`: one
   LLM call producing invented generic characters (a child, an animal,
   etc. — never a named biblical figure), weaving every selected theme
   into a single story, sized and written for `age_range` per the table
   below.

   | Age range | Word-count target | Complexity                          |
   |-----------|--------------------|--------------------------------------|
   | 3–6       | ~500–800 words     | Simple sentences, concrete imagery throughout (including the ending — no abstract metaphor/simile or tacked-on "the lesson is..." moral) |
   | 7–8       | ~800–1200 words    | Slightly longer sentences, a light subplot, gentle vocabulary growth |
   | 9–10      | ~1200–1800 words   | Fuller plot/dialogue, richer vocabulary, lesson may be shown rather than stated outright |
7. The response's `ChatResponse.artifacts` carries one
   `{type: 'story', label: 'Read the story ▸', params: {title, themes,
   text, wordCount}}` entry, delivered exactly like `devotional`/
   `hermeneutics_report` artifacts today — no new fetch path.
8. **Try again**: resending the identical `mode_params` re-invokes step 6
   and appends a new assistant message + artifact (prior attempts are not
   deleted). **Different themes or age range**: the `ThemePicker` remains
   interactive after delivery (unlike `MessageChoice`, which locks after
   one pick), so the user can change the checked themes and/or the age
   range and resubmit, which also re-invokes step 6.

### Transport

No new SSE event types are introduced. `story` reuses `final` (and
`trace`) exactly as the non-streaming/simple modes do — there is no
multi-phase progress to report (unlike Deep Study's `phase` events), since
each turn is exactly one LLM call.

**Shipped differently than originally planned here: no `chatbot/api.py`
changes at all.** Every Tell a Story turn sends an empty `message`
(the trigger, the theme/age submission, and "Try again"), and both
`post_chat` and `_stream_chat_response` already route *any* empty-message
request straight to `router.build_mode_primer()` before reaching any
mode-specific branch — so a dedicated `mode == "story"` branch in
`api.py` would be dead code. All routing lives inside
`story_mode.build_primer()`, reached via `router.py`'s existing
dispatcher.

Routing within `build_primer()` needs no extra marker field:

```
mode_params.get('story_selected_theme_ids') is falsy
    → theme-derivation branch (reads mode_params.source_messages)

mode_params.get('story_selected_theme_ids') is truthy
    → story-generation branch (reads mode_params.story_themes /
      story_digest / story_age_range)
```

### Why a bespoke theme picker, not `MessageChoice`

`MessageChoice`/`choicesStatus` (used by Topical Study's series drill-down
and Deep Study's primer) resolves a single pick and then locks the
message. Tell a Story needs multi-select (themes are woven together, not
mutually exclusive) and needs to stay open after resolution (regeneration,
changing the pick). Retrofitting `MessageChoice` to support both would
change its contract for every existing consumer; a small dedicated
component is lower-risk.

### Why generic characters, not the source's biblical figures

Per product decision, the story always uses original invented characters
(a child, an animal, etc.) rather than depicting named biblical figures
directly, regardless of what the source conversation discussed — this
keeps the story self-contained and age-appropriate as a parable-style
tale rather than a dramatized retelling. This is enforced entirely through
the `generate_story` prompt; see Error handling for the limits of that
enforcement.

## Components

### `chatbot/story_mode.py` (new)
- `MAX_STORY_SOURCE_MESSAGES = 60` — caps the one-time transcript sent to
  `derive_themes`.
- `AGE_WORD_BANDS = {"3-6": (500, 800), "7-8": (800, 1200), "9-10": (1200, 1800)}`
  — word-count target per age range, keyed by the same `storyAgeRange`
  values the frontend sends.
- `derive_themes(source_messages: list[HistoryMessage]) -> ThemesResult`
  — one LLM call; prompt asks for 1–3 JSON `{id, label, description}`
  theme objects plus a short digest. Never pads to 3 if fewer are
  genuine. Not age-dependent — themes are derived once, age range is
  chosen alongside them but does not change what themes are offered.
- `generate_story(digest: str, selected_themes: list[Theme], age_range: str) -> StoryResult`
  — one LLM call; prompt fixes the word-count target and complexity for
  `age_range` (per `AGE_WORD_BANDS` and the Architecture table),
  invented-characters-only constraint, and weaves every selected theme
  into one story. If the returned word count is far outside the target
  band, retries once with a corrective instruction appended (same
  detect-and-retry shape as `character_chat.py`'s persona-leak handling);
  delivers the result either way after the retry.
- `answer(...)` / `stream(...)` — buffered/streaming pair mirroring
  `hermeneutics.answer`/`hermeneutics.stream`, dispatching between the two
  functions above per the Transport routing rule.

### `chatbot/api.py` — unchanged, no `story` branch

**Shipped differently than originally planned here.** Both `post_chat` and
`_stream_chat_response` already route *any* empty-message request straight
to `router.build_mode_primer(request.mode, request.mode_params)` before
reaching any mode-specific branch. Since every Tell a Story turn (the
trigger, the theme/age submission, and "Try again") sends an empty
`message`, 100% of its traffic is already dispatched there — a dedicated
`mode == "story"` branch in `api.py` would be dead code. See
`tests/chatbot/test_chat_endpoint_story.py`, which locks this routing
behavior on both `/chat` and `/chat/stream`.

### `chatbot/router.py`
- `build_mode_primer` gains a `mode == "story"` branch calling
  `story_mode.build_primer(mode_params)`, which internally dispatches
  between theme derivation and story generation (see Architecture).

### `chatbot/schemas.py` — no changes

**Shipped differently than originally planned here.** `mode_params:
Dict[str, Any]` and `data: Optional[Dict[str, Any]]` are already
free-form on both `ChatRequest` and `ChatResponse` (the same pattern
`run_digest`/`scope_chapter` and `data.reference`/`data.runDigest` already
use for Deep Study) — the transcript, themes and digest all travel
through those existing fields instead of new typed schema fields:
- The one-time transcript travels as `mode_params.source_messages`
  (`List[{"role": str, "text": str}]`), sent only on the primer call.
- The derived themes travel as `data.themes` (`List[{id, label,
  description}]`) and the digest as `data.digest`, both inside the
  primer response's existing `data` field.
- `ArtifactLink.type` needed no schema change at all — it's a plain
  `str` field with no enum/Literal constraint, so `'story'` is already a
  valid value; only its description string was updated for
  documentation.
- The `story`-type artifact's `params` dict uses `{title: str, themes:
  List[str], age_range: str, text: str, word_count: int}` —
  **snake_case**, matching the Python dict verbatim, since `ArtifactLink`
  params are never passed through the frontend's camelCase wire mapping
  (see below).

### `frontend/src/types/session.ts`
- `ModeParams` gains `storyThemes?: {id, label, description}[]`,
  `storyDigest?`, `storySelectedThemeIds?: string[]`,
  `storyAgeRange?: '3-6' | '7-8' | '9-10'`, `storySourceSessionId?`,
  `storySourceLabel?`, and `storySourceMessages?` (the ephemeral,
  never-persisted transcript field sent only on the primer call).
- `ArtifactLink` union gains `'story'`; `StoryArtifactParams` interface
  added with **snake_case** fields (`title`, `themes`, `age_range`,
  `text`, `word_count`) matching the backend dict verbatim — deliberately
  not camelCase, since `ArtifactLink.params` bypasses `toWireModeParams`
  (that mapper only applies to outgoing `mode_params`, never to artifact
  params already received from a response).
- `frontend/src/lib/chatApi.ts`'s `toWireModeParams` gains explicit
  camelCase→snake_case mappings for `storyThemes`, `storyDigest`,
  `storySelectedThemeIds`, `storyAgeRange`, and `storySourceMessages`
  (→ `source_messages`, not `story_source_messages`) — the two
  frontend-only bookkeeping fields (`storySourceSessionId`,
  `storySourceLabel`, never read by the backend) pass through the
  mapper's `default` case unchanged.

### `frontend/src/components/shell/SessionPickerScreen.tsx` (new)
Sibling of `CharacterPickerScreen`: lists past sessions with at least one
message, excluding `story`-mode sessions, letting the user pick one as
the source. Selecting an entry calls the same `createSession('story', ...)`
+ primer flow as the live-conversation trigger.

### `frontend/src/components/shell/ModePickerScreen.tsx`
Adds a "Tell a Story" tile that opens `SessionPickerScreen` instead of
calling `startSession` directly (since this mode always needs a source
conversation, never a bare primer).

### `frontend/src/components/shell/ChatPane.tsx`
Adds a "Tell a Story" button to the header toolbar (next to the existing
Share/Report buttons), hidden entirely when `session.mode === 'story'`
and disabled when `session.messages.length === 0`. Clicking it runs the
shared `startTellAStory()` helper (`frontend/src/lib/tellAStory.ts`, new)
using the *current* session as the source, then navigates to the new
session via a new optional `onNavigateToSession` prop threaded from
`App.tsx`.

### `frontend/src/lib/tellAStory.ts` (new)
`startTellAStory(deps, sourceSession): Promise<string>` — shared by both
entry points (the `ChatPane` trigger and `SessionPickerScreen`, below).
Creates the new `story` session, snapshots the source session's
transcript via the shared `frontend/src/lib/history.ts::toHistory()`
helper (extracted from `ChatPane.tsx`, which used to define it locally,
so both consumers get the same devotional-placeholder-swap logic), fires
the primer call, and stores the derived themes/digest into the new
session's `modeParams`.

### `frontend/src/components/shell/ThemePicker.tsx` (new)
Renders `modeParams.storyThemes` as checkboxes (not radio buttons)
alongside a three-way age-range radio group (3–6 / 7–8 / 9–10, defaulting
to 3–6), and a "Make my story" / "Try again" submit button (label depends
on whether a story has already been generated for the current
selection). Stays mounted and interactive after a story is delivered so
the user can change their theme and/or age selection.

**Theme-derivation failure/retry is handled separately from `ThemePicker`
itself** (added in the post-implementation fix wave, see Error handling):
a failed primer turn is *not* rendered onto the `MessageChoice`/
`choicesStatus` machinery (that would touch Parable/Topical Study's
existing single-pick-and-lock contract). Instead the primer response
carries `data.themesRetry: true`, `ChatPane.tsx` renders a plain Retry
button under that message, and clicking it re-derives themes against the
*live* source session's current transcript (via `tellAStory.ts`'s
exported `deriveStoryThemes()`) and updates the same message in place —
so `ThemePicker` mounts under it exactly as it would on a first
successful attempt. `data.themesRetry` and `data.themes` are mutually
exclusive across every response shape, so the two never render at once.

### `frontend/src/components/artifacts/StoryArtifact.tsx` (new)
Mirrors `DevotionalArtifact.tsx`: header with title, theme chips, and an
age-range badge (e.g. "Ages 7–8"), a Copy button, and the
markdown-rendered story body.

### `frontend/src/store/useArtifactStore.ts`
Adds a `'story'` case to `fetchForLink`'s switch, returning `link.params`
directly (no fetch), exactly like `'devotional'`/`'hermeneutics_report'`.

### `frontend/src/store/useSessionsStore.ts`
Adds `'story'` to `MODE_LABELS` and `MODE_ORDER` so `SessionsPane` groups
it correctly.

## Data flow

Live-conversation trigger, concrete example:

```
User in a Socratic session about the Prodigal Son clicks
"Tell a Story from this conversation"
  │
  ▼
startTellAStory(deps, sourceSession)
  → createSession('story', {storySourceSessionId, storySourceLabel})
  + POST /chat  { message:'', mode:'story',
                  mode_params:{storySourceMessages: <capped transcript>} }
  │
  ▼
router.build_mode_primer('story', mode_params)
  → story_mode.build_primer(mode_params)
  → derive_themes(source_messages)  [1 LLM call] → {themes:[…], digest:"…"}
  │
  ▼
ChatResponse{ data: {themes:[…], digest:"…"} }
  → frontend stores storyThemes+storyDigest into session.modeParams
  → renders ThemePicker
  │
  ▼
User checks "God's patience" + "coming home is always possible",
picks age range "7-8"
  → "Make my story"
  → POST /chat { message:'', mode:'story',
                 mode_params:{storyThemes, storyDigest,
                              storySelectedThemeIds, storyAgeRange:'7-8'} }
  │
  ▼
build_primer: story_selected_theme_ids present, no source_messages
  → generate_story(digest, selected themes, '7-8')  [1 LLM call]
  → word count checked against AGE_WORD_BANDS['7-8'] (retry once if far off)
  → ChatResponse{ message: short intro,
                   artifacts:[{type:'story',
                               params:{…, age_range:'7-8', word_count:…}}] }
  │
  ▼
Frontend appends assistant message + "Read the story ▸" pill
  → ArtifactPane → StoryArtifact.tsx
```

Regeneration / different themes:

```
"Try again" (same selection)         Different themes/age checked
  │                                          │
  ▼                                          ▼
resend identical mode_params      updateModeParams(storySelectedThemeIds,
  │                                             storyAgeRange)
  │                                          │
  └──────────────► POST /chat (generation branch) ◄──────────────┘
                          │
                          ▼
          new assistant message + new artifact appended
          (prior attempts remain in the transcript)
```

Past-conversation entry point is identical from `createSession` onward;
the only difference is that `startTellAStory`'s `sourceSession` argument
comes from `SessionPickerScreen`'s selection rather than the currently
open session.

## Error handling

- **Empty source conversation** — the trigger button is hidden/disabled
  when `session.messages.length === 0`, and `SessionPickerScreen` filters
  such sessions out of its list, so the backend never receives this case.
- **`derive_themes` gets no usable LLM reply** (empty string — every
  provider/network/timeout failure `simple_completion` can hit — or
  unparseable JSON) — returns `themes: None` (distinct from `[]`, added
  in the post-implementation fix wave), and `_themes_turn` replies "The
  story engine is having trouble right now — please try again in a
  moment." with `data: {themesRetry: true}`.
- **`derive_themes` succeeds but genuinely finds no themes** — a
  well-formed reply with an empty themes list — returns `themes: []`,
  and `_themes_turn` replies "Couldn't find a story in this conversation
  yet — try chatting a bit more first.", also carrying
  `data: {themesRetry: true}` so the same Retry affordance is offered
  either way (the user can't tell these apart, and doesn't need to — see
  the `ThemePicker` component note above for what Retry does).
- **Fewer than 3 themes found** — returns however many are genuine
  (minimum 1); never padded with filler themes.
- **`generate_story` returns an empty story after its retry** (the
  underlying LLM call failed both times — `simple_completion` never
  raises, only returns `""` on any failure) — added in the fix wave:
  `_story_turn` checks the final text is non-empty before building a
  `story` artifact, and returns a plain chat-type error ("I couldn't
  write the story just now — please try again in a moment.") instead of
  delivering a confident-looking empty story.
- **Story far outside the target word band, but non-empty** — one
  automatic retry with a corrective instruction appended to the prompt;
  delivered regardless of outcome after the retry (word count is a soft
  target, not a hard gate, so a user is never blocked from getting a
  story it did manage to write).
- **Story names a real biblical figure despite the prompt's instruction
  not to** — no automated detection or rewrite is built for this (unlike
  `character_chat.py`'s persona-leak rewriter); this is a known limitation
  of prompt-only enforcement, accepted for v1.
- **An unrecognized `story_age_range`** (a malformed or stale client
  value not in `AGE_WORD_BANDS`) — `generate_story` still raises
  `ValueError` (its own tested contract is unchanged), but `_story_turn`
  now catches it and returns a graceful chat-type error instead of
  letting it surface as a 500 — added in the fix wave.
- **`mode_params` missing entirely** (a `POST /chat` with `mode: "story"`
  and no `mode_params` key at all) — `build_primer` normalizes to `{}`
  before reading any key, matching `router.build_mode_primer`'s own
  pattern — added in the fix wave.
- **Ollama/network failure on either call** — folds into the two cases
  above (an LLM failure during theme derivation or story generation is
  handled explicitly, not left to a generic fallback).

## Testing

TDD throughout: each test below is written before the code it covers.

### Backend — `tests/chatbot/` (pytest, already configured)

`test_story_mode.py`:
- `derive_themes` returns 1–3 themes plus a non-empty digest for a normal
  multi-turn transcript fixture.
- A 1-message transcript still yields at least 1 theme; never crashes,
  never pads to 3 with filler.
- A transcript longer than `MAX_STORY_SOURCE_MESSAGES` is capped before
  being sent to the LLM call, and does not error.
- `generate_story` with 1 selected theme produces a single-theme story;
  with 2+ selected themes, the story addresses all of them (weaving, not
  a single-theme story that ignores the rest).
- `generate_story` called with each of `'3-6'`, `'7-8'`, `'9-10'` targets
  the corresponding `AGE_WORD_BANDS` range; an unrecognized age range
  value is rejected rather than silently defaulting.
- `generate_story`'s word count is checked against the requested age
  band; a mocked out-of-band response triggers exactly one retry with a
  corrective prompt, and the (possibly still out-of-band) result is
  returned rather than raising.
- A small smoke assertion that generated output avoids a short denylist
  of well-known biblical proper nouns, documented in the test as
  best-effort rather than a guarantee.

`test_api_story_routing.py` (or added to an existing `api` test file):
- `mode=='story'`, empty message, request carries `source_messages`, no
  `storySelectedThemeIds` in `mode_params` → primer/`derive_themes`
  branch is invoked.
- `mode=='story'`, empty message, `mode_params.storySelectedThemeIds`
  present, no `source_messages` in the request → generation/
  `generate_story` branch is invoked.
- Both routing rules behave identically in `post_chat` and
  `_stream_chat_response`.

### Frontend — vitest

- `ChatPane`: the "Tell a Story from this conversation" button is hidden
  when `session.messages` is empty, visible otherwise; clicking it calls
  `createSession` with `mode: 'story'` and the expected `modeParams`.
- `SessionPickerScreen`: lists only non-empty, non-`story` past sessions;
  selecting one triggers the same session-creation flow with that
  session's id/messages as source.
- `ThemePicker`: renders returned themes as checkboxes and an age-range
  radio group defaulting to 3–6; submit is disabled until at least one
  theme is checked; remains interactive and re-submittable after a story
  has been delivered (supports "Try again" and "different themes/age"
  without remounting).
- `StoryArtifact`: renders title, theme chips, age-range badge, and
  markdown body; Copy button copies the story text.
- `useArtifactStore`: `'story'`-type links resolve synchronously from
  `link.params` with no network fetch, matching `'devotional'`.

### Manual smoke

Run a real Socratic conversation about a parable end-to-end: trigger
button → themes appear → select two, pick age range 7–8 → story
generated at the expected length → "Try again" → new story appended →
switch age range to 9–10 and resubmit → longer, more complex story
appended → repeat the whole flow via `SessionPickerScreen`, choosing a
different, previously-saved session as the source.

## Open questions

1. Regenerated stories are appended as new assistant messages on each
   "Try again" rather than overwritten in place, preserving a history of
   attempts in the transcript — confirm this matches expectations before
   implementation.
2. `story` sessions are shareable via the existing `/api/share` mechanism
   with no special-casing, since they are an ordinary session — confirm
   no restriction is wanted here (e.g. some users may not want a
   generated-for-a-child story to carry the same share link as a deep
   theological conversation).
3. `MAX_STORY_SOURCE_MESSAGES = 60` is a starting guess for the one-time
   primer call's transcript cap — may need tuning once real token/latency
   costs are measured.
4. No Listen/audio narration for v1, consistent with treating this as a
   text-first mode; revisit if requested later (would follow the
   `devotional_audio.py` pattern).
5. The `AGE_WORD_BANDS` ranges (500–800 / 800–1200 / 1200–1800) are a
   starting proposal — may need tuning once real generated stories are
   reviewed for how well length tracks actual reading level per band.
