# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Flask web application for interlinear Bible study and gematria (Hebrew/Greek numerical value) search. It serves a read-only SQLite database (`Complete.db`) and generates all HTML server-side.

## Running Locally

```bash
# Install dependencies
pip install flask flask_caching dataset

# Run development server
python myproject.py
```

For production deployment, see `Installation.txt` — it uses uWSGI + nginx on Ubuntu, with the app mounted at `/explorer`, `/strongs`, `/gematria`, and `/english`.

## Architecture

**Single-file backend:** All route logic lives in `myproject.py`. There are no templates — HTML is constructed via f-string/concatenation with shared `page_head`, `page_foot`, `search_group_1`, and `search_group_2` globals.

**Database:** `Complete.db` (SQLite, not in repo — must be uploaded separately). Accessed via the `dataset` library. Two main tables:
- `Complete` — one row per Bible verse (31,102 canonical + Apocrypha), storing KJV text, original Hebrew/Greek words, Strong's numbers, gematria values, and manuscript image references. Verse fields use `~` as a delimiter for multi-word columns (e.g., `KJV_Text`, `Root`, `Original_Words`).
- `Strongs_` — Strong's Concordance definitions for Hebrew (`H*`) and Greek (`G*`) numbers.
- `APOC` — Apocrypha verse text for the 1611 AV.
- `shares.db` — separate writable SQLite file (not `Complete.db`). One row per shared conversation: an immutable snapshot (messages + artifact links + notes) keyed by a random token. Written by `POST /api/share`, read by `GET /api/share/<token>`. See `share_store.py`.

**Caching:** `flask_caching` with filesystem cache (`CACHED_PAGES/` dir, threshold 150k entries, ~17-year TTL). The expensive view functions (`explorer_view`, `strongs_html`, `gematria_html`, `english_html`, `apoc`) are decorated with `@cache.memoize`. The cache must be cleared manually when data changes.

**Routes:**
- `/explorer` — main interlinear view; accepts `versenumber` (1–31102), `reference` (text like "Genesis 1:1"), or `book`/`chapter`/`verse` (numeric)
- `/strongs` — Strong's number lookup (e.g., `H622`, `G726`)
- `/gematria` — search by numeric value (words and verse totals)
- `/english` — full-text search of KJV verse text
- `/api/share` — `POST` a session snapshot, returns `{ token, url }` (`url` = `<origin>/#import=<token>` — the token is in the URL *fragment*, so it never reaches the server / access logs)
- `/api/share/<token>` — `GET` the snapshot for import; `404` if unknown
- `/LC_/<path>` — served statically from `/var/www/html/LC_/` (Leningrad Codex manuscript images, not in repo)

**Verse numbering:** Verses 1–23145 are Hebrew OT (WLC), 23146–31102 are Greek NT (TR 1894 / Stephanus 1550), and beyond 31102 are Apocrypha (accessed via reference string, not sequential number).

**Frontend:** `static/script-v1.1.js` (jQuery-based) + `static/style-v1.1.css`. The JS handles: cookie-based KJV/AV and TR1894/Stephanus manuscript toggles, Strong's definition display in the info box, gematria checkbox totals, transliteration hover display, qere/ketiv toggling, autocomplete for verse references, and clipboard copy.

## Conversation sharing

Conversations ("sessions") live only in the browser (`localStorage`,
Zustand `persist`, key `bible-explorer-sessions`). The Share button in
the chat header POSTs a snapshot to `shares.db` and yields a
`/#import=<token>` link (token in the fragment — kept out of Referer
headers and server logs). Opening that link imports the conversation into
the recipient's local history as a new session carrying an `imported`
marker; `SessionsPane` shows those under a dedicated **Imported**
section (their real `mode` is preserved). Snapshots are immutable — no
expiry, no revocation. See
`docs/superpowers/specs/2026-09-07-conversation-sharing-design.md`.

## Devotional "Pick one for me"

The system-picked seed verse is a deterministic draw from
`chatbot/data/devotional_verses.py` (`DEVOTIONAL_POOL`, ≥366 USFM refs),
dealt as a per-browser seeded shuffled deck by
`chatbot/devotional_rotation.py::pick_from_rotation(seed, cursor)`. The
client (`useDevotionalRotationStore`) holds the random per-browser `seed`
and a monotonic `cursor` and passes them in `mode_params`
(`rotation_seed` / `rotation_cursor`). Themed and typed-reference picks
still go through `pick_verse_for_theme` / `_resolve_verse_reference`.
Validate the pool with `scripts/validate_devotional_pool.py` (`--runtime`
checks the live fetch path, not just `Complete.db`). Editing the pool
(adding, removing, or reordering entries) is a rotation-continuity break —
it reshuffles every existing browser's deck and can re-serve verses
clients already saw — so pool changes must be rare and deliberate and will
trip `test_devotional_rotation.py::test_rotation_sequence_is_pinned`. See
`docs/superpowers/specs/2026-09-10-devotional-annual-rotation-design.md`.

## Devotional audio (Listen) and devotional-of-the-day

The "Listen" button (`DevotionalListenOverlay`, `POST
/devotional/audio`) turns a devotional's text into narration + a fixed
background bed via Google Cloud TTS (Neural2) and `ffmpeg`, mixed at
settings that are locked constants, not user-configurable, for v1
(`chatbot/devotional_audio.py`). The "Pick one for me" rotation path
additionally caches the first devotional generated each GMT+8 calendar
day (`chatbot/devotional_of_day.py`) and serves it to every later
rotation request that same day; typed-reference and theme picks never
touch that cache. Both `devotional_of_day` calls in
`chatbot/devotional.py` fail open — a read/write failure there falls
back to (or simply skips) the cache rather than blocking generation. See
`docs/superpowers/specs/2026-09-17-devotional-audio-design.md` for the
full design, and `DEPLOYMENT.md`'s "Devotional audio (Listen) and
devotional-of-the-day" section for the Docker volumes and the manual GCP
credential step.

## Deep Study mode (internal id `hermeneutics`)

Runs a passage (a verse or a range of at most 25 verses — see
`MAX_PASSAGE_VERSES`, sized to fit every curated parable) through a fixed
8-phase interpretive methodology,
one LLM call per phase, orchestrated by `chatbot/hermeneutics.py` with
the prompts in `chatbot/hermeneutics_phases.py`. Phases 2, 4 and 7 are
grounded in real `Complete.db` lookups (interlinear words and Strong's
entries via the new dependency-free readers in `chatbot/bible_search.py`,
English full-text search, and witness-verse verification against `Complete.db` that **drops any
reference that does not resolve**); the rest run on model knowledge over
the passage and the prior phases.

Each completed phase is pushed to the browser as an additive `phase` SSE
event — the `stream` / single `final` / terminal `trace` contract is
otherwise unchanged — and stored on the assistant message, so a reload or
a share link shows the finished run. The whole report also opens in the
artifact pane (`hermeneutics_report`, carried inline like `devotional`).

A passage can be named by reference **or described** ("the parable of the
ten virgins", "Jesus feeding the 5000"): resolution tries a reference typed
in this message (ranges kept), then the parable's full name as a phrase
against the existing `chatbot/data/parables.py` table (or the word "parable"
plus its distinctive words — no LLM call), then the session's chosen passage,
then one short LLM completion with a single retry. Conversation history is
never a reference source, and only a completed run or the primer sets the
session reference — the claim, narrowing and no-text replies do not.
The LLM call also distinguishes a passage from a
doctrinal **claim** ("verify this claim — the patriarchs rise with the
Church"): a claim is never run, because the eight phases interpret one
passage and a claim is a proposition to test across several. The mode says
so and offers the passage that bears on it most directly. However it
resolved, the passage is then checked to actually have text in
`Complete.db` — an unresolvable or typo'd reference
stops the run before Phase 1 rather than letting eight phases analyse an
empty string. A resolution the user did
not type verbatim is echoed back before Phase 1 runs, as an index-0 `phase`
event. Resolution failure asks for a reference rather than guessing. Note
that the 25-verse cap is sized to the parable corpus — 12 of the 42 parables
exceed 12 verses, the longest being the Prodigal Son at 22 — so lowering it
would start rejecting named parables.

The curated idiom rulings in `chatbot/data/hermeneutic_rulings.py` are
injected only when their trigger phrases match the passage. Every proof
text is verified against `Complete.db` by
`tests/chatbot/test_hermeneutic_rulings.py`. **Editing `RULINGS` changes
the mode's doctrinal output** — the methodology encodes a specific
free-grace/dispensational position deliberately, and Phase 8's three tests
are *disclosure, never enforcement*: a failed test is reported with a
caution banner and never triggers a rewrite. See
`docs/superpowers/specs/2026-09-16-hermeneutics-mode-design.md`.

## Chat with a Character mode (internal id `character`)

The user picks one of the profiles in `characters/*.md` (49; `characters/README.md`
is the manifest — id, name, testament, one-line summary — parsed by
`chatbot/character_loader.py`) and talks with that person. The LLM answers in the
first person **as the character, grounded solely on that profile**: the whole
profile goes into every turn (0.7k–2.8k words, so no retrieval), and the persona
prompt in `chatbot/character_chat.py` forbids adding anything the profile does not
say, breaking character, or mentioning the profile or how it was made. Uncovered
questions get an in-character "I don't know / it wasn't recorded". Scripture
references in replies are linked via `wiki_refs`; follow-ups come from
`generate_llm_follow_ups`. The session's opening turn is a short in-character
greeting (`character_chat.greeting`, static fallback if the LLM fails).

Wiring mirrors Socratic/Topical: `GET /characters` lists them; every turn of a
`mode=character` session (`mode_params.character_id`) routes to
`character_chat.answer` in both `post_chat` and `_stream_chat_response` (whole reply
in one `final` event, no token streaming); the frontend picker is
`CharacterPickerScreen` (opened from `ModePickerScreen`), and the character lives in
`modeParams` (`characterId`/`characterName`) so reloads and share links restore it.
**Jesus is deliberately excluded** (`EXCLUDED_IDS` in `character_loader.py`) because
voicing him in the first person may be sensitive — removing that entry re-enables
him. `characters/` must ship in the chatbot image (`Dockerfile.chatbot`, covered by
`test_chatbot_image_ships_the_profiles`).

## Key Conventions

- HTML templates are Python string literals with `{{{PLACEHOLDER}}}` markers replaced via `.replace()` — not Jinja2.
- `~` is the field delimiter inside multi-value database columns; always `.split('~')` before iterating.
- Strong's numbers are prefixed: `H` for Hebrew, `G` for Greek. Display width CSS class is derived from the number's string length (e.g., `s-4` for a 5-char number).
- `ROW_RESULT_LIMIT = 20000` caps English search results to prevent runaway queries.
- The `LC_/` directory (manuscript page images) is deployed to the web server root, not inside the Flask app.
