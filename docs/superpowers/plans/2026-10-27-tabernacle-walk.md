# Walk the Tabernacle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `tabernacle` chat mode that embeds the 3D tabernacle walk as an artifact, answers questions grounded on its panel text and Scripture, and keeps the 3D view and the chat in step.

**Architecture:** The static viewer moves into `frontend/public/tabernacle/` (the only copy) and runs in a same-origin iframe inside a new `tabernacle` artifact. Panel text moves into `frontend/public/tabernacle/data/spots.json`, read by both the viewer and `chatbot/tabernacle_mode.py`. The viewer and the app talk over origin-checked `postMessage`.

**Tech Stack:** Vanilla JS + three.js/GSAP/Lenis (viewer, unchanged deps); React + Zustand + Vitest (frontend); FastAPI + pytest (chatbot).

**Spec:** `docs/superpowers/specs/2026-10-27-tabernacle-walk-design.md`

## Global Constraints

- Mode id `tabernacle`; artifact type `tabernacle`; tile label "⛺ Walk the Tabernacle", lucide `Tent` icon, always shown.
- Spot ids, exactly 10: `boards`, `table`, `menorah`, `incense`, `ark`, `laver`, `altar`, `gate`, `door`, `veil`.
- Viewer source: `~/Documents/floorplan_3d/Tabernacle`. Ship `index.html`, `css/`, `js/`, `textures/` only. Never `recordings/`, root `*.png`/`*.jpg`, `.claude/`, `.DS_Store`.
- `frontend/public/tabernacle/` ≤ 10 MB.
- Viewer served at `/tabernacle/`; embedded as `/tabernacle/?embed=1` with optional `#spot=<id>` or `#station=<n>` (n = 0–7, the order of the stations list).
- Message types: `tabernacle:ready`, `tabernacle:spot {spot}`, `tabernacle:ask {spot}`, `tabernacle:ref {ref}`, `tabernacle:goto {spot|station}`. `targetOrigin = location.origin`; receivers drop wrong origin, wrong `source`, unknown type, unknown spot.
- Viewer load timeout: 15 s without `tabernacle:ready` → fallback note + "Open in new tab".
- Mobile: `window.matchMedia('(max-width: 767px)')` → open straight to the overlay.
- Chat answers: one LLM call, whole reply in one `final` event, references through `wiki_refs.resolve_scripture_refs`, follow-ups from `generate_llm_follow_ups`. The camera cue is `data.tabernacle_spot`.
- Chatbot reads the spot file from env `TABERNACLE_SPOTS_PATH`, defaulting to `<repo>/frontend/public/tabernacle/data/spots.json`; in Docker it's `COPY`'d to `./data/tabernacle_spots.json` and the env var is set to that path.
- Do not delete `~/Documents/floorplan_3d/Tabernacle`. Retiring it is the user's call.

## Review Focus

1. **Session switch with the viewer still open:** the artifact pane is global, so a `tabernacle:spot`/`ask` from the viewer must only touch the session shown in `ChatPane`, and only if that session's mode is `tabernacle`. Otherwise ignore it. Test in Task 7.
2. **`goto` before the iframe is ready:** a reply can arrive while the viewer is still loading. The latest pending `goto` is held and sent on `tabernacle:ready`, and older pending ones are dropped. Test in Task 5.
3. **Standalone viewer:** opened directly at `/tabernacle/` (no `embed=1`, `window.parent === window`), the viewer must not post messages, add Ask buttons, or turn refs into links. Test in Task 6.
4. **"altar" is ambiguous:** "golden altar" / "altar of incense" / "incense altar" → `incense`; a bare "altar" or "brazen/bronze altar" → `altar`. Test in Task 3.
5. **"Ask about this" while a reply is in flight:** ignored, never double-sent. Test in Task 7.

---

### Task 1: Move the viewer into the repo

**Files:**
- Create: `frontend/public/tabernacle/` (`index.html`, `css/style.css`, `js/*.js`, `textures/**`)
- Test: `tests/chatbot/test_tabernacle_shipping.py`

**Interfaces:**
- Produces: the viewer served at `/tabernacle/` by Vite dev and by nginx from `dist/`.

- [ ] **Step 1: Write the failing test** in `tests/chatbot/test_tabernacle_shipping.py`:

```python
VIEWER = Path(__file__).resolve().parents[2] / "frontend" / "public" / "tabernacle"

def test_viewer_is_in_the_repo():
    for rel in ["index.html", "css/style.css", "js/main.js", "js/model.js", "textures"]:
        assert (VIEWER / rel).exists(), rel

def test_viewer_ships_no_recordings_or_reference_images():
    assert not (VIEWER / "recordings").exists()
    assert not list(VIEWER.glob("*.png")) and not list(VIEWER.glob("*.jpg"))
    assert not (VIEWER / ".claude").exists()

def test_viewer_stays_under_size_budget():
    total = sum(p.stat().st_size for p in VIEWER.rglob("*") if p.is_file())
    assert total <= 10 * 1024 * 1024
```

- [ ] **Step 2: Run it.** `pytest tests/chatbot/test_tabernacle_shipping.py -v`. Expected: FAIL (`index.html` missing).

- [ ] **Step 3: Copy the viewer.**

```bash
mkdir -p frontend/public/tabernacle
rsync -a --exclude recordings --exclude '.claude' --exclude '.DS_Store' \
  --exclude '/*.png' --exclude '/*.jpg' \
  ~/Documents/floorplan_3d/Tabernacle/ frontend/public/tabernacle/
```

- [ ] **Step 4: Run it.** Same command. Expected: 3 passed.

- [ ] **Step 5: Smoke-check.** `cd frontend && npm run dev`, open `http://localhost:5173/tabernacle/`. Expected: the walk renders and scrolls exactly as on port 8123.

- [ ] **Step 6: Commit.** `git add frontend/public/tabernacle tests/chatbot/test_tabernacle_shipping.py && git commit -m "feat(tabernacle): move the 3D tabernacle viewer into the app"`

---

### Task 2: Extract spot data to `spots.json` (single source)

**Files:**
- Create: `frontend/public/tabernacle/data/spots.json`
- Modify: `frontend/public/tabernacle/index.html` (delete the 10 `<template id="info-*">` blocks)
- Modify: `frontend/public/tabernacle/js/main.js` (`openInfo` fills from JSON instead of cloning a template)
- Test: `tests/chatbot/test_tabernacle_spots.py`

**Interfaces:**
- Produces: `spots.json` shape, used by Tasks 3, 4, 6:

```json
{ "<id>": { "label": "The ark of the covenant", "station": "Holy of Holies",
            "aliases": ["ark", "mercy seat", "ark of the testimony"],
            "refs": [{"usfm": "EXO 25:10-22", "label": "Exodus 25:10–22"}],
            "title": "The ark of the covenant",
            "html": "<p class=\"info-lede\">…</p>…" } }
```

  `label` = the `.spot-label` text. `title` = the template's `<h2>`. `html` = the template body after the `.ref` and `h2` lines, verbatim. `refs` = the template's `.ref` line. `aliases` are lowercase. Required aliases: menorah `["menorah", "lampstand", "candlestick"]`; incense `["altar of incense", "incense altar", "golden altar"]`; altar `["altar of burnt offering", "brazen altar", "bronze altar", "altar"]`; laver `["laver", "basin"]`; table `["table", "showbread", "shewbread"]`; veil `["veil", "vail"]`; boards `["boards", "acacia", "shittim"]`; door `["door", "door of the tent"]`; gate `["gate"]`.

- [ ] **Step 1: Write the failing tests** in `tests/chatbot/test_tabernacle_spots.py`. The `spots` fixture loads the JSON.
  - `test_spot_ids_match_the_viewer_buttons`: the ids parsed from `data-spot="…"` in `index.html` == the set of keys == the 10 Global Constraints ids.
  - `test_every_spot_has_required_fields`: non-empty `label`, `title`, `html`, `aliases`, `refs`. Each ref has `usfm` and `label`.
  - `test_every_ref_resolves_against_complete_db`: same pattern as `tests/chatbot/test_hermeneutic_rulings.py::test_every_proof_text_resolves_against_complete_db`, using `_USFM_TO_BNUM` and the first verse of `usfm`.
  - `test_index_html_has_no_info_templates`: `'<template id="info-' not in index_html`.

- [ ] **Step 2: Run them.** `pytest tests/chatbot/test_tabernacle_spots.py -v`. Expected: FAIL (file missing).

- [ ] **Step 3: Write `spots.json`.** Convert each template mechanically (a throwaway script in the scratchpad is fine; don't commit it). Then delete the templates from `index.html`.

- [ ] **Step 4: Change `main.js` so panels render from the JSON.** Fetch `data/spots.json` once at startup, alongside the font loads. `openInfo(spot)` builds `.info-body` as `<p class="ref">{refs labels joined by "; "}</p><h2 id="info-title">{title}</h2>{html}`. Spots whose data is missing stay clickable but open nothing.

- [ ] **Step 5: Run the tests.** Expected: 4 passed. Manually click every spot in the dev server. Each panel must match the original on port 8123 exactly, including the `info-colors` lists.

- [ ] **Step 6: Correct the showbread claim.** In `table.html`, replace the "Prepared by the temple singers" section with text attributing the showbread to the Kohathites (1 Chronicles 9:32). **Show the user the replacement wording and wait for approval before committing it.**

- [ ] **Step 7: Commit.** `git commit -m "feat(tabernacle): spot panels read from one spots.json"`

---

### Task 3: Backend mode skeleton (spot loading, matcher, primer)

**Files:**
- Create: `chatbot/tabernacle_mode.py`
- Modify: `chatbot/router.py` (`build_mode_primer`, next to `if mode == "passages":` ~line 1339)
- Test: `tests/chatbot/test_tabernacle_mode.py`

**Interfaces:**
- Consumes: `spots.json` (Task 2).
- Produces:
  - `load_spots() -> Dict[str, Dict[str, Any]]`: cached, reads `TABERNACLE_SPOTS_PATH`. On a missing or invalid file it logs once and returns `{}`.
  - `match_spot(text: str) -> Optional[str]`: longest-alias-first, whole-word, case-insensitive.
  - `primer(mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]`: no LLM.
  - `SPOTS_PATH_ENV = "TABERNACLE_SPOTS_PATH"`

- [ ] **Step 1: Write the failing tests:**
  - `test_load_spots_reads_all_ten`: `set(load_spots()) ==` the 10 ids.
  - `test_load_spots_missing_file_returns_empty`: monkeypatch the env to a nonexistent path and clear the cache, then `load_spots() == {}`.
  - `test_match_spot` parametrized: `("What was inside the ark?", "ark")`, `("tell me about the lampstand", "menorah")`, `("the golden altar", "incense")`, `("altar of incense", "incense")`, `("why a brazen altar", "altar")`, `("what is the altar for", "altar")`, `("the vail", "veil")`, `("hello", None)`, `("dark", None)` (`ark` must match whole words only).
  - `test_primer_returns_intro_and_artifact`: `r["type"] == "chat"`; the message contains `"Holy of Holies"`; `r["artifacts"] == [{"type": "tabernacle", "label": "The Tabernacle", "params": {"spot": None}}]`; `len(r["follow_up_questions"]) == 3`.
  - `test_primer_restores_saved_spot`: `primer({"tabernacle_spot": "ark"})["artifacts"][0]["params"]["spot"] == "ark"`.
  - `test_primer_drops_unknown_saved_spot`: `{"tabernacle_spot": "nope"}` → `spot is None`.
  - `test_router_primer_dispatches_tabernacle`: `await router.build_mode_primer("tabernacle", {})` returns the artifact above. Match the existing primer tests' call shape.

- [ ] **Step 2: Run them.** `pytest tests/chatbot/test_tabernacle_mode.py -v`. Expected: FAIL (import error).

- [ ] **Step 3: Implement** the three functions, plus `if mode == "tabernacle": return tabernacle_mode.primer(mode_params)` in `build_mode_primer`.
  - Primer copy, exact: "Scroll to walk from the gate to the Holy of Holies. Click any furnishing to read about it, or ask me anything along the way."
  - Follow-ups, exact: "What does the veil represent?", "Why was the altar made of brass?", "What was inside the ark?"
  - Result dict shape follows `passage_search._chat`, plus `artifacts`.

- [ ] **Step 4: Run the tests.** Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -m "feat(tabernacle): mode primer and spot matcher"`

---

### Task 4: Grounded answers + chat routing + Docker

**Files:**
- Modify: `chatbot/tabernacle_mode.py`
- Modify: `chatbot/api.py` (add a branch after `mode == "passages"` in `post_chat` ~line 391 and in `_stream_chat_response` ~line 620, same shape)
- Modify: `Dockerfile.chatbot` (after `COPY characters/`, line 48)
- Test: `tests/chatbot/test_tabernacle_mode.py`

**Interfaces:**
- Consumes: `load_spots`, `match_spot` (Task 3); `ollama_client.call_ollama_with_context`, `generate_llm_follow_ups`; `wiki_refs.resolve_scripture_refs`; `bible_search._USFM_TO_BNUM`, `_remove_tags`, `DB_PATH`.
- Produces: `async answer(message: str, history: Optional[List[Dict[str, str]]], mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]`. Its result has `data == {"tabernacle_spot": <id or None>}`. Also `grounding_for(spot_id: Optional[str]) -> str` and `verse_text(usfm_ref: str) -> str`.

- [ ] **Step 1: Write the failing tests.** Monkeypatch `call_ollama_with_context` and `generate_llm_follow_ups` in the module, the way the character-chat tests do.
  - `test_verse_text_reads_kjv`: `"testimony" in verse_text("EXO 25:22").lower()`.
  - `test_grounding_for_spot_has_panel_text_and_verses`: `grounding_for("ark")` contains the plain-text (tags stripped) start of the ark `html` and the text of EXO 25:22. It contains no `<`.
  - `test_grounding_for_none_lists_all_spots`: contains all 10 labels.
  - `test_answer_uses_spot_named_in_message`: `answer("what was the laver for?", [], {"tabernacle_spot": "ark"})` → the grounding passed to the stub contains laver text; `data["tabernacle_spot"] == "laver"`.
  - `test_answer_falls_back_to_current_spot`: message `"why gold?"` with saved `ark` → ark grounding; `data["tabernacle_spot"] == "ark"`.
  - `test_answer_cue_from_reply_when_message_names_none`: message `"what came next?"`, no saved spot, stub reply mentions "the laver" → `data["tabernacle_spot"] == "laver"`.
  - `test_answer_resolves_scripture_refs`: stub reply `"See Exodus 25:22."` → the message contains `"](/explorer?"`.
  - `test_answer_llm_failure_is_honest`: stub returns `{"type": "error", "message": ""}` → `result["type"] == "chat"` and the message is "I couldn't answer that right now — please try again." `data["tabernacle_spot"]` is still set from the message.
  - `test_answer_without_spot_data_says_so`: `load_spots` patched to `{}` → the grounding passed to the stub contains "panel text is unavailable".
  - `test_post_chat_routes_tabernacle`: through the FastAPI test client the way existing mode routing tests do; `mode="tabernacle"` hits `tabernacle_mode.answer` (stubbed).
  - `test_chatbot_image_ships_spot_data`: regex `^COPY\s+frontend/public/tabernacle/data/spots\.json\s+\./data/tabernacle_spots\.json` and `ENV TABERNACLE_SPOTS_PATH=/app/data/tabernacle_spots.json` in `Dockerfile.chatbot`. Pattern: `test_character_loader.py::test_chatbot_image_ships_the_profiles`.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `answer` resolves the spot as `match_spot(message)`, else a valid `mode_params["tabernacle_spot"]`.
  - It calls `call_ollama_with_context(message, research_data=grounding_for(spot), conversation_history=<role/content mapping as in character_chat._to_llm_history>, system_prompt=SYSTEM_PROMPT)`, then `resolve_scripture_refs`, then follow-ups.
  - The cue is the spot resolved above, else `match_spot(reply)`.
  - `SYSTEM_PROMPT`, exact intent: answer from the panel text and Scripture provided; keep to the typological reading the panels present; say plainly when Scripture doesn't state something; cite references as "Book chapter:verse".
  - `route = "tabernacle_mode → <spot or 'general'>"`.
  - Add the two `api.py` branches (pass `request.mode_params`) and the Dockerfile `COPY` + `ENV`.

- [ ] **Step 4: Run them.** `pytest tests/chatbot/test_tabernacle_mode.py -v`, then the full `pytest -q`. Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -m "feat(tabernacle): grounded answers and chat routing"`

---

### Task 5: Frontend artifact, overlay, tile

**Files:**
- Modify: `frontend/src/types/session.ts` (add `'tabernacle'` to `SessionMode` and `ArtifactLink.type`; add `ModeParams.tabernacleSpot?: string`; add `export interface TabernacleArtifactParams { spot: string | null }`)
- Modify: `frontend/src/store/useArtifactStore.ts` (`fetchForLink`: `case 'tabernacle'` returns `link.params` inline, like `passage_search`)
- Create: `frontend/src/lib/tabernacleBridge.ts` (+ `.test.ts`)
- Create: `frontend/src/components/artifacts/TabernacleArtifact.tsx` (+ `.test.tsx`)
- Create: `frontend/src/components/artifacts/TabernacleOverlay.tsx`
- Modify: `frontend/src/components/shell/ArtifactPane.tsx` (~line 96)
- Modify: `frontend/src/components/shell/ModePickerScreen.tsx` (tile next to "Find passages", ~line 328) (+ test)

**Interfaces:**
- Produces from `tabernacleBridge.ts`:
  - `type ViewerEvent = {type:'tabernacle:ready'} | {type:'tabernacle:spot', spot:string} | {type:'tabernacle:ask', spot:string} | {type:'tabernacle:ref', ref:string}`
  - `type GotoTarget = { spot: string } | { station: number }`
  - `SPOT_IDS: readonly string[]` (the 10)
  - `viewerSrc(spot: string | null): string` → `/tabernacle/?embed=1` or `/tabernacle/?embed=1#spot=<id>` (unknown spot → no hash)
  - `parseViewerMessage(e: MessageEvent, viewer: Window | null): ViewerEvent | null` (origin, source, type and spot checks)
  - `registerViewer(win: Window | null): void`, `markViewerReady(): void`, `sendGoto(t: GotoTarget): void` (held while not ready; latest wins; dropped if no viewer)
  - `onViewerEvent(fn: (e: ViewerEvent) => void): () => void`
  - `firstVerse(ref: string): string`: `"Exodus 30:18–19"` → `"Exodus 30:18"`, `"Exodus 25:31, 37"` → `"Exodus 25:31"`

- [ ] **Step 1: Write the failing tests.**
  - `tabernacleBridge.test.ts`: `viewerSrc(null)`, `viewerSrc('ark')`, `viewerSrc('nope')`; `parseViewerMessage` rejects a foreign origin, the wrong source, an unknown type, and an unknown spot, and accepts valid events; `firstVerse` cases above.
    - **Pending goto (Review Focus 2):** with a registered fake window, two `sendGoto`s before `markViewerReady` → after ready, exactly one `postMessage` with the second target. `sendGoto` with no viewer is a no-op.
  - `TabernacleArtifact.test.tsx`:
    - the iframe `src` is `viewerSrc(params.spot)`;
    - the title "The Tabernacle" shows while loading;
    - after a fake-timer advance of 15 000 ms with no ready message → "The 3D view couldn't load" plus a link to `/tabernacle/`;
    - a ready message clears the skeleton;
    - "Full screen" renders the overlay and the document still has exactly one `iframe`;
    - with `matchMedia('(max-width: 767px)')` mocked to match, the overlay opens on mount.
  - `ModePickerScreen.test.tsx`: clicking "Walk the Tabernacle" calls `postChat` with `{ message: '', mode: 'tabernacle', mode_params: {} }`.

- [ ] **Step 2: Run them.** `cd frontend && npx vitest run src/lib/tabernacleBridge.test.ts src/components/artifacts/TabernacleArtifact.test.tsx src/components/shell/ModePickerScreen.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Module-level bridge state.
  - `TabernacleArtifact` renders one iframe and moves it into the overlay with a portal target, never mounting a second. Pattern: `StoryReaderOverlay`'s Radix `Dialog`.
  - The artifact listens to `message` on `window`, calls `registerViewer(iframe.contentWindow)` on load and `markViewerReady()` on `tabernacle:ready`, and forwards other parsed events to `onViewerEvent` subscribers.
  - Wire `ArtifactPane` (`activeArtifact.type === 'tabernacle'`) and the tile (`startSession('tabernacle', '⛺ Walk the Tabernacle', {})`).

- [ ] **Step 4: Run them**, then `npx vitest run` and `npx tsc --noEmit`. Expected: all pass, no type errors.

- [ ] **Step 5: Commit.** `git commit -m "feat(tabernacle): tabernacle artifact, overlay and mode tile"`

---

### Task 6: Viewer bridge (`js/bridge.js`)

**Files:**
- Create: `frontend/public/tabernacle/js/bridge.js`
- Modify: `frontend/public/tabernacle/js/main.js` (export `goToSpot(id)`, `goToStation(n)`; call `initBridge` after setup)
- Modify: `frontend/public/tabernacle/css/style.css` (Ask button, linked `.ref`)
- Test: `frontend/src/lib/tabernacleViewerBridge.test.ts` (imports `../../public/tabernacle/js/bridge.js`)

**Interfaces:**
- Consumes: `spots.json` (Task 2); `goToSpot`/`goToStation` from `main.js`. `goToSpot` scrolls to the spot's station beat with the existing `pxAt`/`lenis.scrollTo` (immediate when `REDUCED`), then opens its panel.
- Produces, from `bridge.js` (no three/GSAP imports, so it's testable in Vitest):
  - `isEmbedded(win: Window): boolean`: `?embed=1` **and** `win.parent !== win`
  - `parseHash(hash: string): {spot: string} | {station: number} | null` (validates against the 10 ids and 0–7)
  - `initBridge({ win, spots, goToSpot, goToStation }): void`: no-op unless embedded. Otherwise it posts `ready`, applies `parseHash(location.hash)`, posts `spot` on panel open, adds the Ask button (`tabernacle:ask`) to each panel, makes `.ref` elements post `tabernacle:ref` with their text, and handles incoming `tabernacle:goto` (origin + `source === parent` checked).

- [ ] **Step 1: Write the failing tests.**
  - `parseHash('#spot=ark')`, `('#station=3')`, `('#station=9') → null`, `('#spot=nope') → null`, `('') → null`.
  - **Standalone (Review Focus 3):** `isEmbedded` is false without the param, and false with the param when `parent === win`. `initBridge` with a non-embedded fake window posts nothing and adds no buttons.
  - Embedded fake window: posts `{type:'tabernacle:ready'}` to `location.origin`. A goto message from the parent calls `goToSpot('ark')`. One from another origin or source is ignored.

- [ ] **Step 2: Run them.** `npx vitest run src/lib/tabernacleViewerBridge.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `bridge.js` and the `main.js` exports. Ask button text: "Ask about this".

- [ ] **Step 4: Run the tests.** Expected: pass. Manually check that `/tabernacle/` standalone shows no Ask buttons and `/tabernacle/?embed=1#spot=ark` inside the app's artifact opens at the ark.

- [ ] **Step 5: Commit.** `git commit -m "feat(tabernacle): viewer messaging, deep links and Ask about this"`

---

### Task 7: Wire the bridge into the chat

**Files:**
- Modify: `frontend/src/components/shell/ChatPane.tsx`
- Test: `frontend/src/components/shell/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `onViewerEvent`, `sendGoto`, `firstVerse` (Task 5); `useArtifactStore.openArtifact`; ChatPane's `sendMessage`, `updateModeParams`; the backend `data.tabernacle_spot` (Task 4); spot labels via a `fetch('/tabernacle/data/spots.json')` cached in `tabernacleBridge.ts` as `loadSpotLabels(): Promise<Record<string,string>>`.

- [ ] **Step 1: Write the failing tests** (ChatPane rendered with a `tabernacle` session, bridge events emitted directly):
  - `spot` event → `modeParams.tabernacleSpot === 'ark'`.
  - `ask` event for `ark` → user message exactly "Tell me about the ark of the covenant." (label with a leading "The " lowercased), and `postChatStream` is called once.
  - **In flight (Review Focus 5):** `ask` while a reply is pending → no second call.
  - `ref` event `"Exodus 30:18–19"` → `openArtifact` with `{ type: 'interlinear', label: 'Exodus 30:18 ▸', params: { reference: 'Exodus 30:18' } }`.
  - A final result with `data: { tabernacle_spot: 'laver' }` → `sendGoto({ spot: 'laver' })`.
  - **Session switch (Review Focus 1):** with a non-`tabernacle` session shown, `spot`/`ask` events change nothing and send nothing.

- [ ] **Step 2: Run them.** `npx vitest run src/components/shell/ChatPane.test.tsx`. Expected: new tests FAIL.

- [ ] **Step 3: Implement.**
  - One `useEffect` subscribes to `onViewerEvent`, gated on `session?.mode === 'tabernacle'` and reading the current session through a ref, so a stale closure can't write to the previous session.
  - Guard Ask on ChatPane's existing pending/streaming state.
  - Call `sendGoto` where `sendMessage` appends the assistant message from the final result.
  - Sending the message should use the usual path: `updateModeParams` → `tabernacleSpot`, then `sendMessage(text)`, so `mode_params.tabernacle_spot` reaches the backend.

- [ ] **Step 4: Run them**, then `npx vitest run` and `npx tsc --noEmit`. Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -m "feat(tabernacle): chat and 3D view follow each other"`

---

### Task 8: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md` (new "Walk the Tabernacle mode (internal id `tabernacle`)" section after "Find passages")
- Modify: `DEPLOYMENT.md` (one line: the viewer ships in `dist/`; the chatbot image copies `spots.json`; no nginx change)

- [ ] **Step 1: Write the CLAUDE.md section.** Cover:
  - the viewer lives only in `frontend/public/tabernacle/`;
  - panel text lives only in `data/spots.json`, and editing it changes the mode's doctrinal output;
  - the iframe and message protocol, pointing to `tabernacleBridge.ts` and `js/bridge.js`;
  - never commit `recordings/` (10 MB budget test);
  - Docker `COPY` + `TABERNACLE_SPOTS_PATH`;
  - spec link.

- [ ] **Step 2: Full test run.** `pytest -q` and `cd frontend && npx vitest run && npx tsc --noEmit && npm run build`. Expected: all green; `frontend/dist/tabernacle/index.html` and `frontend/dist/tabernacle/data/spots.json` exist.

- [ ] **Step 3: Manual walk.** Chrome and Safari, desktop and 390 px width. Check each of these:
  - tile → artifact;
  - click ark → "Ask about this" → grounded answer with explorer links;
  - ask "what about the laver?" → the camera moves;
  - click a station note's ref → interlinear opens;
  - reload → walk restored at the last spot;
  - share link → restored;
  - `/tabernacle/` standalone unchanged.

- [ ] **Step 4: Commit.** `git commit -m "docs(tabernacle): document the Walk the Tabernacle mode"`

- [ ] **Step 5: Tell the user** the old `~/Documents/floorplan_3d/Tabernacle` copy can now be retired, and stop the port-8123 server whenever they like. Don't delete it.
