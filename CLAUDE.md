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

**Caching:** `flask_caching` with filesystem cache (`CACHED_PAGES/` dir, threshold 150k entries, ~17-year TTL). The expensive view functions (`explorer_view`, `strongs_html`, `gematria_html`, `english_html`, `apoc`) are decorated with `@cache.memoize`. The cache must be cleared manually when data changes.

**Routes:**
- `/explorer` — main interlinear view; accepts `versenumber` (1–31102), `reference` (text like "Genesis 1:1"), or `book`/`chapter`/`verse` (numeric)
- `/strongs` — Strong's number lookup (e.g., `H622`, `G726`)
- `/gematria` — search by numeric value (words and verse totals)
- `/english` — full-text search of KJV verse text
- `/LC_/<path>` — served statically from `/var/www/html/LC_/` (Leningrad Codex manuscript images, not in repo)

**Verse numbering:** Verses 1–23145 are Hebrew OT (WLC), 23146–31102 are Greek NT (TR 1894 / Stephanus 1550), and beyond 31102 are Apocrypha (accessed via reference string, not sequential number).

**Frontend:** `static/script-v1.1.js` (jQuery-based) + `static/style-v1.1.css`. The JS handles: cookie-based KJV/AV and TR1894/Stephanus manuscript toggles, Strong's definition display in the info box, gematria checkbox totals, transliteration hover display, qere/ketiv toggling, autocomplete for verse references, and clipboard copy.

## Key Conventions

- HTML templates are Python string literals with `{{{PLACEHOLDER}}}` markers replaced via `.replace()` — not Jinja2.
- `~` is the field delimiter inside multi-value database columns; always `.split('~')` before iterating.
- Strong's numbers are prefixed: `H` for Hebrew, `G` for Greek. Display width CSS class is derived from the number's string length (e.g., `s-4` for a 5-char number).
- `ROW_RESULT_LIMIT = 20000` caps English search results to prevent runaway queries.
- The `LC_/` directory (manuscript page images) is deployed to the web server root, not inside the Flask app.
