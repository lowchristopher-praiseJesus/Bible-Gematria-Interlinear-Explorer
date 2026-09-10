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

## Key Conventions

- HTML templates are Python string literals with `{{{PLACEHOLDER}}}` markers replaced via `.replace()` — not Jinja2.
- `~` is the field delimiter inside multi-value database columns; always `.split('~')` before iterating.
- Strong's numbers are prefixed: `H` for Hebrew, `G` for Greek. Display width CSS class is derived from the number's string length (e.g., `s-4` for a 5-char number).
- `ROW_RESULT_LIMIT = 20000` caps English search results to prevent runaway queries.
- The `LC_/` directory (manuscript page images) is deployed to the web server root, not inside the Flask app.
