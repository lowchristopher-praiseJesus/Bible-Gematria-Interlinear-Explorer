# "Walk the Tabernacle" mode — design

Date: 2026-10-27 · Status: draft for review

## Purpose

Bring the interactive 3D tabernacle of Moses (currently a standalone static
site in `~/Documents/floorplan_3d/Tabernacle`, served ad hoc on port 8123) into
the chat app as a mode. The user walks the tabernacle — scroll-driven, from
the drawn pattern through the gate to the Holy of Holies — and can stop at any
furnishing, read its panel, and ask the chat about it. The chat answers from
the same panel text plus Scripture from `Complete.db`, and can move the camera
to whatever the conversation is about.

Success: from the mode picker a user can open the walk, click the ark, press
"Ask about this", get a grounded answer whose references link into the
explorer, and the 3D view follows when the answer moves on to another
furnishing. A reload or share link restores the walk.

Out of scope (YAGNI): rewriting the viewer in React; new 3D content or
stations; voice narration of the walk; Solomon's/Ezekiel's temple; editing
panel text from the UI; analytics on which spots are opened.

## Decisions taken during brainstorming

- **A new mode** (`tabernacle`), not a sub-feature of an existing mode. Every
  existing mode is a conversation that produces a document; this is a spatial
  experience with no natural host. Deep Study and Find passages are the
  closest, and both start from a passage the user names, not a building.
- **The viewer is a reusable `tabernacle` artifact**, opened by the mode, so
  other modes can later open it at a given spot (phase 3).
- **Embed via a same-origin `<iframe>`**, not a React port. The viewer owns the
  whole document: Lenis smooth-scroll on the page, GSAP ScrollTrigger timing
  against document height, its own render loop, and an importmap for three.js.
  An iframe gives it its own document so it runs unchanged; a port would mean
  rewriting the scroll model for a nested scroll container.
- **Single source of truth.** The viewer moves into this repository at
  `frontend/public/tabernacle/` and is edited only there. The original folder
  is not under version control today, so this also gives it history. The old
  folder is retired once the move is verified (deleting it is the user's call,
  not part of the implementation).
- **Panel text lives in one data file** that both the viewer and the chatbot
  read (see "Spot data").

## What exists today (the viewer)

- `index.html` (stations list, timed KJV notes, 10 clickable spots with
  `data-pos`, an `aside.info` panel, one `<template id="info-<spot>">` per
  spot), `css/style.css`, `js/{main,model,materials,sheet,world}.js`
  (~115 KB), `textures/` (6.7 MB).
- CDN deps: GSAP 3.12.5 + ScrollTrigger (cdnjs), Lenis 1.1.13 (unpkg),
  three 0.160.0 via importmap (jsDelivr), Google Fonts (Barlow Condensed,
  Spectral).
- Spots: `boards`, `table`, `menorah`, `incense`, `ark`, `laver`, `altar`,
  `gate`, `door`, `veil`.
- Not shipped: `recordings/` (209 MB of captures) and the loose reference
  images in the folder root (`*.png`, `table-of-showbread.jpg`) — no code
  references them. `.claude/` and `.DS_Store` are also left behind.
- nginx sets no CSP or `X-Frame-Options`; files in `frontend/public/` are
  copied verbatim into `dist/`, which nginx serves at `/`. So the viewer is
  served at `/tabernacle/` with no nginx or Docker change.

## Architecture

```
ModePickerScreen ──"⛺ Walk the Tabernacle"──▶ session mode=tabernacle
        │ empty message
        ▼
router.build_mode_primer ─▶ tabernacle_mode.primer()
        │  intro text + inline artifact {type:'tabernacle', params:{spot?}}
        ▼
ArtifactPane ─▶ TabernacleArtifact ─▶ <iframe src="/tabernacle/?embed=1#spot=ark">
        ▲                                   │
        │   window.postMessage (same origin)│
        └───────────────────────────────────┘
chat turns (non-empty) ─▶ api.py mode=="tabernacle" ─▶ tabernacle_mode.answer()
        grounded on tabernacle_spots.json[current spot] + Complete.db verses
```

### Files

New:
- `frontend/public/tabernacle/` — the viewer (moved, then lightly edited).
- `frontend/public/tabernacle/data/spots.json` — the spot data (the one copy;
  see below).
- `frontend/src/components/artifacts/TabernacleArtifact.tsx` (+ test).
- `frontend/src/components/artifacts/TabernacleOverlay.tsx` — full-screen
  wrapper, same pattern as `StoryReaderOverlay`.
- `frontend/src/lib/tabernacleBridge.ts` — message types and the origin-checked
  send/receive helpers, shared by artifact and chat pane.
- `chatbot/tabernacle_mode.py` — `primer()`, `answer()`, spot loading.
- `tests/chatbot/test_tabernacle_mode.py`, `tests/chatbot/test_tabernacle_spots.py`.

Changed:
- `frontend/src/types/session.ts` — `'tabernacle'` added to `SessionMode` and
  to `ArtifactLink.type`; `ModeParams.tabernacleSpot?: string`.
- `frontend/src/components/shell/ModePickerScreen.tsx` — the tile.
- `frontend/src/components/shell/ArtifactPane.tsx` — render the artifact.
- `chatbot/router.py` — `mode == "tabernacle"` in `build_mode_primer`.
- `chatbot/api.py` — `mode == "tabernacle"` branch in both `post_chat` and
  `_stream_chat_response`, next to `character` / `passages`.
- `Dockerfile.chatbot` — nothing extra if the chatbot reads the spot data from
  its own path (see below); otherwise ship it.
- `CLAUDE.md` — a "Walk the Tabernacle mode" section.

## Spot data (single source)

The 10 `<template id="info-*">` blocks move out of `index.html` into
`frontend/public/tabernacle/data/spots.json`:

```json
{
  "ark": {
    "label": "The ark of the covenant",
    "station": "Holy of Holies",
    "refs": ["Exodus 25:10-22"],
    "title": "The ark of the covenant",
    "html": "<p class=\"info-lede\">…</p><h3>…</h3><ul>…</ul>"
  }
}
```

- `html` is the panel body exactly as today (minus the outer `ref`/`h2`, which
  are rendered from `refs`/`title`), so the panels look identical.
- The viewer fetches `data/spots.json` on load and fills `.info-body` from it
  instead of cloning a `<template>`. `data-pos` stays in `index.html` — it is
  geometry, not text.
- The chatbot reads the **same file** from the repo. In Docker the chatbot
  image doesn't contain `frontend/`, so the build copies
  `frontend/public/tabernacle/data/spots.json` into the image (one `COPY` line
  in `Dockerfile.chatbot`) and `tabernacle_mode` resolves it from
  `TABERNACLE_SPOTS_PATH` (default: the repo path, for local runs). A test
  asserts the Dockerfile ships it, as `test_chatbot_image_ships_the_profiles`
  does for `characters/`.
- For grounding, the chatbot strips tags from `html` to plain text.

The timed station notes (`<figure class="note">`) stay in `index.html`: they
are part of the scroll choreography and the chatbot doesn't need them.

## Viewer changes (in `frontend/public/tabernacle/`)

Kept small and isolated in a new `js/bridge.js` imported by `main.js`:

1. **Embed flag.** `?embed=1` turns on the bridge and the embed-only
   additions below. Without the flag the viewer works standalone at
   `/tabernacle/`, as today — useful for development.
2. **Deep link.** `#spot=<id>` or `#station=<n>` on load scrolls to the matching
   beat and, for a spot, opens its panel. Reuses `main.js`'s existing
   `pxAt(beat)` / `lenis.scrollTo` logic; `main.js` exports a small
   `goToSpot(id)` / `goToStation(n)` API for the bridge.
3. **"Ask about this" button** at the end of each info panel (embed only).
4. **References become links** (embed only): the `.ref` line of a panel and of
   each station note is clickable and posts `tabernacle:ref`.
5. **Messages** — see the bridge protocol.

## Bridge protocol

`window.postMessage`, both directions, `targetOrigin` = `location.origin`;
every receiver drops messages whose `event.origin !== location.origin` or
whose `event.source` is not the expected window (parent / the iframe's
`contentWindow`). Payloads are `{ type, ...fields }`; unknown types and unknown
spot ids are ignored.

| Direction | type | fields | Effect |
|---|---|---|---|
| viewer → app | `tabernacle:ready` | — | Viewer loaded; app may now send a pending `goto` |
| viewer → app | `tabernacle:spot` | `spot` | A panel opened; the app stores it as `modeParams.tabernacleSpot` |
| viewer → app | `tabernacle:ask` | `spot` | App sends "Tell me about the {label}." as a user message in this session |
| viewer → app | `tabernacle:ref` | `ref` | App opens an `interlinear` artifact for the first verse of `ref` |
| app → viewer | `tabernacle:goto` | `spot` or `station` | Viewer scrolls there (and opens the panel for a spot) |

The artifact pane owns the iframe, so `tabernacleBridge.ts` exposes a tiny
module-level emitter: `ChatPane` subscribes to viewer events and calls
`sendGoto()`; if no viewer is mounted, `goto` is dropped silently.

## Backend

### Primer

`tabernacle_mode.primer(mode_params)` returns an intro ("Scroll to walk from
the gate to the Holy of Holies. Click any furnishing to read about it, or ask
me anything along the way."), follow-up suggestions (e.g. "What does the veil
represent?", "Why was the altar of brass?", "What was inside the ark?"), and
one inline artifact `{type: 'tabernacle', label: 'The Tabernacle', params:
{spot: mode_params.tabernacleSpot or null}}`. No LLM call.

### Answers

Every non-empty turn in a `mode=tabernacle` session goes to
`tabernacle_mode.answer(message, history, mode_params)`:

1. **Subject.** Current spot = a spot id or label named in the message (simple
   match against labels and aliases like "lampstand", "candlestick",
   "mercy seat", "brazen altar"), else `mode_params.tabernacle_spot`, else none
   (whole-tabernacle question).
2. **Grounding block.** The spot's plain-text panel plus the KJV text of its
   `refs`, fetched with the dependency-free readers in
   `chatbot/bible_search.py`. No spot → a short summary of all ten (labels +
   refs), so general questions still work.
3. **One LLM call** with a system prompt: answer from the grounding block and
   Scripture; keep to the typological reading the panels present; say plainly
   when something isn't stated in Scripture. Whole reply in one `final` event
   (no token streaming), like character mode.
4. **Post-processing.** `wiki_refs.resolve_scripture_refs` turns references
   into explorer links (this mode is study, not persona, so links are wanted).
   Follow-ups from `generate_llm_follow_ups`.
5. **Camera cue.** The response's `data` carries `tabernacle_spot: <id>` when
   the answer's subject is a spot; the frontend sends `tabernacle:goto` on
   receipt. Detected by the same matcher run over the user message first, then
   the reply — no extra LLM call.

LLM failure → an honest "couldn't answer right now" message; the walk itself
never depends on the backend.

## Frontend

- **Tile.** "⛺ Walk the Tabernacle" (lucide `Tent` icon) in
  `ModePickerScreen`, calling `startSession('tabernacle', …, {})`. Always shown
  — it has no backend dependency to probe, unlike `passages`.
- **`TabernacleArtifact`.** Lazy iframe (`loading="lazy"`, mounted only when
  the pane shows it), `src` built from `params.spot`, a "Full screen" button
  opening `TabernacleOverlay`, and a "Open in new tab" link to `/tabernacle/`.
  On viewports under the app's mobile breakpoint, opening the artifact goes
  straight to the overlay. While loading: a skeleton with the title; if the
  iframe hasn't sent `ready` in 15 s, a "The 3D view couldn't load" note with
  the new-tab link (covers CDN/WebGL failure).
- **Only one live viewer.** The pane and the overlay share one iframe element
  (moved, not duplicated), so the WebGL context and scroll position survive
  going full screen.
- **Reload/share.** The artifact is inline in the message, and the last spot is
  in `modeParams`, so both restore the walk at that spot.

## Error handling

- Viewer can't load (offline CDN, no WebGL): timeout note + new-tab link; chat
  still works.
- Unknown spot id in a message, hash, or `modeParams`: ignored; viewer opens at
  the start.
- Spot data file missing or invalid on the chatbot side: `tabernacle_mode`
  logs once and answers without a grounding block, saying it can't see the
  panel text. (A test makes this unreachable in a correct build.)
- Cross-origin or malformed messages: dropped.

## Testing

Backend (`pytest`):
- `test_tabernacle_spots.py`: `spots.json` parses; exactly the 10 ids present
  in `index.html`'s `.spot[data-spot]` buttons (keeps geometry and text in
  step); every `refs` entry resolves to text in `Complete.db`, same pattern as
  `test_hermeneutic_rulings.py`.
- `test_tabernacle_mode.py`: primer shape and artifact; spot matcher (labels,
  aliases, none); grounding includes panel text and verse text; reply goes
  through `resolve_scripture_refs`; `tabernacle_spot` cue set/unset; LLM
  failure path.
- Image test: `Dockerfile.chatbot` copies `spots.json`.
- Shipping test: `frontend/public/tabernacle/` contains no `recordings/` and
  stays under a size budget (10 MB), so captures can't sneak into git or `dist/`.

Frontend (`vitest`):
- `TabernacleArtifact`: iframe `src` reflects `params.spot`; lazy mount;
  timeout fallback; full screen moves rather than duplicates the iframe.
- `tabernacleBridge`: rejects foreign origins and wrong `source`; ignores
  unknown types; `ask` produces a user message; `ref` opens an interlinear
  artifact; `goto` is sent on a response carrying `tabernacle_spot`.
- `ModePickerScreen`: tile starts a `tabernacle` session.

Manual: walk end to end in Chrome and Safari, desktop and phone width; the
standalone `/tabernacle/` still works.

## Phases

1. **Embed.** Move the viewer, extract the spot data, and add the mode,
   primer, artifact, overlay, tile, and grounded `answer()` (without the
   camera cue), so the mode is useful on day one. No bridge yet.
2. **Bridge.** `bridge.js`, deep links, "Ask about this", ref links, camera
   cue.
3. **Entry points (optional, later).** A "View in the Tabernacle" chip on
   interlinear/verse views for Exodus 25–40, Leviticus 16, and Hebrews 9,
   opening the artifact at the matching spot. Needs a small
   reference → spot table; not designed further here.

## Content review before ship

Once the chatbot answers from the panels, their text becomes the mode's
doctrinal output, the same caution that applies to `hermeneutic_rulings.py`.
One claim needs checking: the table panel says the temple **singers** baked
and arranged the showbread. 1 Chronicles 9:32 assigns that to the Kohathites;
9:33 is about the singers. The panel should be corrected or reworded before
the chatbot repeats it.

## Open questions

None blocking. The mobile breakpoint and the 10 MB budget are defaults to
confirm during implementation.
