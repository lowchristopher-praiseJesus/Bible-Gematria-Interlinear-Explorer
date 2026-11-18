# Defend the Faith Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new mode (`apologetics`, shown as "Defend the Faith") that presents the user's apologetics YouTube Shorts as track playlists in the artifact pane, with a chat grounded on the shorts' content.

**Architecture:** An import script turns `~/Documents/Apologetics/Shorts/` plus a hand-edited track file into a committed manifest `chatbot/data/apologetics_shorts.json` (titles fetched from YouTube oEmbed). `chatbot/apologetics_mode.py` (modelled on `tabernacle_mode.py`) serves the track list, the no-LLM primer and the grounded answer. The frontend adds a track picker (fetched choice pills), an `apologetics_track` artifact (YouTube IFrame API player + playlist), and ChatPane wiring for "Ask about this", watched progress and the one-time track-complete prompt.

**Tech Stack:** Python 3 / FastAPI / pytest; React + TypeScript / Zustand / Vitest + Testing Library; YouTube IFrame Player API; macOS `sips` for thumbnails.

**Spec:** `docs/superpowers/specs/2026-11-18-defend-the-faith-design.md`

## Global Constraints

- Internal mode id `apologetics`; display name "Defend the Faith"; tile subtitle "Be ready always to give an answer — 1 Peter 3:15".
- Shorts are shown and named **by their YouTube title** everywhere (playlist, panel heading, Ask message, chat replies). Numbers are internal only.
- Titles come only from YouTube oEmbed `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json`; a failed fetch fails the import (no fallback to the description `TITLE:` line).
- Grounding = the current track's uploaded shorts in full + a one-line catalogue of every other uploaded short. The chat never introduces facts, statistics, quotes, scholars or arguments not in the material, never names a short not in the material, and treats story characters as fictional.
- Player: `youtube-nocookie.com` host, `rel=0`, `playsinline=1`, 9:16, never autoplays the next short.
- Progress lives in the session's `modeParams` (reloads and share links restore it). The track-complete prompt appears at most once per session.
- Tests never call YouTube and never depend on the committed manifest's ids or titles (use fixture manifests), except the manifest-integrity test, which checks the committed file's structure and refs.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Deviation from spec (simplification):** the manifest lives in `chatbot/data/`, which `Dockerfile.chatbot` already copies (`COPY chatbot/ ./chatbot/`), so no Dockerfile change is needed. `APOLOGETICS_SHORTS_PATH` remains only as a test override. The track definition is JSON (`chatbot/data/apologetics_tracks.json`), not YAML, to avoid a new dependency (the spec leaves this to the builder).

## Review Focus

1. **A session whose track no longer exists** (renamed/removed in the track file, or an old share link): the primer says the track isn't available, and the artifact shows "This track is no longer available" instead of crashing. Tests: Task 3 `test_primer_unknown_track`, Task 5 `renders unavailable track`.
2. **A video that won't play** (made private, embedding disabled, IFrame API script blocked): the panel shows a "Watch on YouTube" link and "Mark watched" still works. Test: Task 5 `falls back when the player errors`.
3. **A short added to an already-completed track:** the track shows incomplete again, and the once-per-session prompt is not shown a second time. Test: Task 6 `does not prompt twice`.
4. **Stale or foreign `current_short` / `watched_shorts`** in mode params (shorts no longer in the track, junk values from an old share): grounding ignores them and never errors. Test: Task 3 `test_grounding_ignores_stale_params`.
5. **Ask pressed while a reply is in flight, or for an unwatched short:** ignored while busy; the button is disabled until the short is watched. Test: Task 5 `ask disabled until watched`, Task 6 `ignores ask while busy`.

---

## File Structure

| File | Responsibility |
|---|---|
| `chatbot/apologetics_import.py` (new) | Pure parsing of description files, titles and Further-reading items. No I/O. |
| `scripts/import_apologetics_shorts.py` (new) | CLI: reads the source folder and track file, fetches titles, writes the manifest and thumbnails. |
| `chatbot/data/apologetics_tracks.json` (new, hand-edited) | Tracks + YouTube id per short number. |
| `chatbot/data/apologetics_shorts.json` (new, generated) | Manifest read by the backend. |
| `frontend/public/apologetics/thumbs/NN.jpg` (new, generated) | Playlist thumbnails. |
| `chatbot/apologetics_mode.py` (new) | Manifest loading, track listing, primer, grounding, answer. |
| `chatbot/schemas.py`, `chatbot/api.py`, `chatbot/router.py` (modify) | Endpoint, routing, primer dispatch. |
| `frontend/src/types/session.ts`, `lib/chatApi.ts`, `lib/modeData.ts`, `store/useArtifactStore.ts`, `store/useSessionsStore.ts`, `components/shell/SessionsPane.tsx` (modify) | Types, param mapping, data fetch, artifact registration, title/icon. |
| `frontend/src/lib/youtubePlayer.ts` (new) | Loads the IFrame API once; creates a player. |
| `frontend/src/lib/apologeticsEvents.ts` (new) | Tiny pub/sub between the artifact and ChatPane (ask, track complete). |
| `frontend/src/components/artifacts/ApologeticsTrackArtifact.tsx` (new) | Player + playlist panel. |
| `frontend/src/components/shell/ArtifactPane.tsx`, `ModePickerScreen.tsx`, `ChatPane.tsx` (modify) | Registration, tile and picker, chat wiring. |
| `CLAUDE.md` (modify) | Mode section. |

---

### Task 1: Parsing the source files

**Files:**
- Create: `chatbot/apologetics_import.py`
- Create: `tests/chatbot/fixtures/apologetics/` — copy `01 Historical Reliability - description.txt`, `03 The Resurrection - description.txt` (has `Acts 5 & 12`, `John 21`) and `10 Divine Lawgiver - description.txt` (no Scripture items) verbatim from `~/Documents/Apologetics/Shorts/`
- Test: `tests/chatbot/test_apologetics_import.py`

**Interfaces:**
- Produces:
  - `parse_description(text: str) -> dict` returning `{"summary": str, "fiction_note": str | None, "further_reading": list[dict]}`
  - `parse_further_reading(line: str) -> list[dict]`, each `{"text": str, "refs": list[str]}` (USFM like `"1CO 15:3-7"`, `"ACT 2:1"`)
  - `parse_short_filename(name: str) -> tuple[int, str] | None`: `"03 The Resurrection - script.txt"` → `(3, "The Resurrection")`

- [ ] **Step 1: Write the failing tests**

```python
from pathlib import Path
from chatbot.apologetics_import import parse_description, parse_further_reading, parse_short_filename

FIX = Path(__file__).parent / "fixtures" / "apologetics"

def test_filename():
    assert parse_short_filename("03 The Resurrection - script.txt") == (3, "The Resurrection")
    assert parse_short_filename("Did Jesus Really Die on the Cross.mp4") is None

def test_description_strips_title_reading_hashtags_and_boilerplate():
    d = parse_description((FIX / "01 Historical Reliability - description.txt").read_text())
    assert d["summary"].startswith("A professor calls the Gospels")
    for gone in ("TITLE:", "#Shorts", "Further reading", "Subscribe", "50-part series"):
        assert gone not in d["summary"]
    assert d["fiction_note"] == "(The professor and the student are fictional characters.)"

def test_further_reading_verse_range_and_plain_items():
    items = parse_further_reading('1 Corinthians 15:3–7 · Arrian, "Anabasis of Alexander"')
    assert items == [
        {"text": "1 Corinthians 15:3–7", "refs": ["1CO 15:3-7"]},
        {"text": 'Arrian, "Anabasis of Alexander"', "refs": []},
    ]

def test_further_reading_whole_and_combined_chapters():
    items = parse_further_reading("Acts 5 & 12 · John 21 · Acts 2")
    assert [i["refs"] for i in items] == [["ACT 5:1", "ACT 12:1"], ["JHN 21:1"], ["ACT 2:1"]]

def test_non_scripture_item_with_numbers_is_plain():
    items = parse_further_reading("Josephus, Antiquities 20.9.1 · Summa Theologiae I–II, Q. 95–96")
    assert all(i["refs"] == [] for i in items)

def test_description_without_scripture():
    d = parse_description((FIX / "10 Divine Lawgiver - description.txt").read_text())
    assert d["further_reading"] and all(i["refs"] == [] for i in d["further_reading"])
```

- [ ] **Step 2: Run to verify failure**
Run: `pytest tests/chatbot/test_apologetics_import.py -v`. Expected: FAIL, `ModuleNotFoundError`.

- [ ] **Step 3: Implement**
Books resolve via `chatbot.router._BOOK_ABBREVIATIONS` (normalize as `wiki_refs` does: strip dots and spaces, lowercase). An item is Scripture only if the **whole item** matches `^<book> <ch>(:<v>(-<v2>)?)?( & <ch2>)*$` (normalize en dashes to `-`). Otherwise `refs: []`. The summary is the text between `DESCRIPTION:` and the `📚 Further reading:` line, minus the fiction-note line, the "This short is part of a 50-part series…" paragraph and the hashtag line, with whitespace trimmed. The fiction note is the line matching `^\(.*fictional character.*\)$`.

- [ ] **Step 4: Run to verify pass**
Run: `pytest tests/chatbot/test_apologetics_import.py -v`. Expected: all pass.

- [ ] **Step 5: Commit** `feat(apologetics): parse short descriptions and further-reading refs`

---

### Task 2: Import script, track file and committed manifest

**Files:**
- Create: `scripts/import_apologetics_shorts.py`
- Create: `chatbot/data/apologetics_tracks.json`
- Generate: `chatbot/data/apologetics_shorts.json`, `frontend/public/apologetics/thumbs/01.jpg` … `13.jpg`
- Test: `tests/chatbot/test_apologetics_import_script.py`, `tests/chatbot/test_apologetics_manifest.py`

**Interfaces:**
- Consumes: Task 1 functions.
- Produces:
  - `build_manifest(source: Path, tracks: dict, fetch_title: Callable[[str], str]) -> dict` with the shape in the spec's "Built manifest" section (`tracks[]` = `{id, title, blurb, shorts: [int]}`; `shorts["<n>"]` = `{number, subject, title, youtube_id, summary, fiction_note, script, further_reading, thumbnail}`; `thumbnail` = `"/apologetics/thumbs/NN.jpg"`)
  - `main(argv) -> int`; flags `--source` (default `~/Documents/Apologetics/Shorts`), `--no-thumbs`
  - `class ImportError_(Exception)` for loud failures

Track file content (exact):

```json
{
  "tracks": [
    {"id": "bible-reliable", "title": "Is the Bible reliable?", "blurb": "How we know the Gospels are early, faithfully copied, grounded in real places, and honest eyewitness accounts.", "shorts": [1, 2, 7, 8]},
    {"id": "jesus-rose", "title": "Did Jesus rise?", "blurb": "Why the disciples' transformation, the death on the cross, and the eyewitnesses point to a real resurrection.", "shorts": [3, 4, 5, 6]},
    {"id": "morality", "title": "Where does morality come from?", "blurb": "Why right and wrong can't be decided by vote, contract or chemistry, and what that says about God.", "shorts": [9, 10, 11, 12, 13]}
  ],
  "youtube_ids": {"1": "3hl-YcJKQkk", "2": "TIFHMjGjXA4", "3": "a4ASuGSh-Ek", "4": "o1-JjQA-TbQ", "5": "TK0yn3cjhCY", "6": "qeiqu1FdTEs", "7": "k4lcPyvCWVo", "8": "7HygRgAhW6g", "9": "QoH_J7BUFkc", "10": "sMTCMBsxYY8", "11": "Sx14sr3m_6M", "12": "HLcfmGJ5EhQ", "13": "GJtSSePCZt4"}
}
```

- [ ] **Step 1: Write the failing script tests** (build a two-short source folder in `tmp_path` from the Task 1 fixtures plus a one-line script file; `fetch_title` is a fake)

```python
def test_build_manifest_uses_youtube_titles(src):
    m = build_manifest(src, TRACKS, fetch_title=lambda vid: f"YT {vid}")
    assert m["shorts"]["1"]["title"] == "YT id1"
    assert m["shorts"]["1"]["script"] == SCRIPT_TEXT
    assert m["tracks"][0]["shorts"] == [1, 3]

def test_short_without_youtube_id_has_null_id_and_no_fetch(src): ...
    # youtube_ids lacks "3" -> shorts["3"]["youtube_id"] is None; fetch_title never called with None; title falls back to the subject (only for not-uploaded shorts)

def test_title_fetch_failure_fails_import(src):
    def boom(vid): raise OSError("offline")
    with pytest.raises(ImportError_): build_manifest(src, TRACKS, fetch_title=boom)

def test_track_naming_missing_short_fails(src):
    with pytest.raises(ImportError_, match="#99"): build_manifest(src, {**TRACKS, "tracks": [{"id": "x", "title": "X", "blurb": "", "shorts": [99]}]}, fetch_title=str)

def test_rerun_is_idempotent(src): ...  # two builds -> equal dicts
```

- [ ] **Step 2: Run, verify fail.** `pytest tests/chatbot/test_apologetics_import_script.py -v` → FAIL (import error).

- [ ] **Step 3: Implement** `build_manifest` and `main`. `fetch_title` default = `httpx.get(oembed_url, timeout=10).json()["title"]`. Thumbnails: `sips -Z 480 -s format jpeg <src> --out <dest>` (skipped with `--no-thumbs`). Write JSON with `ensure_ascii=False, indent=2` and sorted short keys. Import the script in tests by path, as `test_eval_passages_script.py` does.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Run the real import.**
Run: `python scripts/import_apologetics_shorts.py`. Expected: writes 13 shorts and 13 thumbnails. Check that `jq '.shorts["12"].title' chatbot/data/apologetics_shorts.json` returns YouTube's current title, and that `du -sh frontend/public/apologetics/thumbs` is under 1 MB.

- [ ] **Step 6: Write the manifest integrity test** `tests/chatbot/test_apologetics_manifest.py` against the committed file:

```python
def test_tracks_reference_existing_shorts(): ...      # every track short number is a key in shorts
def test_track_ids_unique_and_titles_nonempty(): ...
def test_every_ref_resolves_in_complete_db(): ...     # use tabernacle_mode.verse_text(ref) != "" (skip if Complete.db absent, as test_tabernacle_spots does)
def test_every_thumbnail_exists_under_frontend_public(): ...
```

Run: `pytest tests/chatbot/test_apologetics_manifest.py -v` → PASS.

- [ ] **Step 7: Commit** the script, the track file, the manifest, the thumbnails and the tests: `feat(apologetics): import script and manifest for shorts 1-13`

---

### Task 3: Backend mode

**Files:**
- Create: `chatbot/apologetics_mode.py`
- Modify: `chatbot/router.py` (`build_mode_primer`, next to `if mode == "tabernacle"`), `chatbot/api.py` (both `post_chat` ~L397 and `_stream_chat_response` ~L633; new `GET /apologetics/tracks` beside `/characters`), `chatbot/schemas.py` (response models; add `apologetics` to the `mode` field description)
- Test: `tests/chatbot/test_apologetics_mode.py`, `tests/chatbot/test_chat_endpoint_apologetics.py`; fixture manifest `tests/chatbot/fixtures/apologetics/manifest.json` (2 tracks; one track with a short whose `youtube_id` is null; one uploaded short in no track)

**Interfaces:**
- Consumes: manifest shape (Task 2).
- Produces:
  - `SHORTS_PATH_ENV = "APOLOGETICS_SHORTS_PATH"`; `load_manifest() -> dict` (`lru_cache`; `{}` and a logged error if missing or invalid)
  - `list_tracks() -> list[dict]`: each `{"id", "title", "blurb", "shorts": [{"number", "title", "youtube_id", "thumbnail", "further_reading"}]}`. Only uploaded shorts are playable, but not-uploaded ones are included with `youtube_id: None` (shown as "Coming soon"). Tracks with no uploaded shorts are omitted. No `script` or `summary`.
  - `primer(mode_params) -> dict`: `{"type": "chat", "message": INTRO, "data": None, "route": "Mode primer → apologetics", "follow_up_questions": [], "artifacts": [{"type": "apologetics_track", "label": <track title>, "params": {"trackId": <id>}}]}`. For an unknown or missing `track_id`: the message is "That track isn't available any more — pick another from the start page." and `artifacts` is `[]`.
  - `grounding_for(track_id: str, current_short: int | None, watched: list[int]) -> str`
  - `async answer(message, history, mode_params) -> dict` (same contract as `tabernacle_mode.answer`, `data: None`)
  - Mode params read (snake_case): `track_id`, `current_short`, `watched_shorts`
  - Schemas: `ApologeticsShort`, `ApologeticsTrack`, `ApologeticsTracksResponse { tracks: List[ApologeticsTrack] }`

INTRO (exact): "Watch each short in this track, then ask me anything about it. When you've watched them all, we can talk through the whole track together."

SYSTEM_PROMPT must state, in this order: role (a friendly guide to a series of short apologetics videos); the shorts below are the basis for every answer; quote and cite Scripture as "Book chapter:verse"; never add historical facts, statistics, quotes, scholars or arguments the material lacks, and say plainly when the series doesn't cover something yet; refer to a short **only by its title in quotes**, never by number, and for a short in another track also name that track; never name a short that isn't listed; the stories' characters are fictional, so you may recall a short's story briefly to connect to what the user watched, but never present its characters as real people or sources; don't spoil an unwatched short beyond saying it's covered later in the track; tone plain, warm, confident, not combative, short.

- [ ] **Step 1: Write the failing tests** (`monkeypatch.setenv(SHORTS_PATH_ENV, fixture)` plus `load_manifest.cache_clear()` autouse, as in `test_tabernacle_mode.py`)

```python
def test_list_tracks_hides_empty_tracks_and_scripts(): ...
def test_primer_returns_track_artifact():
    r = primer({"track_id": "t1"})
    assert r["artifacts"] == [{"type": "apologetics_track", "label": "Track One", "params": {"trackId": "t1"}}]
def test_primer_unknown_track():
    r = primer({"track_id": "gone"}); assert r["artifacts"] == [] and "isn't available" in r["message"]
def test_grounding_has_track_shorts_in_full_and_catalogue_for_others():
    g = grounding_for("t1", current_short=1, watched=[1])
    assert SCRIPT_1 in g and "WATCHING NOW" in g          # current marker
    assert "Loose Short Title" in g and SCRIPT_LOOSE not in g   # catalogue line only
    assert "fictional characters" in g
def test_grounding_ignores_stale_params():
    assert grounding_for("t1", current_short=999, watched=[999, "x"])  # no error, no marker
async def test_answer_grounds_links_refs_and_follow_ups(monkeypatch): ...  # fake call_ollama_with_context/generate_llm_follow_ups like test_tabernacle_mode.py:96-105; assert research_data == grounding_for(...), message passed through wiki_refs (contains "/explorer?reference=")
async def test_answer_failure_message(monkeypatch): ...
```

Endpoint tests (`client` fixture): `GET /apologetics/tracks` returns the fixture tracks; `POST /chat` with `mode=apologetics`, empty message → the primer; a non-empty message → `apologetics_mode.answer` is called (monkeypatched) in both the plain and stream paths, mirroring `test_tabernacle_mode.py:210-240`.

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the module and wiring. Grounding layout: a `THIS TRACK: <title>` header, then per short `### "<title>"` with `[WATCHING NOW]` / `[watched]` / `[not watched yet]`, its script, summary, fiction note and further-reading texts. Then `OTHER SHORTS IN THE SERIES:` with one line per other uploaded short: `- "<title>" (track: <track titles or "none">): <first sentence of summary>`.
- [ ] **Step 4: Run** `pytest tests/chatbot/test_apologetics_mode.py tests/chatbot/test_chat_endpoint_apologetics.py tests/chatbot/test_mode_primers.py -v` → PASS.
- [ ] **Step 5: Commit** `feat(apologetics): backend mode, primer, grounded answers and track list`

---

### Task 4: Frontend types, data and registration

**Files:**
- Modify: `frontend/src/types/session.ts` (L4 `SessionMode` += `'apologetics'`; L67 artifact `type` += `'apologetics_track'`; `ModeParams` += fields below; new param and data interfaces)
- Modify: `frontend/src/lib/chatApi.ts` (~L95 camel→snake cases)
- Modify: `frontend/src/lib/modeData.ts` (`listApologeticsTracks`)
- Modify: `frontend/src/store/useArtifactStore.ts` (~L71 `case 'apologetics_track': return link.params`)
- Modify: `frontend/src/store/useSessionsStore.ts` (~L59 `apologetics: 'Defend the Faith'`)
- Modify: `frontend/src/components/shell/SessionsPane.tsx` (L40 `MODE_ORDER` before `'freeform'`; L54 icon `Shield`)
- Test: `frontend/src/lib/chatApi.test.ts`, `frontend/src/lib/modeData.test.ts` (new)

**Interfaces:**
- Produces:
  - `ModeParams`: `trackId?: string`, `watchedShorts?: number[]`, `currentShort?: number`, `trackCompletePrompted?: boolean`
  - Mapping: `trackId→track_id`, `watchedShorts→watched_shorts`, `currentShort→current_short`, `trackCompletePrompted→track_complete_prompted`
  - `interface ApologeticsTrackArtifactParams { trackId: string }`
  - `interface ApologeticsShort { number: number; title: string; youtube_id: string | null; thumbnail: string; further_reading: { text: string; refs: string[] }[] }`
  - `interface ApologeticsTrack { id: string; title: string; blurb: string; shorts: ApologeticsShort[] }`
  - `listApologeticsTracks(): Promise<ApologeticsTrack[]>` (GET `/api/bible-chat/apologetics/tracks`, memoized; a rejected promise is not cached)

- [ ] **Step 1: Write failing tests:** the mapping test (`toSnakeModeParams` or whatever the existing mapper in `chatApi.ts` is called) asserts the four keys; the `modeData` test mocks `fetch` and asserts one network call for two `listApologeticsTracks()` calls, and a retry after a failure.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/lib && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(apologetics): frontend types, params mapping and track data`

---

### Task 5: Playlist artifact

**Files:**
- Create: `frontend/src/lib/youtubePlayer.ts`, `frontend/src/lib/apologeticsEvents.ts`, `frontend/src/components/artifacts/ApologeticsTrackArtifact.tsx`
- Modify: `frontend/src/components/shell/ArtifactPane.tsx` (~L101, beside `tabernacle`)
- Test: `frontend/src/components/artifacts/ApologeticsTrackArtifact.test.tsx`

**Interfaces:**
- Consumes: Task 4 types and `listApologeticsTracks`; `useSessionsStore` (`updateModeParams`); `useArtifactStore.openArtifact`.
- Produces:
  - `youtubePlayer.ts`: `loadYouTubeApi(): Promise<YTApi>` (injects `https://www.youtube.com/iframe_api` once, resolves on `onYouTubeIframeAPIReady`, rejects after 10 s); `createPlayer(el: HTMLElement, videoId: string, on: { ended(): void; error(): void }): Promise<{ load(videoId: string): void; destroy(): void }>` with `host: 'https://www.youtube-nocookie.com'` and `playerVars: { rel: 0, playsinline: 1 }`
  - `apologeticsEvents.ts`: `emitAsk(e: { sessionId: string; shortNumber: number; title: string })`, `onAsk(fn) => unsubscribe`, `emitTrackComplete(e: { sessionId: string; trackTitle: string })`, `onTrackComplete(fn) => unsubscribe`
  - `<ApologeticsTrackArtifact trackId />`: the shown session comes from the `?session=` URL param, as `TabernacleArtifact` does

Behaviour (copy is exact):
- Header: track title and `"{watched} / {uploaded}"`. List rows: thumbnail (40 px wide), YouTube title, and ✓ (watched), ▸ (current) or ○. Not-uploaded rows are greyed, not clickable, and labelled "Coming soon". Clicking a row sets `modeParams.currentShort` and loads it in the player.
- The default current short is `modeParams.currentShort`, else the first unwatched uploaded short, else the first uploaded short.
- Under the player: the title, then the buttons "Ask about this" (disabled until watched) and "Mark watched" (hidden once watched), then further-reading chips: one button per ref, labelled `item.text` (with ` (n)` appended when an item has several refs). Each opens `{ type: 'interlinear', label: `${ref} ▸`, params: { reference: ref } }`. Items without refs show as plain text.
- On ENDED or Mark watched: add the short to `watchedShorts` (deduplicated) and advance `currentShort` to the next unwatched uploaded short without playing it. If every uploaded short is now watched, call `emitTrackComplete`.
- Player error, or `loadYouTubeApi` rejected: show "This short can't play here." with a link "Watch on YouTube" (`https://www.youtube.com/shorts/<id>`, new tab). Mark watched still works.
- Unknown trackId (not in the list): show "This track is no longer available."
- Layout: the player box is `aspect-[9/16]`, with height capped at `55vh` and centred. The list scrolls below it.

- [ ] **Step 1: Write failing tests** (mock `youtubePlayer` with `vi.mock`, capture the `on` callbacks; mock `listApologeticsTracks`)

```tsx
it('lists shorts by title with progress and coming soon')       // "1 / 2", a "Coming soon" row is not a button
it('marks watched on ended and advances without autoplay')       // on.ended() -> watchedShorts [1], currentShort 2, load() not called for 2 until clicked
it('mark watched button works and emits track complete once all are watched')
it('ask disabled until watched, emits ask with title')
it('ref chip opens an interlinear artifact')                     // "John 19:31–37" -> openArtifact({type:'interlinear', ..., params:{reference:'JHN 19:31-37'}})
it('falls back when the player errors')                          // on.error() -> "Watch on YouTube" link with /shorts/<id>
it('renders unavailable track')
```

- [ ] **Step 2: Run** `npx vitest run src/components/artifacts/ApologeticsTrackArtifact.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the components and register the artifact in `ArtifactPane` (import, params type, render branch).
- [ ] **Step 4: Run the tests, `npx tsc --noEmit` and `npm run lint`** → PASS.
- [ ] **Step 5: Commit** `feat(apologetics): playlist artifact with YouTube player and progress`

---

### Task 6: Mode picker, track picker and chat wiring

**Files:**
- Modify: `frontend/src/components/shell/ModePickerScreen.tsx` (a tile before "Walk the Tabernacle")
- Modify: `frontend/src/components/shell/ChatPane.tsx` (`retryChoices` ~L1078; `resolveChoice` ~L904; the artifact-card branch ~L1280; event subscriptions next to the tabernacle viewer-event effect ~L784)
- Test: `frontend/src/components/shell/ModePickerScreen.test.tsx`, `frontend/src/components/shell/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `listApologeticsTracks` (Task 4); `onAsk` and `onTrackComplete` (Task 5); the existing `startWithFetchedChoices`, `resolveChoice`, `sendMessageRef.current(text, undefined, extraModeParams)`, `isBusyRef`, `appendMessage`, `updateModeParams`, `useArtifactStore.openArtifact`.

Behaviour (copy is exact):
- Tile: a `Shield` icon and "Defend the Faith", with `title` attribute "Be ready always to give an answer — 1 Peter 3:15". On click, call `startWithFetchedChoices('apologetics', '🛡️ Defend the Faith', 'Be ready always to give an answer (1 Peter 3:15). Which question would you like to work through?', ...)`. Each choice is labelled `` `${t.title} — ${t.shorts.filter(s => s.youtube_id).length} shorts` `` with `modeParams: { trackId: t.id, watchedShorts: [] }`. Add the same mapping to `retryChoices` for `session.mode === 'apologetics'`.
- `resolveChoice`: after appending the primer reply in an `apologetics` session, open its `apologetics_track` artifact when not at phone width (`(max-width: 767px)` does not match). Use the same check as `ModePickerScreen.startSession`.
- Artifact card for `apologetics_track`: the same card style as tabernacle, with a `Shield` icon, title "Open the playlist" and subtitle "Watch the shorts in this track and track your progress".
- `onAsk`: only for the current session in `apologetics` mode and when not busy. Calls `sendMessageRef.current(\`Tell me more about "${title}".\`, undefined, { currentShort: shortNumber })`.
- `onTrackComplete`: only for the current session, and only if `!modeParams.trackCompletePrompted`. Sets `trackCompletePrompted: true` and appends an assistant message with the text `` `You've finished **${trackTitle}**. Want to talk through the whole track?` `` and `followUpQuestions: ['Discuss the whole track', 'How do these arguments fit together?', 'Which objection is hardest to answer?']`.

- [ ] **Step 1: Write failing tests**

```tsx
// ModePickerScreen.test.tsx
it('Defend the Faith tile posts track choices')        // mocked listApologeticsTracks -> pill "Did Jesus rise? — 4 shorts"
// ChatPane.test.tsx
it('picking a track fetches the primer and opens the playlist')
it('ask event sends the titled question with currentShort') // postChat body mode_params.current_short === 5, message 'Tell me more about "Did Jesus Really Die on the Cross?".'
it('ignores ask while busy')
it('track complete posts the prompt once')
it('does not prompt twice')                              // trackCompletePrompted already true -> no new message
```

- [ ] **Step 2: Run** `npx vitest run src/components/shell` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suites:** `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint`, then `cd .. && pytest tests/chatbot -q` → all pass.
- [ ] **Step 5: Commit** `feat(apologetics): mode tile, track picker and chat wiring`

---

### Task 7: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md`: add a "Defend the Faith mode (internal id `apologetics`)" section after Walk the Tabernacle. Cover the source folder, the track file, the re-import command, titles from YouTube oEmbed (so re-import after renaming a video), the grounding rules (shorts are the basis, titles not numbers, fictional characters), the once-per-session complete prompt, and the CSP note (`www.youtube-nocookie.com`, `www.youtube.com`, `i.ytimg.com`).

- [ ] **Step 1: Write the CLAUDE.md section.**
- [ ] **Step 2: Run the app** (use the `run` skill). Check this flow: tile → pick "Did Jesus rise?" → the playlist opens → play a short to the end (or press Mark watched) → ✓ appears and the next short is selected but not playing → Ask → the reply names shorts by title and has explorer links → mark the rest watched → the complete prompt appears once → reload → progress is kept. Take a screenshot of the panel.
- [ ] **Step 3: Commit** `docs(apologetics): document Defend the Faith mode`

---

## Adding shorts later (for the user; goes into CLAUDE.md in Task 7)

1. Upload the short and save its `NN <Subject> - script.txt`, `- description.txt` and `- thumbnail.jpg` in the Shorts folder.
2. In `chatbot/data/apologetics_tracks.json`, add its YouTube id under `youtube_ids`. Then add its number to a track, or add a new track.
3. Run `python scripts/import_apologetics_shorts.py`, run the tests, commit and deploy.
