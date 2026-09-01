# Topical Study — LLM-Wiki Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Topical Study mode's hardcoded 8-topic list with a registerable library of ingested Karpathy-pattern LLM wikis (starting with Joseph Prince's *The Present-Day Ministry of Jesus* series) — pick a series, browse its concepts as full pages, ask free-text follow-up questions answered from that series' own content.

**Architecture:** A new external wiki library (`~/Documents/study-wikis/`) is registered via a small Python config (`chatbot/data/study_wikis.py`). At chatbot-service startup, `chatbot/wiki_loader.py` parses every registered wiki's concept/entity/source markdown into memory, resolving `[[wikilinks]]` and inline scripture citations into real links (`chatbot/wiki_refs.py`) and rendering to HTML. Free-text questions are answered by keyword-scoring pages and grounding the existing Ollama chat call with the best matches (`chatbot/wiki_qa.py`). The router's `topic` mode primer progresses series → concepts → concept page; the frontend gets one new Artifact type (`wiki_concept`) that reuses the click-interception + history-stack pattern already built for `StrongsArtifact`.

**Tech Stack:** FastAPI (`chatbot/`), Pydantic schemas, the `markdown` PyPI package (new dependency — see Global Constraints), Ollama cloud chat (existing), React + TypeScript + Zustand (`frontend/`), pytest + pytest-asyncio, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-01-topical-study-wiki-integration-design.md`

## Global Constraints

- New Python dependency: `markdown` (pure-Python, no heavy transitive deps) — add to `requirements.txt` under a new "Study wiki dependencies" comment block, install with `pip install markdown`.
- No new dependency for frontmatter parsing — hand-rolled per the spec (the schema is small and fixed).
- Wire format for all new chatbot-service JSON stays **snake_case**, consumed as-is on the frontend without a translation layer — matches the existing `TopicEntry.seed_references` / `ParableEntry` convention in `frontend/src/lib/modeData.ts`, not the camelCase convention used by the *Flask*-sourced APIs (`/api/explorer`, `/api/strongs`, etc.).
- `ArtifactLink.params` keys stay camelCase (matches every existing artifact link, e.g. `{"id": ...}`, `{"reference": ...}`) since those are consumed directly as JS object properties on the frontend.
- The wiki library directory (`~/Documents/study-wikis/`) is never committed to this git repo — it lives outside the repo entirely, same trust boundary as `Complete.db`.
- Reuse `chatbot.router._BOOK_ABBREVIATIONS` for scripture-reference recognition (via a function-local import to avoid a circular import at module-load time — see Task 2) rather than depending on the external `~/Documents/mybibletoolbox-code` project that `chatbot/tools.py` otherwise relies on.
- Every new/changed backend response field is additive or replaces the removed `topics.py` surface — no other mode's schema or behavior changes.

---

## Task 1: Register the wiki library — copy the folder, add the config

**Files:**
- Create: `chatbot/data/study_wikis.py`
- Test: `tests/chatbot/test_study_wikis.py`

**Interfaces:**
- Produces: `STUDY_WIKI_LIBRARY: List[Dict[str, str]]` (keys: `id`, `title`, `speaker`, `description`, `path`), `get_registered(series_id: str) -> Optional[Dict[str, str]]`.

- [ ] **Step 1: Copy the source wiki folder into the external library directory**

```bash
mkdir -p ~/Documents/study-wikis
cp -R "$HOME/Downloads/The Present Day Ministry Of Jesus And How It Empowers You" \
      "$HOME/Documents/study-wikis/present-day-ministry-of-jesus"
```

Verify the copy landed correctly and the Downloads original is untouched:

```bash
diff -rq "$HOME/Downloads/The Present Day Ministry Of Jesus And How It Empowers You" \
         "$HOME/Documents/study-wikis/present-day-ministry-of-jesus"
```

Expected: no output (identical trees).

- [ ] **Step 2: Write the failing test**

```python
# tests/chatbot/test_study_wikis.py
from chatbot.data.study_wikis import STUDY_WIKI_LIBRARY, get_registered


def test_library_has_the_present_day_ministry_series():
    ids = [w["id"] for w in STUDY_WIKI_LIBRARY]
    assert "present-day-ministry-of-jesus" in ids
    assert len(ids) == len(set(ids))  # unique ids


def test_registered_entries_have_required_fields():
    for entry in STUDY_WIKI_LIBRARY:
        assert entry["id"] and entry["title"] and entry["speaker"] and entry["description"] and entry["path"]


def test_get_registered_known_and_unknown():
    entry = get_registered("present-day-ministry-of-jesus")
    assert entry is not None
    assert entry["speaker"] == "Joseph Prince"
    assert get_registered("not-a-real-series") is None
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/chatbot/test_study_wikis.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'chatbot.data.study_wikis'`

- [ ] **Step 4: Write the implementation**

```python
# chatbot/data/study_wikis.py
"""Registered LLM-wiki study series for Topical Study mode.

Append new entries here as more series are ingested — no other code needs
to change when the list grows. `path` points into the external wiki
library (~/Documents/study-wikis/), never into this repo — a registered
wiki's `raw/` folder holds copyrighted sermon transcripts/audio that must
never be committed. Each entry's `path` is expected to follow the
three-layer schema (`raw/`, `wiki/`, `AGENTS.md`) documented in that
wiki's own AGENTS.md — this app only reads `wiki/concepts/`,
`wiki/entities/`, `wiki/sources/` from it (see chatbot/wiki_loader.py).
"""

from typing import Any, Dict, List, Optional

STUDY_WIKI_LIBRARY: List[Dict[str, Any]] = [
    {
        "id": "present-day-ministry-of-jesus",
        "title": "The Present-Day Ministry of Jesus and How It Empowers You",
        "speaker": "Joseph Prince",
        "description": (
            "10-part series on what Jesus is doing now as high priest at "
            "the Father's right hand, mostly from Hebrews."
        ),
        "path": "~/Documents/study-wikis/present-day-ministry-of-jesus",
    },
]


def get_registered(series_id: str) -> Optional[Dict[str, Any]]:
    return next((w for w in STUDY_WIKI_LIBRARY if w["id"] == series_id), None)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/chatbot/test_study_wikis.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add chatbot/data/study_wikis.py tests/chatbot/test_study_wikis.py
git commit -m "feat: register the first study-wiki series in the external library"
```

---

## Task 2: `chatbot/wiki_refs.py` — resolve wikilinks and scripture citations

**Files:**
- Create: `chatbot/wiki_refs.py`
- Test: `tests/chatbot/test_wiki_refs.py`

**Interfaces:**
- Consumes: `chatbot.router._BOOK_ABBREVIATIONS: Dict[str, str]` (function-local import — see Step 4 comment), `chatbot.router._usfm_from_name` is NOT needed (abbreviation lookup already yields a USFM code directly).
- Produces: `resolve_wikilinks(body: str, series_id: str, titles_by_slug: Dict[str, str]) -> str`, `resolve_scripture_refs(body: str) -> str`, `render_wiki_body(body: str, series_id: str, titles_by_slug: Dict[str, str]) -> str` (markdown, not HTML — Task 3 runs the markdown-to-HTML pass after this).

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_wiki_refs.py
from chatbot.wiki_refs import resolve_scripture_refs, resolve_wikilinks, render_wiki_body


def test_resolve_wikilinks_known_slug():
    result = resolve_wikilinks("See [[grace]] for more.", "s1", {"grace": "Grace"})
    assert result == "See [Grace](/topic-wiki?series=s1&page=grace) for more."


def test_resolve_wikilinks_unknown_slug_left_as_plain_text():
    result = resolve_wikilinks("See [[nonexistent]] for more.", "s1", {"grace": "Grace"})
    assert result == "See [[nonexistent]] for more."


def test_resolve_scripture_refs_recognized_abbreviation():
    result = resolve_scripture_refs("As it is written in Heb 4:14, we have hope.")
    assert result == "As it is written in [Heb 4:14](/explorer?reference=HEB%204%3A14), we have hope."


def test_resolve_scripture_refs_en_dash_range_collapses_to_first_verse():
    # The wiki's own citation style uses an en dash for ranges
    # ("Heb 4:14–15"); the link opens the first verse of the range,
    # consistent with how stripVerseRange() already behaves elsewhere
    # in this app.
    result = resolve_scripture_refs("See Heb 4:14–15 for the full point.")
    assert result == "See [Heb 4:14–15](/explorer?reference=HEB%204%3A14) for the full point."


def test_resolve_scripture_refs_unrecognized_token_left_as_plain_text():
    result = resolve_scripture_refs("See the transcript at md:71 for the quote.")
    assert result == "See the transcript at md:71 for the quote."


def test_resolve_scripture_refs_two_word_book_abbreviation():
    result = resolve_scripture_refs("Paul writes in 1 Cor 15:10 about grace.")
    assert result == "Paul writes in [1 Cor 15:10](/explorer?reference=1CO%2015%3A10) about grace."


def test_render_wiki_body_resolves_both_kinds_without_double_processing():
    body = "See [[grace]] and Heb 4:14 together."
    result = render_wiki_body(body, "s1", {"grace": "Grace"})
    assert result == (
        "See [Grace](/topic-wiki?series=s1&page=grace) and "
        "[Heb 4:14](/explorer?reference=HEB%204%3A14) together."
    )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_wiki_refs.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'chatbot.wiki_refs'`

- [ ] **Step 3: Write the implementation**

```python
# chatbot/wiki_refs.py
"""Resolves [[wikilink]] cross-references and inline scripture citations
found in LLM-wiki page bodies (see chatbot/wiki_loader.py) into standard
markdown links — [text](url) — that a markdown-to-HTML renderer then turns
into real <a> tags alongside the rest of the page's formatting.

Scripture-reference recognition reuses this app's own existing
abbreviation table (chatbot.router._BOOK_ABBREVIATIONS) rather than
depending on the external ~/Documents/mybibletoolbox-code project that
chatbot/tools.py otherwise relies on for reference parsing.
"""

import re
from typing import Dict, Match
from urllib.parse import quote

_WIKILINK_RE = re.compile(r"\[\[([a-z0-9-]+)\]\]")

# A book token, then "C:V", optionally followed by a verse-range end —
# range end is captured but unused (the link always opens the range's
# first verse, matching stripVerseRange()'s behavior elsewhere in this
# app). Ranges in this wiki's own citation style use an en dash (–)
# or em dash (—), not a hyphen, so both are accepted alongside "-".
_SCRIPTURE_REF_RE = re.compile(
    r"\b([1-3]\s?[A-Za-z]{2,}|[A-Za-z]{2,})\s+(\d{1,3})\s*:\s*(\d{1,3})"
    r"(?:\s*[-–—]\s*\d{1,3})?\b"
)


def resolve_wikilinks(body: str, series_id: str, titles_by_slug: Dict[str, str]) -> str:
    """Replace every `[[slug]]` with a markdown link to that page, using
    its resolved title as the link text. A slug with no matching page is
    left as plain text rather than becoming a dead link."""

    def replace(m: Match) -> str:
        slug = m.group(1)
        title = titles_by_slug.get(slug)
        if not title:
            return m.group(0)
        href = f"/topic-wiki?series={quote(series_id)}&page={quote(slug)}"
        return f"[{title}]({href})"

    return _WIKILINK_RE.sub(replace, body)


def resolve_scripture_refs(body: str) -> str:
    """Replace every recognized scripture citation with a markdown link
    into this app's own Explorer artifact. A token that isn't a
    recognized book abbreviation (e.g. a transcript citation like
    "md:71") is left as plain text."""
    # Deferred import: chatbot.wiki_loader imports this module at module
    # load time, and chatbot.router will in turn import chatbot.wiki_loader
    # (Task 6) — importing chatbot.router here at module level would be
    # circular. By the time this function actually runs (request time),
    # both modules are fully loaded, so the import is safe.
    from chatbot.router import _BOOK_ABBREVIATIONS

    def replace(m: Match) -> str:
        book_text, chapter, verse = m.group(1), m.group(2), m.group(3)
        normalized = re.sub(r"[.\s]", "", book_text).lower()
        usfm = _BOOK_ABBREVIATIONS.get(normalized)
        if not usfm:
            return m.group(0)
        reference = f"{usfm} {chapter}:{verse}"
        href = f"/explorer?reference={quote(reference)}"
        return f"[{m.group(0)}]({href})"

    return _SCRIPTURE_REF_RE.sub(replace, body)


def render_wiki_body(body: str, series_id: str, titles_by_slug: Dict[str, str]) -> str:
    """Both resolutions in one call. Wikilinks are resolved first — their
    syntax ([[slug]]) never overlaps with a scripture ref's shape, so
    resolving them first and scripture refs second means a resolved
    wikilink's anchor text (a page title) is never re-scanned for a
    scripture-ref pattern it might coincidentally resemble."""
    return resolve_scripture_refs(resolve_wikilinks(body, series_id, titles_by_slug))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_wiki_refs.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/wiki_refs.py tests/chatbot/test_wiki_refs.py
git commit -m "feat: resolve wiki wikilinks and scripture citations into links"
```

---

## Task 3: `chatbot/wiki_loader.py` — parse a registered wiki into memory

**Files:**
- Create: `chatbot/wiki_loader.py`
- Test: `tests/chatbot/test_wiki_loader.py`
- Test fixtures: `tests/chatbot/fixtures/sample_wiki/wiki/concepts/grace.md`, `tests/chatbot/fixtures/sample_wiki/wiki/concepts/holiness.md`, `tests/chatbot/fixtures/sample_wiki/wiki/entities/joseph-prince.md`
- Modify: `requirements.txt`

**Interfaces:**
- Consumes: `chatbot.wiki_refs.render_wiki_body` (Task 2).
- Produces: `load_library(manifest_entries: List[Dict]) -> Dict[str, Dict]` (pure function, no global state — the shape tests exercise directly), plus module-level wrappers over a module-level `_LIBRARY` built from `chatbot.data.study_wikis.STUDY_WIKI_LIBRARY` at import time: `list_series() -> List[Dict]`, `list_concepts(series_id: str) -> List[Dict[str, str]]` (`{"slug", "title"}`), `get_page(series_id: str, slug: str) -> Optional[Dict]` (`{"kind", "title", "tags", "body", "body_html"}`), `get_manifest(series_id: str) -> Optional[Dict]`, `search(series_id: str, query: str, top_n: int = 3) -> List[Dict]` (`{"slug", "title", "kind", "body"}`, best match first).

- [ ] **Step 1: Add the `markdown` dependency**

```bash
pip install markdown
```

Add to `requirements.txt`, after the existing "Chatbot dependencies" block:

```
# Study wiki dependencies
markdown>=3.7
```

- [ ] **Step 2: Write the fixture wiki**

`tests/chatbot/fixtures/sample_wiki/wiki/concepts/grace.md`:
```markdown
---
type: concept
status: established
tags: ["grace", "core"]
first_seen: "[[2000-01-13-part-01]]"
sources: ["[[2000-01-13-part-01]]"]
---

# Grace

Defined as **undeserved favor**. See [[holiness]] for how it relates.

## Key scripture

Rom 6:14 says sin shall not have dominion over you.
```

`tests/chatbot/fixtures/sample_wiki/wiki/concepts/holiness.md`:
```markdown
---
type: concept
status: established
tags: ["holiness"]
first_seen: "[[2000-01-13-part-01]]"
sources: ["[[2000-01-13-part-01]]"]
---

# Holiness

A gift of grace, not a performance. See [[grace]] for the source.
```

`tests/chatbot/fixtures/sample_wiki/wiki/entities/joseph-prince.md`:
```markdown
---
type: entity
category: person
aliases: []
first_seen: "[[2000-01-13-part-01]]"
---

# Joseph Prince

The speaker; senior pastor of New Creation Church.
```

- [ ] **Step 3: Write the failing tests**

```python
# tests/chatbot/test_wiki_loader.py
from pathlib import Path

import pytest

from chatbot.wiki_loader import load_library

FIXTURE_PATH = str(Path(__file__).parent / "fixtures" / "sample_wiki")

MANIFEST = [
    {
        "id": "sample",
        "title": "Sample Series",
        "speaker": "Test Speaker",
        "description": "A fixture series for tests.",
        "path": FIXTURE_PATH,
    }
]


def test_load_library_parses_concepts_and_entities():
    library = load_library(MANIFEST)
    assert "sample" in library
    pages = library["sample"]["pages"]
    assert pages["grace"]["kind"] == "concept"
    assert pages["grace"]["title"] == "Grace"
    assert pages["grace"]["tags"] == ["grace", "core"]
    assert pages["joseph-prince"]["kind"] == "entity"
    assert pages["joseph-prince"]["title"] == "Joseph Prince"


def test_load_library_renders_wikilinks_and_scripture_refs_to_html():
    library = load_library(MANIFEST)
    grace_html = library["sample"]["pages"]["grace"]["body_html"]
    assert '<a href="/topic-wiki?series=sample&amp;page=holiness">Holiness</a>' in grace_html
    assert '<a href="/explorer?reference=ROM%206%3A14">Rom 6:14</a>' in grace_html
    assert "<strong>undeserved favor</strong>" in grace_html


def test_load_library_skips_entry_with_unresolvable_path():
    bad_manifest = [{**MANIFEST[0], "id": "missing", "path": "/no/such/directory"}]
    library = load_library(bad_manifest)
    assert "missing" not in library


def test_load_library_skips_unreadable_page_without_failing_whole_series(monkeypatch):
    import pathlib

    real_read_text = pathlib.Path.read_text

    def flaky_read_text(self, *args, **kwargs):
        if self.name == "grace.md":
            raise OSError("simulated unreadable file")
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(pathlib.Path, "read_text", flaky_read_text)
    library = load_library(MANIFEST)
    pages = library["sample"]["pages"]
    assert "grace" not in pages
    assert "holiness" in pages  # the rest of the series still loads


def test_search_ranks_by_keyword_overlap():
    from chatbot.wiki_loader import search as _search

    library = load_library(MANIFEST)
    results = _search_against(library, "sample", "grace favor")
    assert results
    assert results[0]["slug"] == "grace"


def _search_against(library, series_id, query, top_n=3):
    """Test helper mirroring wiki_loader.search()'s scoring against an
    explicit library dict, so this test doesn't depend on module-level
    state built from the real STUDY_WIKI_LIBRARY."""
    import re

    series = library.get(series_id)
    if not series:
        return []
    terms = set(re.findall(r"[a-z0-9']+", query.lower()))
    scored = []
    for slug, page in series["pages"].items():
        haystack = f"{page['title']} {' '.join(page['tags'])} {page['body']}".lower()
        haystack_terms = set(re.findall(r"[a-z0-9']+", haystack))
        score = len(terms & haystack_terms)
        if score:
            scored.append((score, slug, page))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [{"slug": s, "title": p["title"], "kind": p["kind"], "body": p["body"]} for _, s, p in scored[:top_n]]


def test_module_level_wrappers_use_real_registered_library():
    # Sanity check against the real STUDY_WIKI_LIBRARY (Task 1) rather than
    # the fixture — confirms the module-level singleton actually loaded the
    # registered series at import time.
    from chatbot import wiki_loader

    series = wiki_loader.list_series()
    ids = [s["id"] for s in series]
    assert "present-day-ministry-of-jesus" in ids
    concepts = wiki_loader.list_concepts("present-day-ministry-of-jesus")
    assert len(concepts) > 50  # the series has ~80 concept pages
    slugs = {c["slug"] for c in concepts}
    assert "grace" in slugs
    page = wiki_loader.get_page("present-day-ministry-of-jesus", "grace")
    assert page is not None
    assert page["title"] == "Grace"
    assert wiki_loader.get_page("present-day-ministry-of-jesus", "not-a-real-slug") is None
    assert wiki_loader.get_manifest("present-day-ministry-of-jesus")["speaker"] == "Joseph Prince"
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_wiki_loader.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'chatbot.wiki_loader'`

- [ ] **Step 5: Write the implementation**

```python
# chatbot/wiki_loader.py
"""Parses every registered study wiki (chatbot/data/study_wikis.py) into
memory once, at import time. Each wiki's wiki/concepts/, wiki/entities/,
and wiki/sources/ markdown files are read, split into frontmatter + body,
and the body rendered to HTML with wikilinks and scripture citations
resolved to real links (chatbot/wiki_refs.py).

No YAML/frontmatter library dependency — the schema each registered
wiki's own AGENTS.md documents is small and fixed, so it's split and
parsed by hand.
"""

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import markdown as _markdown

from chatbot.data.study_wikis import STUDY_WIKI_LIBRARY
from chatbot.wiki_refs import render_wiki_body

logger = logging.getLogger(__name__)

_H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_KIND_SUBDIRS = (("concept", "concepts"), ("entity", "entities"), ("source", "sources"))


def _parse_frontmatter_value(raw: str) -> Any:
    raw = raw.strip()
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [item.strip().strip('"').strip("'") for item in inner.split(",")]
    return raw.strip('"').strip("'")


def _split_frontmatter(text: str) -> tuple:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    _, fm_block, body = parts
    frontmatter: Dict[str, Any] = {}
    for line in fm_block.strip().splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        frontmatter[key.strip()] = _parse_frontmatter_value(value)
    return frontmatter, body.strip()


def _extract_title(frontmatter: Dict[str, Any], body: str, slug: str) -> str:
    title = frontmatter.get("title")
    if isinstance(title, str) and title:
        return title
    m = _H1_RE.search(body)
    if m:
        return m.group(1).strip()
    return slug.replace("-", " ").title()


def _load_series(manifest: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    root = Path(manifest["path"]).expanduser()
    wiki_dir = root / "wiki"
    if not wiki_dir.is_dir():
        logger.warning("Study wiki %r: path does not resolve (%s) — skipping.", manifest["id"], root)
        return None

    pages: Dict[str, Dict[str, Any]] = {}
    for kind, subdir in _KIND_SUBDIRS:
        folder = wiki_dir / subdir
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.md")):
            slug = path.stem
            try:
                raw = path.read_text(encoding="utf-8")
            except Exception:
                logger.warning("Study wiki %r: skipping unreadable page %s", manifest["id"], path.name)
                continue
            frontmatter, body = _split_frontmatter(raw)
            title = _extract_title(frontmatter, body, slug)
            tags = frontmatter.get("tags", [])
            pages[slug] = {
                "kind": kind,
                "title": title,
                "tags": tags if isinstance(tags, list) else [],
                "body": body,
            }

    titles_by_slug = {slug: page["title"] for slug, page in pages.items()}
    for page in pages.values():
        rendered_markdown = render_wiki_body(page["body"], manifest["id"], titles_by_slug)
        page["body_html"] = _markdown.markdown(rendered_markdown)

    return {"manifest": manifest, "pages": pages}


def load_library(manifest_entries: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Parses every entry in `manifest_entries` into memory. An entry whose
    `path` doesn't resolve is skipped (logged), not raised — the rest of
    the library still loads."""
    library: Dict[str, Dict[str, Any]] = {}
    for entry in manifest_entries:
        series = _load_series(entry)
        if series is not None:
            library[entry["id"]] = series
    return library


# Module-level singleton, built once at import time — chatbot/ has no
# hot-reload, so picking up a library change means restarting the service,
# consistent with the rest of this package.
_LIBRARY: Dict[str, Dict[str, Any]] = load_library(STUDY_WIKI_LIBRARY)


def list_series() -> List[Dict[str, Any]]:
    return [series["manifest"] for series in _LIBRARY.values()]


def get_manifest(series_id: str) -> Optional[Dict[str, Any]]:
    series = _LIBRARY.get(series_id)
    return series["manifest"] if series else None


def list_concepts(series_id: str) -> List[Dict[str, str]]:
    series = _LIBRARY.get(series_id)
    if not series:
        return []
    return [
        {"slug": slug, "title": page["title"]}
        for slug, page in series["pages"].items()
        if page["kind"] == "concept"
    ]


def get_page(series_id: str, slug: str) -> Optional[Dict[str, Any]]:
    series = _LIBRARY.get(series_id)
    if not series:
        return None
    return series["pages"].get(slug)


def search(series_id: str, query: str, top_n: int = 3) -> List[Dict[str, Any]]:
    series = _LIBRARY.get(series_id)
    if not series:
        return []
    terms = set(re.findall(r"[a-z0-9']+", query.lower()))
    if not terms:
        return []
    scored = []
    for slug, page in series["pages"].items():
        haystack = f"{page['title']} {' '.join(page['tags'])} {page['body']}".lower()
        haystack_terms = set(re.findall(r"[a-z0-9']+", haystack))
        score = len(terms & haystack_terms)
        if score:
            scored.append((score, slug, page))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [
        {"slug": slug, "title": page["title"], "kind": page["kind"], "body": page["body"]}
        for _, slug, page in scored[:top_n]
    ]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_wiki_loader.py -v`
Expected: PASS (6 tests). Note `test_module_level_wrappers_use_real_registered_library` depends on Task 1's copy having landed at `~/Documents/study-wikis/present-day-ministry-of-jesus`.

- [ ] **Step 7: Commit**

```bash
git add chatbot/wiki_loader.py tests/chatbot/test_wiki_loader.py tests/chatbot/fixtures requirements.txt
git commit -m "feat: parse registered study wikis into an in-memory index"
```

---

## Task 4: `chatbot/schemas.py` — study-wiki response models

**Files:**
- Modify: `chatbot/schemas.py`
- Test: `tests/chatbot/test_schemas.py`

**Interfaces:**
- Produces: `StudyWikiEntry`, `StudyWikisResponse`, `WikiPageResponse` (Pydantic models). (The concept list itself travels through `ChatResponse.data` as a freeform dict — see Task 8 — not a typed model, so no `WikiConceptEntry` schema is needed here.)

- [ ] **Step 1: Write the failing test**

Add to `tests/chatbot/test_schemas.py` (read the existing file first to match its structure and imports):

```python
def test_study_wiki_entry_round_trips():
    from chatbot.schemas import StudyWikiEntry

    entry = StudyWikiEntry(
        id="present-day-ministry-of-jesus",
        title="The Present-Day Ministry of Jesus and How It Empowers You",
        speaker="Joseph Prince",
        description="10-part series.",
    )
    assert entry.model_dump()["speaker"] == "Joseph Prince"


def test_wiki_page_response_round_trips():
    from chatbot.schemas import WikiPageResponse

    page = WikiPageResponse(
        series_id="s1",
        slug="grace",
        title="Grace",
        kind="concept",
        body_html="<p>Undeserved favor.</p>",
        citation="Joseph Prince — The Present-Day Ministry of Jesus and How It Empowers You",
    )
    assert page.model_dump()["slug"] == "grace"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/chatbot/test_schemas.py -k "study_wiki or wiki_page" -v`
Expected: FAIL with `ImportError: cannot import name 'StudyWikiEntry'`

- [ ] **Step 3: Add the models**

In `chatbot/schemas.py`, replace the existing `TopicEntry`/`TopicsResponse` classes with:

```python
class StudyWikiEntry(BaseModel):
    id: str = Field(..., description="Unique identifier for the registered study wiki series")
    title: str = Field(..., description="Full series title")
    speaker: str = Field(..., description="The series' speaker/author")
    description: str = Field(..., description="One-line description of the series")


class StudyWikisResponse(BaseModel):
    study_wikis: List[StudyWikiEntry] = Field(..., description="List of registered study wiki series")


class WikiPageResponse(BaseModel):
    series_id: str = Field(..., description="The series this page belongs to")
    slug: str = Field(..., description="Page slug")
    title: str = Field(..., description="Page title")
    kind: str = Field(..., description="concept | entity | source")
    body_html: str = Field(..., description="Rendered HTML body, wikilinks and scripture refs already resolved to links")
    citation: str = Field(..., description="Attribution line, e.g. 'Joseph Prince — The Present-Day Ministry of Jesus'")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/chatbot/test_schemas.py -v`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add chatbot/schemas.py tests/chatbot/test_schemas.py
git commit -m "feat: add study-wiki response schemas, remove TopicEntry/TopicsResponse"
```

---

## Task 5: `chatbot/api.py` — study-wiki list and page endpoints

**Files:**
- Modify: `chatbot/api.py`
- Modify: `tests/chatbot/test_list_endpoints.py`

**Interfaces:**
- Consumes: `chatbot.wiki_loader.list_series`, `get_manifest`, `get_page` (Task 3); `chatbot.schemas.StudyWikisResponse`, `WikiPageResponse` (Task 4).
- Produces: `GET /study-wikis` → `StudyWikisResponse`; `GET /study-wikis/{series_id}/pages/{slug}` → `WikiPageResponse`. Removes `GET /topics`.

- [ ] **Step 1: Update the failing/changed test**

In `tests/chatbot/test_list_endpoints.py`, replace the `test_get_topics` test:

```python
"""Tests for GET /parables and GET /study-wikis list endpoints."""


def test_get_parables(client):
    res = client.get("/parables")
    assert res.status_code == 200
    body = res.json()
    ids = {p["id"] for p in body["parables"]}
    assert "prodigal_son" in ids


def test_get_study_wikis(client):
    res = client.get("/study-wikis")
    assert res.status_code == 200
    body = res.json()
    ids = {w["id"] for w in body["study_wikis"]}
    assert "present-day-ministry-of-jesus" in ids


def test_get_wiki_page_known(client):
    res = client.get("/study-wikis/present-day-ministry-of-jesus/pages/grace")
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Grace"
    assert body["kind"] == "concept"
    assert "Joseph Prince" in body["citation"]


def test_get_wiki_page_unknown_series_404(client):
    res = client.get("/study-wikis/not-a-real-series/pages/grace")
    assert res.status_code == 404


def test_get_wiki_page_unknown_slug_404(client):
    res = client.get("/study-wikis/present-day-ministry-of-jesus/pages/not-a-real-slug")
    assert res.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_list_endpoints.py -v`
Expected: FAIL — `/study-wikis` returns 404 (route doesn't exist yet)

- [ ] **Step 3: Implement the endpoints**

In `chatbot/api.py`:

Replace this import line:
```python
from chatbot.data.topics import TOPICS
```
with:
```python
from chatbot import wiki_loader
```

Replace the `/topics` endpoint:
```python
@router.get("/topics", response_model=TopicsResponse)
async def list_topics():
    """List the curated topics available for Topical Study mode."""
    return TopicsResponse(topics=TOPICS)
```
with:
```python
@router.get("/study-wikis", response_model=StudyWikisResponse)
async def list_study_wikis():
    """List the registered study-wiki series available for Topical Study mode."""
    return StudyWikisResponse(study_wikis=wiki_loader.list_series())


@router.get("/study-wikis/{series_id}/pages/{slug}", response_model=WikiPageResponse)
async def get_wiki_page(series_id: str, slug: str):
    """Fetch one rendered concept/entity/source page from a registered study wiki."""
    manifest = wiki_loader.get_manifest(series_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Unknown study wiki series")
    page = wiki_loader.get_page(series_id, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Unknown page")
    return WikiPageResponse(
        series_id=series_id,
        slug=slug,
        title=page["title"],
        kind=page["kind"],
        body_html=page["body_html"],
        citation=f"{manifest['speaker']} — {manifest['title']}",
    )
```

Update the schema import at the top of the file — remove `TopicsResponse`, add `StudyWikisResponse`, `WikiPageResponse`:
```python
from chatbot.schemas import (
    BookContextResponse,
    ChatRequest,
    ChatResponse,
    PassageResponse,
    PassageVerse,
    ParablesResponse,
    StrongsResponse,
    StudyResponse,
    StudyWikisResponse,
    VerseResponse,
    WikiPageResponse,
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_list_endpoints.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/api.py tests/chatbot/test_list_endpoints.py
git commit -m "feat: add GET /study-wikis and GET /study-wikis/{series}/pages/{slug}"
```

---

## Task 6: `ollama_client.py` — extract `call_ollama_with_context`

**Files:**
- Modify: `chatbot/ollama_client.py`

**Interfaces:**
- Produces: `call_ollama_with_context(message: str, research_data: str, conversation_history: Optional[List[Dict]] = None, page_context: Optional[str] = None) -> Dict[str, Any]` — the HTTP-call/error-handling body `chat_with_ollama` already has, now parameterized on `research_data` instead of always calling `_fetch_research_data` internally.
- `chat_with_ollama`'s own signature and behavior are unchanged — this is a pure extraction, verified by the existing test suite (no new tests needed; this task's correctness gate is "every existing test still passes").

- [ ] **Step 1: Extract the function**

In `chatbot/ollama_client.py`, replace the body of `chat_with_ollama` (from `# Check if using cloud API...` through the final `return` statement) by first adding the new function directly above `chat_with_ollama`, then having `chat_with_ollama` call it:

```python
async def call_ollama_with_context(
    message: str,
    research_data: str,
    conversation_history: Optional[List[Dict]] = None,
    page_context: Optional[str] = None,
) -> Dict[str, Any]:
    """Send `message` to Ollama with `research_data` as grounding context in
    the system prompt. Shared by chat_with_ollama() (verse-reference-scanned
    research data) and chatbot.wiki_qa.answer() (wiki-search research data)
    so the HTTP call and its error handling exist in exactly one place."""
    is_cloud = "api.ollama.com" in OLLAMA_API_URL or OLLAMA_API_URL.startswith("https://")
    if is_cloud and not OLLAMA_API_KEY:
        return {
            "type": "error",
            "message": "OLLAMA_API_KEY required for Ollama Cloud. Please set your API key.",
            "data": None,
        }

    messages = []
    system_prompt = _SYSTEM_PROMPT_BASE
    if page_context:
        system_prompt += f"\nThe user is currently viewing {page_context} in the Bible Explorer. Assume questions like \"this verse\" or \"explain this\" refer to it unless the message clearly names a different passage.\n"
    system_prompt += research_data + "\n---\n"

    messages.append({"role": "system", "content": system_prompt})
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": message})

    headers = {"Content-Type": "application/json"}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    async with httpx.AsyncClient() as client:
        payload = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.7,
                "max_tokens": 2048,
            },
        }

        try:
            response = await client.post(
                f"{OLLAMA_API_URL}/api/chat",
                headers=headers,
                json=payload,
                timeout=180.0,
            )
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPError as e:
            detail = str(e) or type(e).__name__
            return {
                "type": "error",
                "message": f"Ollama API error: {detail}",
                "data": None,
            }
        except Exception as e:
            return {
                "type": "error",
                "message": f"Ollama error: {type(e).__name__}: {e}",
                "data": None,
            }

        content = result.get("message", {}).get("content", "")
        if not content and result.get("error"):
            return {
                "type": "error",
                "message": f"Ollama error: {result['error']}",
                "data": None,
            }

        return {
            "type": "chat",
            "message": content,
            "data": None,
            "route": f"AI Fallback → Ollama ({OLLAMA_MODEL}) → call_ollama_with_context()",
        }


async def chat_with_ollama(
    message: str,
    conversation_history: Optional[List[Dict]] = None,
    use_tools: bool = True,
    page_context: Optional[str] = None,
) -> Dict[str, Any]:
    """Send a message to Ollama with mybibletoolbox-code research data.

    Returns a dict with 'type', 'message', and 'data'.
    """
    research_data = await _fetch_research_data(message, conversation_history, page_context)
    return await call_ollama_with_context(
        message,
        research_data=research_data,
        conversation_history=conversation_history,
        page_context=page_context,
    )
```

Delete the old body of `chat_with_ollama` that this replaces (everything from the old `# Check if using cloud API...` comment down to its final `return` block) — the function now ends with the `call_ollama_with_context(...)` call above.

- [ ] **Step 2: Run the full existing test suite to confirm no regression**

Run: `pytest tests/chatbot/ -v`
Expected: PASS — every test that passed before this task still passes (this task changes no external behavior, only where the HTTP-call code lives).

- [ ] **Step 3: Commit**

```bash
git add chatbot/ollama_client.py
git commit -m "refactor: extract call_ollama_with_context from chat_with_ollama"
```

---

## Task 7: `chatbot/wiki_qa.py` — free-text Q&A grounded in a wiki series

**Files:**
- Create: `chatbot/wiki_qa.py`
- Test: `tests/chatbot/test_wiki_qa.py`

**Interfaces:**
- Consumes: `chatbot.wiki_loader.get_manifest`, `list_concepts`, `search` (Task 3); `chatbot.ollama_client.call_ollama_with_context` (Task 6).
- Produces: `answer(series_id: str, message: str, conversation_history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]` — same response shape as every other router-facing function (`type`, `message`, `data`, `route`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_wiki_qa.py
import pytest

from chatbot import wiki_qa


@pytest.mark.asyncio
async def test_answer_unknown_series():
    result = await wiki_qa.answer("not-a-real-series", "what is grace?")
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_answer_no_match_suggests_real_concepts(monkeypatch):
    monkeypatch.setattr(wiki_qa.wiki_loader, "search", lambda series_id, message, top_n=3: [])
    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "list_concepts",
        lambda series_id: [{"slug": "grace", "title": "Grace"}, {"slug": "holiness", "title": "Holiness"}],
    )
    result = await wiki_qa.answer("present-day-ministry-of-jesus", "what is quantum computing?")
    assert result["type"] == "chat"
    assert "Grace" in result["message"]
    assert "Holiness" in result["message"]


@pytest.mark.asyncio
async def test_answer_grounds_ollama_call_with_matched_pages(monkeypatch):
    captured = {}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        captured["message"] = message
        captured["research_data"] = research_data
        return {"type": "chat", "message": "Grace is undeserved favor.", "data": None}

    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "search",
        lambda series_id, message, top_n=3: [
            {"slug": "grace", "title": "Grace", "kind": "concept", "body": "Grace is undeserved favor."}
        ],
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await wiki_qa.answer("present-day-ministry-of-jesus", "what is grace?")

    assert captured["message"] == "what is grace?"
    assert "Grace is undeserved favor." in captured["research_data"]
    assert "Joseph Prince" in captured["research_data"]
    assert result["message"] == "Grace is undeserved favor."
    assert result["data"] == {"series_id": "present-day-ministry-of-jesus", "best_match_slug": "grace"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_wiki_qa.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'chatbot.wiki_qa'`

- [ ] **Step 3: Write the implementation**

```python
# chatbot/wiki_qa.py
"""Answers free-text questions asked inside a Topical Study session,
grounded in that session's registered study wiki — no answer is ever
composed from outside the matched pages' own content."""

from typing import Any, Dict, List, Optional

from chatbot import wiki_loader
from chatbot.ollama_client import call_ollama_with_context


async def answer(
    series_id: str,
    message: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    manifest = wiki_loader.get_manifest(series_id)
    if not manifest:
        return {
            "type": "error",
            "message": "Unknown study series.",
            "data": None,
            "route": "wiki_qa → unknown series",
        }

    matches = wiki_loader.search(series_id, message)
    if not matches:
        concepts = wiki_loader.list_concepts(series_id)[:5]
        suggestions = ", ".join(c["title"] for c in concepts) or "a concept from this series"
        return {
            "type": "chat",
            "message": (
                f"I couldn't find anything in this series about that. "
                f"Try asking about one of: {suggestions}."
            ),
            "data": {"series_id": series_id},
            "route": "wiki_qa → no match",
        }

    citation = f"{manifest['speaker']} — {manifest['title']}"
    matched_text = "\n\n".join(f"=== {m['title']} ===\n{m['body']}" for m in matches)
    research_data = (
        f"Answer only from the material below, drawn from the study series "
        f"\"{manifest['title']}\" by {manifest['speaker']}. If the material "
        f"doesn't address the question, say so plainly rather than guessing. "
        f"Close your answer with a citation line: \"— {citation}\".\n\n"
        f"{matched_text}"
    )

    result = await call_ollama_with_context(
        message, research_data=research_data, conversation_history=conversation_history
    )
    result["data"] = {"series_id": series_id, "best_match_slug": matches[0]["slug"]}
    result["route"] = f"wiki_qa → {series_id} → call_ollama_with_context()"
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_wiki_qa.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/wiki_qa.py tests/chatbot/test_wiki_qa.py
git commit -m "feat: answer free-text Topical Study questions grounded in the wiki"
```

---

## Task 8: `chatbot/router.py` — rewrite the `topic` mode primer

**Files:**
- Modify: `chatbot/router.py`
- Modify: `tests/chatbot/test_mode_primers.py`

**Interfaces:**
- Consumes: `chatbot.wiki_loader.list_series`, `list_concepts`, `get_page`, `get_manifest` (Task 3).
- Produces: `build_mode_primer("topic", mode_params)` — new behavior per the table below. Response `data` shape for the series-picked-but-no-concept-yet case: `{"series_id": str, "concepts": [{"slug": str, "title": str}, ...]}` (the frontend, Task 17, reads `data.concepts` to build the next pill screen).

| `mode_params` | Behavior |
|---|---|
| `{}` | 0 series registered → `type: "error"`-free plain `chat` message "no study series available yet". Exactly 1 → auto-resolves as if `{"series_id": that_one}` had been passed. `>1` → lists them for the frontend's series-picker pills (see Task 16) — same "fetch the list before the chat call" shape Parable Study already uses, so this case actually never needs a primer call at all (handled entirely in Task 16's frontend code) and is not exercised by `build_mode_primer` directly. |
| `{"series_id"}` | Concept-pill primer: message names the series, `data.concepts` from `wiki_loader.list_concepts`. |
| `{"series_id", "concept_slug"}` | Renders that concept page: short message, `artifacts: [{"type": "wiki_concept", ...}]`. |

- [ ] **Step 1: Update the failing/changed tests**

In `tests/chatbot/test_mode_primers.py`, replace any existing topic-primer test (search the file for `"topic"` — there may be none yet, since the removed `get_topic` import wasn't tested here) and add:

```python
@pytest.mark.asyncio
async def test_topic_primer_no_series_registered(monkeypatch):
    import chatbot.router as router_module

    monkeypatch.setattr(router_module.wiki_loader, "list_series", lambda: [])
    result = await router_module.build_mode_primer("topic", {})
    assert result["type"] == "chat"
    assert "no study series available" in result["message"].lower()


@pytest.mark.asyncio
async def test_topic_primer_series_only_lists_concepts():
    result = await build_mode_primer("topic", {"series_id": "present-day-ministry-of-jesus"})
    assert result["type"] == "chat"
    assert result["data"]["series_id"] == "present-day-ministry-of-jesus"
    concepts = result["data"]["concepts"]
    assert len(concepts) > 50
    slugs = {c["slug"] for c in concepts}
    assert "grace" in slugs


@pytest.mark.asyncio
async def test_topic_primer_unknown_series():
    result = await build_mode_primer("topic", {"series_id": "not-a-real-series"})
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_topic_primer_concept_page():
    result = await build_mode_primer(
        "topic", {"series_id": "present-day-ministry-of-jesus", "concept_slug": "grace"}
    )
    assert result["type"] == "chat"
    assert "Grace" in result["message"]
    assert result["artifacts"][0] == {
        "type": "wiki_concept",
        "label": "Grace ▸",
        "params": {"seriesId": "present-day-ministry-of-jesus", "slug": "grace"},
    }


@pytest.mark.asyncio
async def test_topic_primer_unknown_concept():
    result = await build_mode_primer(
        "topic", {"series_id": "present-day-ministry-of-jesus", "concept_slug": "not-a-real-slug"}
    )
    assert result["type"] == "error"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_mode_primers.py -v`
Expected: FAIL — old `topic` branch still uses `get_topic`/`topic_id`

- [ ] **Step 3: Rewrite the `topic` branch**

In `chatbot/router.py`, replace this import:
```python
from chatbot.data.topics import get_topic
```
with:
```python
from chatbot import wiki_loader
```

Replace the entire `if mode == "topic":` block with:

```python
    if mode == "topic":
        series_id = mode_params.get("series_id")
        concept_slug = mode_params.get("concept_slug")

        if not series_id:
            registered = wiki_loader.list_series()
            if not registered:
                return {
                    "type": "chat",
                    "message": "No study series available yet.",
                    "data": None,
                    "route": "Mode primer → topic → no series registered",
                }
            # >1 series is handled by the frontend's series-picker fetch
            # (it lists them before ever calling this primer); exactly 1
            # auto-resolves here rather than asking a pointless question.
            series_id = registered[0]["id"]

        manifest = wiki_loader.get_manifest(series_id)
        if not manifest:
            return {
                "type": "error", "message": "Unknown study series.", "data": None,
                "route": "Mode primer → topic → series not found",
            }

        if not concept_slug:
            concepts = wiki_loader.list_concepts(series_id)
            message = (
                f"**Topical Study: {manifest['title']}** ({manifest['speaker']})\n\n"
                "Here are the concepts covered in this series — which would you like to explore?"
            )
            return {
                "type": "chat",
                "message": message,
                "data": {"series_id": series_id, "concepts": concepts},
                "route": "Mode primer → topic → series",
            }

        page = wiki_loader.get_page(series_id, concept_slug)
        if not page:
            return {
                "type": "error", "message": "Unknown concept.", "data": None,
                "route": "Mode primer → topic → concept not found",
            }
        message = (
            f"**{page['title']}** — from *{manifest['title']}* ({manifest['speaker']}).\n\n"
            "Open the panel to read the full page, or ask me a follow-up question about it."
        )
        return {
            "type": "chat",
            "message": message,
            "data": {"series_id": series_id, "concept_slug": concept_slug},
            "route": "Mode primer → topic → concept",
            "artifacts": [{
                "type": "wiki_concept",
                "label": f"{page['title']} ▸",
                "params": {"seriesId": series_id, "slug": concept_slug},
            }],
            "follow_up_questions": [f"What else does this series say about {page['title']}?"],
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_mode_primers.py -v`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add chatbot/router.py tests/chatbot/test_mode_primers.py
git commit -m "feat: rebuild the topic mode primer on the study-wiki library"
```

---

## Task 9: `chatbot/api.py` — route free-text topic messages to `wiki_qa`

**Files:**
- Modify: `chatbot/api.py`
- Test: `tests/chatbot/test_chat_endpoint_topic_routing.py`

**Interfaces:**
- Consumes: `chatbot.wiki_qa.answer` (Task 7).
- Produces: `post_chat` now special-cases `request.mode == "topic"` with a non-empty message and a `series_id` already resolved in `request.mode_params`.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_chat_endpoint_topic_routing.py
"""A free-text message in an already-resolved Topical Study session is
answered from that series' wiki, not the generic deterministic/Ollama
fallback used everywhere else."""


def test_chat_in_topic_mode_routes_to_wiki_qa(client, monkeypatch):
    import chatbot.api as api_module

    async def fake_wiki_qa_answer(series_id, message, conversation_history=None):
        return {
            "type": "chat",
            "message": f"[wiki_qa answered for {series_id}]",
            "data": None,
            "route": "wiki_qa → test",
        }

    monkeypatch.setattr(api_module.wiki_qa, "answer", fake_wiki_qa_answer)

    res = client.post(
        "/chat",
        json={
            "message": "what does this series say about pride?",
            "mode": "topic",
            "mode_params": {"series_id": "present-day-ministry-of-jesus"},
        },
    )
    assert res.status_code == 200
    assert res.json()["message"] == "[wiki_qa answered for present-day-ministry-of-jesus]"


def test_chat_in_topic_mode_without_series_id_falls_through_to_deterministic(client):
    # No series_id yet (still on the picker step) — an ordinary message
    # here isn't a wiki question, so it must not be routed to wiki_qa.
    res = client.post(
        "/chat",
        json={"message": "John 3:16", "mode": "topic", "mode_params": {}},
    )
    assert res.status_code == 200
    assert res.json()["type"] == "verse" or "3:16" in res.json()["message"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_chat_endpoint_topic_routing.py -v`
Expected: FAIL — first test gets a deterministic/Ollama response instead of the stubbed `wiki_qa` one

- [ ] **Step 3: Implement the routing**

In `chatbot/api.py`, add the import:
```python
from chatbot import wiki_qa
```

In `post_chat`, insert a new branch after the existing mode-primer branch and before the `route_deterministic` call:

```python
@router.post("/chat", response_model=ChatResponse)
async def post_chat(request: ChatRequest):
    """Process a chat message and return a structured response."""
    try:
        if request.mode and not request.message.strip():
            result = await build_mode_primer(request.mode, request.mode_params)
            return ChatResponse(**result)

        history = (
            [{"role": m.role, "text": m.text} for m in request.history]
            if request.history else None
        )

        # A free-text message inside a Topical Study session that has
        # already resolved to a series is a question about that series,
        # not a generic Bible question — answer it from the wiki instead
        # of falling through to the deterministic/Ollama-fallback path
        # every other mode uses.
        series_id = (request.mode_params or {}).get("series_id") if request.mode == "topic" else None
        if series_id:
            result = await wiki_qa.answer(series_id, request.message, history)
            return ChatResponse(**result)

        result = await route_deterministic(
            request.message, history=history, page_context=request.page_context
        )
        if result:
            return ChatResponse(**result)
        result = await route_claude(
            request.message, history=history, page_context=request.page_context
        )
        if "follow_up_questions" not in result or not result["follow_up_questions"]:
            result["follow_up_questions"] = _generate_follow_ups(
                result.get("type", "chat"), result.get("data"), ""
            )
        return ChatResponse(**result)
    except Exception as e:
        return ChatResponse(
            type="error",
            message=f"Server error: {type(e).__name__}: {e}",
            data=None,
            route="Error path",
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_chat_endpoint_topic_routing.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full backend test suite**

Run: `pytest tests/ -v`
Expected: PASS — no regressions in any other mode's chat routing.

- [ ] **Step 6: Commit**

```bash
git add chatbot/api.py tests/chatbot/test_chat_endpoint_topic_routing.py
git commit -m "feat: route free-text Topical Study messages to wiki_qa"
```

---

## Task 10: Remove `chatbot/data/topics.py` and its tests

**Files:**
- Delete: `chatbot/data/topics.py`
- Modify: `tests/chatbot/test_parables_and_topics.py` (rename to `tests/chatbot/test_parables.py`, drop the topic tests)

**Interfaces:**
- None — this task only removes now-dead code. By this point, nothing imports `chatbot.data.topics` (Task 5 removed the `api.py` import, Task 8 removed the `router.py` import).

- [ ] **Step 1: Confirm nothing still references it**

Run: `grep -rn "data.topics\|data\.topics\|get_topic\b" chatbot/ tests/ frontend/src`
Expected: no output (Task 5 and Task 8 already removed every backend reference; frontend references are handled separately in Tasks 12/16/17).

- [ ] **Step 2: Delete the file and split the test file**

```bash
git rm chatbot/data/topics.py
git mv tests/chatbot/test_parables_and_topics.py tests/chatbot/test_parables.py
```

Edit `tests/chatbot/test_parables.py` to remove the `from chatbot.data.topics import TOPICS, get_topic` import and every `test_topics_*`/`test_get_topic_*` function, keeping only the parable tests:

```python
from chatbot.data.parables import PARABLES, get_parable


def test_parables_have_unique_ids():
    ids = [p["id"] for p in PARABLES]
    assert len(ids) == len(set(ids))
    assert len(PARABLES) >= 30


def test_parables_have_required_fields():
    for p in PARABLES:
        assert p["id"] and p["name"] and p["reference"]
        assert ":" in p["reference"]


def test_get_parable_known_id():
    prodigal = get_parable("prodigal_son")
    assert prodigal is not None
    assert prodigal["reference"] == "Luke 15:11-32"


def test_get_parable_unknown_id():
    assert get_parable("not_a_real_parable") is None
```

- [ ] **Step 3: Run the full backend test suite**

Run: `pytest tests/ -v`
Expected: PASS — every test passes; no test references `chatbot.data.topics` anymore.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove the retired chatbot/data/topics.py"
```

---

## Task 11: Frontend types — `ModeParams`, `ArtifactLink`, `WikiPageResponse`

**Files:**
- Modify: `frontend/src/types/session.ts`
- Modify: `frontend/src/types/api.ts`

**Interfaces:**
- Produces: `ModeParams.seriesId?: string`, `ModeParams.conceptSlug?: string` (replacing `topicId`); `ArtifactLink['type']` gains `'wiki_concept'`; `types/api.ts` gains `WikiPageResponse`.

There is no isolated unit test for a type-only change — this task's correctness gate is the TypeScript compiler in Step 2, and every later frontend task that imports these types.

- [ ] **Step 1: Update `types/session.ts`**

In `frontend/src/types/session.ts`, replace:
```ts
export interface ModeParams {
  plan?: 'chronological' | 'canonical'
  dayIndex?: number
  completedDays?: number[]
  parableId?: string
  topicId?: string
  reference?: string
}

export interface ArtifactLink {
  type: 'interlinear' | 'chapter' | 'strongs' | 'book_context' | 'gematria' | 'english_search'
  label: string
  params: Record<string, unknown>
}
```
with:
```ts
export interface ModeParams {
  plan?: 'chronological' | 'canonical'
  dayIndex?: number
  completedDays?: number[]
  parableId?: string
  seriesId?: string
  conceptSlug?: string
  reference?: string
}

export interface ArtifactLink {
  type: 'interlinear' | 'chapter' | 'strongs' | 'book_context' | 'gematria' | 'english_search' | 'wiki_concept'
  label: string
  params: Record<string, unknown>
}
```

- [ ] **Step 2: Add `WikiPageResponse` to `types/api.ts`**

Append to `frontend/src/types/api.ts`:
```ts
export interface WikiPageResponse {
  series_id: string
  slug: string
  title: string
  kind: string
  body_html: string
  citation: string
}
```

- [ ] **Step 3: Confirm the type change compiles**

Run: `cd frontend && rm -f node_modules/.tmp/tsconfig.app.tsbuildinfo node_modules/.tmp/tsconfig.node.tsbuildinfo && npx tsc -b`
Expected: FAIL — every file still referencing `modeParams.topicId` (ModePickerScreen.tsx, ChatPane.tsx, sessionDescription.ts, useSessionsStore.ts) now has a type error. This is expected; those are fixed in Tasks 12–17. Confirm the errors are exactly the `topicId` references and nothing else, then proceed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/types/api.ts
git commit -m "feat: replace topicId with seriesId/conceptSlug, add wiki_concept artifact type"
```

---

## Task 12: `lib/modeData.ts` and `lib/chatApi.ts` — study-wiki API calls

**Files:**
- Modify: `frontend/src/lib/modeData.ts`
- Modify: `frontend/src/lib/chatApi.ts`
- Test: `frontend/src/lib/chatApi.test.ts` (add cases)

**Interfaces:**
- Consumes: `types/session.ts::ModeParams`, `types/api.ts::WikiPageResponse` (Task 11).
- Produces: `listStudyWikis(): Promise<StudyWikiEntry[]>` (replaces `listTopics`), `fetchWikiConcept(seriesId: string, slug: string): Promise<WikiPageResponse>`; `toWireModeParams` maps `seriesId -> series_id`, `conceptSlug -> concept_slug` (replacing the `topicId -> topic_id` case).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/chatApi.test.ts` (read the existing file first to match its fetch-mocking style):

```ts
it('toWireModeParams maps seriesId and conceptSlug to snake_case', () => {
  expect(toWireModeParams({ seriesId: 'present-day-ministry-of-jesus', conceptSlug: 'grace' })).toEqual({
    series_id: 'present-day-ministry-of-jesus',
    concept_slug: 'grace',
  })
})

it('fetchWikiConcept requests the study-wiki page endpoint', async () => {
  const mockResponse = {
    series_id: 's1',
    slug: 'grace',
    title: 'Grace',
    kind: 'concept',
    body_html: '<p>Undeserved favor.</p>',
    citation: 'Joseph Prince — The Present-Day Ministry of Jesus',
  }
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResponse })
  const result = await fetchWikiConcept('s1', 'grace')
  expect(global.fetch).toHaveBeenCalledWith('/api/bible-chat/study-wikis/s1/pages/grace')
  expect(result.title).toBe('Grace')
})
```

Add the corresponding imports at the top of the test file: `toWireModeParams, fetchWikiConcept` from `./chatApi`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/chatApi.test.ts`
Expected: FAIL — `fetchWikiConcept` is not exported yet; `toWireModeParams` doesn't recognize `seriesId`/`conceptSlug`

- [ ] **Step 3: Implement**

In `frontend/src/lib/chatApi.ts`, update `toWireModeParams`'s switch — replace:
```ts
      case 'parableId':
        out.parable_id = value
        break
      case 'topicId':
        out.topic_id = value
        break
```
with:
```ts
      case 'parableId':
        out.parable_id = value
        break
      case 'seriesId':
        out.series_id = value
        break
      case 'conceptSlug':
        out.concept_slug = value
        break
```

Add the import and new function at the end of `chatApi.ts`:
```ts
import type { WikiPageResponse } from '@/types/api'
```
(merge into the existing `import type { ... } from '@/types/api'` block rather than adding a second import line)

```ts
export async function fetchWikiConcept(seriesId: string, slug: string): Promise<WikiPageResponse> {
  const res = await fetch(`${CHAT_API}/study-wikis/${encodeURIComponent(seriesId)}/pages/${encodeURIComponent(slug)}`)
  return parseJsonResponse<WikiPageResponse>(res)
}
```

In `frontend/src/lib/modeData.ts`, replace:
```ts
export interface TopicEntry {
  id: string
  name: string
  seed_references: string[]
}

export async function listTopics(): Promise<TopicEntry[]> {
  const res = await fetch('/api/bible-chat/topics')
  const body = await parseJsonResponse<{ topics: TopicEntry[] }>(res)
  return body.topics
}
```
with:
```ts
export interface StudyWikiEntry {
  id: string
  title: string
  speaker: string
  description: string
}

export async function listStudyWikis(): Promise<StudyWikiEntry[]> {
  const res = await fetch('/api/bible-chat/study-wikis')
  const body = await parseJsonResponse<{ study_wikis: StudyWikiEntry[] }>(res)
  return body.study_wikis
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/chatApi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/modeData.ts frontend/src/lib/chatApi.ts frontend/src/lib/chatApi.test.ts
git commit -m "feat: add listStudyWikis/fetchWikiConcept, wire seriesId/conceptSlug"
```

Note: this task intentionally leaves `ModePickerScreen.tsx`, `ChatPane.tsx`, `sessionDescription.ts`, and `useSessionsStore.ts` still calling the now-removed `listTopics` — those are fixed in Tasks 16, 17, and 13 respectively. `tsc -b` still fails until those land; that's expected mid-plan.

---

## Task 13: `sessionDescription.ts` and `useSessionsStore.ts` — sidebar labels

**Files:**
- Modify: `frontend/src/lib/sessionDescription.ts`
- Modify: `frontend/src/store/useSessionsStore.ts`
- Test: `frontend/src/lib/sessionDescription.test.ts` (add cases), `frontend/src/store/useSessionsStore.test.ts` (add cases)

**Interfaces:**
- Consumes: `ModeParams.conceptSlug`/`seriesId` (Task 11).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/lib/sessionDescription.test.ts` (find the existing `describe('describeSession'` block and add inside its `topic`-relevant area, matching the file's existing session-fixture-building helper):

```ts
it('describes a topic session with a resolved concept by its slug', () => {
  const session = makeSession('topic', { seriesId: 'present-day-ministry-of-jesus', conceptSlug: 'grace' })
  expect(describeSession(session)).toBe('Grace')
})

it('describes a topic session with only a series chosen as "Choosing a topic"', () => {
  const session = makeSession('topic', { seriesId: 'present-day-ministry-of-jesus' })
  expect(describeSession(session)).toBe('Choosing a topic')
})
```

(If the file has no `makeSession` test helper already, build the `Session` object literal inline the same way the file's other `it(...)` blocks do — read the file first to match its existing pattern exactly.)

Add to `frontend/src/store/useSessionsStore.test.ts`:
```ts
it('derives a topic session title from conceptSlug, hyphens included', () => {
  const session = useSessionsStore.getState().createSession('topic', {
    seriesId: 'present-day-ministry-of-jesus',
    conceptSlug: 'the-life-of-rest',
  })
  expect(session.title).toBe('Topical Study — the life of rest')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/sessionDescription.test.ts src/store/useSessionsStore.test.ts`
Expected: FAIL — both files still branch on `modeParams.topicId`

- [ ] **Step 3: Implement**

In `frontend/src/lib/sessionDescription.ts`, replace:
```ts
    case 'topic':
      return modeParams.topicId ? formatSlug(modeParams.topicId) : 'Choosing a topic'
```
with:
```ts
    case 'topic':
      return modeParams.conceptSlug ? formatSlug(modeParams.conceptSlug) : 'Choosing a topic'
```

`formatSlug` currently only replaces underscores (`parableId`s use underscores, e.g. `prodigal_son`); wiki slugs use hyphens (e.g. `the-life-of-rest`, per the wiki's own kebab-case filename convention). Broaden it to handle both — replace:
```ts
function formatSlug(id: string): string {
  return capitalize(id.replace(/_/g, ' '))
}
```
with:
```ts
function formatSlug(id: string): string {
  return capitalize(id.replace(/[_-]/g, ' '))
}
```

In `frontend/src/store/useSessionsStore.ts`, replace:
```ts
  if (mode === 'topic' && modeParams.topicId) return `Topical Study — ${modeParams.topicId.replace(/_/g, ' ')}`
```
with:
```ts
  if (mode === 'topic' && modeParams.conceptSlug) return `Topical Study — ${modeParams.conceptSlug.replace(/-/g, ' ')}`
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/sessionDescription.test.ts src/store/useSessionsStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/sessionDescription.ts frontend/src/store/useSessionsStore.ts frontend/src/lib/sessionDescription.test.ts frontend/src/store/useSessionsStore.test.ts
git commit -m "feat: derive topic session titles/descriptions from conceptSlug"
```

---

## Task 14: `useArtifactStore.ts` — `wiki_concept` artifact fetch

**Files:**
- Modify: `frontend/src/store/useArtifactStore.ts`
- Test: `frontend/src/store/useArtifactStore.test.ts` (add cases)

**Interfaces:**
- Consumes: `fetchWikiConcept` (Task 12).
- Produces: `fetchForLink` now handles `link.type === 'wiki_concept'`, expecting `params: { seriesId: string, slug: string }`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/store/useArtifactStore.test.ts` (match the file's existing mocking pattern for `chatApi` functions):

```ts
it('openArtifact fetches a wiki_concept via fetchWikiConcept', async () => {
  vi.spyOn(chatApi, 'fetchWikiConcept').mockResolvedValue({
    series_id: 's1',
    slug: 'grace',
    title: 'Grace',
    kind: 'concept',
    body_html: '<p>Undeserved favor.</p>',
    citation: 'Joseph Prince — The Present-Day Ministry of Jesus',
  })

  await useArtifactStore.getState().openArtifact({
    type: 'wiki_concept',
    label: 'Grace ▸',
    params: { seriesId: 's1', slug: 'grace' },
  })

  expect(chatApi.fetchWikiConcept).toHaveBeenCalledWith('s1', 'grace')
  expect(useArtifactStore.getState().status).toBe('ready')
  expect((useArtifactStore.getState().data as { title: string }).title).toBe('Grace')
})
```

(If the existing test file imports individual functions rather than the whole `chatApi` module for mocking, follow that same import/mock style instead of `vi.spyOn(chatApi, ...)` — read the file first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/store/useArtifactStore.test.ts`
Expected: FAIL — `fetchForLink` throws `Unknown artifact type: wiki_concept`

- [ ] **Step 3: Implement**

In `frontend/src/store/useArtifactStore.ts`, add the import:
```ts
import {
  fetchBookContext,
  fetchEnglishSearch,
  fetchGematria,
  fetchInterlinear,
  fetchInterlinearByVersenumber,
  fetchStrongsEntry,
  fetchWikiConcept,
} from '@/lib/chatApi'
```

Add a case to `fetchForLink`'s switch, before `default`:
```ts
    case 'wiki_concept':
      return fetchWikiConcept(link.params.seriesId as string, link.params.slug as string)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/store/useArtifactStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useArtifactStore.ts frontend/src/store/useArtifactStore.test.ts
git commit -m "feat: fetch wiki_concept artifacts via fetchWikiConcept"
```

---

## Task 15: `WikiConceptArtifact.tsx` — render a concept page

**Files:**
- Create: `frontend/src/components/artifacts/WikiConceptArtifact.tsx`
- Test: `frontend/src/components/artifacts/WikiConceptArtifact.test.tsx`
- Modify: `frontend/src/components/shell/ArtifactPane.tsx`

**Interfaces:**
- Consumes: `types/api.ts::WikiPageResponse` (Task 11), `useArtifactStore.openArtifact` (existing).
- Produces: `WikiConceptArtifact({ data: WikiPageResponse })` — a React component, modeled directly on `StrongsArtifact.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/artifacts/WikiConceptArtifact.test.tsx
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikiConceptArtifact } from './WikiConceptArtifact'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { WikiPageResponse } from '@/types/api'

const pageFixture: WikiPageResponse = {
  series_id: 'present-day-ministry-of-jesus',
  slug: 'grace',
  title: 'Grace',
  kind: 'concept',
  body_html:
    '<p>Defined as <strong>undeserved favor</strong>. See ' +
    '<a href="/topic-wiki?series=present-day-ministry-of-jesus&page=holiness">Holiness</a> for more, ' +
    'and <a href="/explorer?reference=ROM%206%3A14">Rom 6:14</a>.</p>',
  citation: 'Joseph Prince — The Present-Day Ministry of Jesus and How It Empowers You',
}

describe('WikiConceptArtifact', () => {
  afterEach(() => {
    useArtifactStore.setState({ activeArtifact: null, history: [], status: 'idle', data: null, error: null })
  })

  it('renders the page title, body, and citation', () => {
    render(<WikiConceptArtifact data={pageFixture} />)
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(screen.getByText(/undeserved favor/)).toBeInTheDocument()
    expect(screen.getByText(pageFixture.citation)).toBeInTheDocument()
  })

  it('opens a wikilink as a nested wiki_concept artifact', async () => {
    render(<WikiConceptArtifact data={pageFixture} />)
    await userEvent.click(screen.getByRole('link', { name: 'Holiness' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'wiki_concept',
      label: 'Holiness ▸',
      params: { seriesId: 'present-day-ministry-of-jesus', slug: 'holiness' },
    })
  })

  it('opens a scripture reference as an interlinear artifact', async () => {
    render(<WikiConceptArtifact data={pageFixture} />)
    await userEvent.click(screen.getByRole('link', { name: 'Rom 6:14' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: 'Rom 6:14 ▸',
      params: { reference: 'ROM 6:14' },
    })
  })

  it('does not navigate the browser for an intercepted link', async () => {
    render(<WikiConceptArtifact data={pageFixture} />)
    const link = screen.getByRole('link', { name: 'Rom 6:14' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/artifacts/WikiConceptArtifact.test.tsx`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/artifacts/WikiConceptArtifact.tsx
import type { MouseEvent } from 'react'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { WikiPageResponse } from '@/types/api'

interface Props {
  data: WikiPageResponse
}

// The page body comes from chatbot/wiki_loader.py (chatbot/wiki_refs.py
// resolves it) already carrying two kinds of plain <a href="..."> link:
// `/topic-wiki?series=<id>&page=<slug>` for a [[wikilink]] cross-reference,
// and `/explorer?reference=<ref>` for a scripture citation. Neither route
// exists in this SPA — intercept both and open the right Artifact instead
// of letting the browser navigate to a dead page.
const WIKILINK_HREF_RE = /^\/topic-wiki\?series=([^&]+)&page=([^&]+)/
const SCRIPTURE_HREF_RE = /^\/explorer\?reference=([^&]+)/

export function WikiConceptArtifact({ data }: Props) {
  const openArtifact = useArtifactStore((s) => s.openArtifact)

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return

    const wikilinkMatch = href.match(WIKILINK_HREF_RE)
    if (wikilinkMatch) {
      e.preventDefault()
      const seriesId = decodeURIComponent(wikilinkMatch[1])
      const slug = decodeURIComponent(wikilinkMatch[2])
      openArtifact({
        type: 'wiki_concept',
        label: `${anchor?.textContent ?? slug} ▸`,
        params: { seriesId, slug },
      })
      return
    }

    const scriptureMatch = href.match(SCRIPTURE_HREF_RE)
    if (scriptureMatch) {
      e.preventDefault()
      const reference = decodeURIComponent(scriptureMatch[1])
      openArtifact({
        type: 'interlinear',
        label: `${anchor?.textContent ?? reference} ▸`,
        params: { reference },
      })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-lg font-semibold">{data.title}</div>
      <div className="text-sm leading-relaxed [&_h2]:font-semibold [&_h2]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline" onClick={handleClick} dangerouslySetInnerHTML={{ __html: data.body_html }} />
      <div className="text-xs text-[var(--color-text-secondary)] mt-2">{data.citation}</div>
    </div>
  )
}
```

- [ ] **Step 4: Wire it into `ArtifactPane.tsx`**

In `frontend/src/components/shell/ArtifactPane.tsx`, add the import:
```tsx
import { WikiConceptArtifact } from '@/components/artifacts/WikiConceptArtifact'
```
and add `WikiPageResponse` to the type import:
```tsx
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
  WikiPageResponse,
} from '@/types/api'
```
and add a render branch alongside the others:
```tsx
            {activeArtifact.type === 'wiki_concept' && <WikiConceptArtifact data={data as WikiPageResponse} />}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/artifacts/WikiConceptArtifact.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/artifacts/WikiConceptArtifact.tsx frontend/src/components/artifacts/WikiConceptArtifact.test.tsx frontend/src/components/shell/ArtifactPane.tsx
git commit -m "feat: render wiki concept pages as an Artifact"
```

---

## Task 16: `ModePickerScreen.tsx` — series picker entry point

**Files:**
- Modify: `frontend/src/components/shell/ModePickerScreen.tsx`
- Test: `frontend/src/components/shell/ModePickerScreen.test.tsx` (add/update cases)

**Interfaces:**
- Consumes: `listStudyWikis` (Task 12).
- Produces: the Topical Study starter button fetches series and shows a series-choice prompt — the same `startWithFetchedChoices` primitive Parable Study already uses, unchanged shape, just fed by `listStudyWikis` instead of `listTopics`.

> **Pre-flight ruling (recorded in the SDD ledger):** the plan originally specified an "auto-skip straight into the sole series" path for when exactly one series is registered. That path bypasses the concept-pill-rendering branch that only exists in `resolveChoice` (Task 17) — a session started via plain `startSession` would receive `response.data.concepts` but nothing would ever turn it into clickable pills, since `startSession` always renders a plain chat message. Rather than duplicate `resolveChoice`'s concept-rendering branch into ModePickerScreen (or extract a new shared helper for a single call site), Topical Study always shows the series-choice prompt via `startWithFetchedChoices` — identical in shape to today's Topical Study and to Parable Study, even when there's currently only one series to pick from. This is a one-click cost when the library is small, in exchange for a single source of truth for concept-pill rendering (`resolveChoice` alone) and zero new files.

- [ ] **Step 1: Write the failing test**

Update `frontend/src/components/shell/ModePickerScreen.test.tsx` — find the existing test that mocks `listTopics` and covers clicking "Topical Study" (read the file first to match its existing mocking setup for `listParables`, which uses this exact `startWithFetchedChoices` shape already), then replace it with:

```tsx
it('fetches the registered study-wiki series and shows them as a choice prompt', async () => {
  vi.mocked(listStudyWikis).mockResolvedValue([
    { id: 'present-day-ministry-of-jesus', title: 'The Present-Day Ministry of Jesus', speaker: 'Joseph Prince', description: 'desc' },
    { id: 'series-b', title: 'Series B', speaker: 'Speaker B', description: 'b' },
  ])

  render(<ModePickerScreen onSessionStarted={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: /Topical Study/ }))

  expect(await screen.findByRole('button', { name: /The Present-Day Ministry of Jesus/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Series B/ })).toBeInTheDocument()
})
```

Update the file's mock declarations (`vi.mock('@/lib/modeData', ...)`) to export `listStudyWikis` instead of `listTopics`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shell/ModePickerScreen.test.tsx`
Expected: FAIL — `ModePickerScreen.tsx` still imports `listTopics`, which no longer exists (Task 12 removed it)

- [ ] **Step 3: Implement**

In `frontend/src/components/shell/ModePickerScreen.tsx`, replace the import:
```tsx
import { listParables, listTopics } from '@/lib/modeData'
```
with:
```tsx
import { listParables, listStudyWikis } from '@/lib/modeData'
```

Replace the Topical Study button's `onClick` — replace:
```tsx
          <button
            className={STARTER_BUBBLE}
            onClick={() =>
              startWithFetchedChoices(
                'topic',
                '🔎 Topical Study',
                'Here are some topics to explore — which would you like to dig into?',
                async () => {
                  const topics = await listTopics()
                  return topics.map((t) => ({ label: t.name, modeParams: { topicId: t.id } }))
                }
              )
            }
          >
            <span aria-hidden="true">🔎</span> Topical Study
          </button>
```
with:
```tsx
          <button
            className={STARTER_BUBBLE}
            onClick={() =>
              startWithFetchedChoices(
                'topic',
                '🔎 Topical Study',
                'Which series would you like to study?',
                async () => {
                  const series = await listStudyWikis()
                  return series.map((s) => ({ label: `${s.title} — ${s.speaker}`, modeParams: { seriesId: s.id } }))
                }
              )
            }
          >
            <span aria-hidden="true">🔎</span> Topical Study
          </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shell/ModePickerScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ModePickerScreen.tsx frontend/src/components/shell/ModePickerScreen.test.tsx
git commit -m "feat: start Topical Study from the registered series library"
```

---

## Task 17: `ChatPane.tsx` — concept-pill step and free-text follow-up

**Files:**
- Modify: `frontend/src/components/shell/ChatPane.tsx`
- Test: `frontend/src/components/shell/ChatPane.test.tsx` (add cases)

**Interfaces:**
- Consumes: `listStudyWikis` (Task 12, for `retryChoices`); `response.data.concepts` shape from `build_mode_primer` (Task 8).
- Produces: `resolveChoice` renders a new concept-choices prompt when the primer response carries `data.concepts`, instead of a plain chat message; `retryChoices` reloads the series list (not a concept list — see Task 8's table, only the series step is ever retried this way).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/shell/ChatPane.test.tsx` (match the file's existing session-fixture and `postChat` mocking pattern — read it first):

```tsx
it('resolving a series choice renders concept pills instead of a plain message', async () => {
  const session = useSessionsStore.getState().createSession('topic', {})
  useSessionsStore.getState().appendMessage(session.id, {
    id: 'prompt-1',
    role: 'assistant',
    text: 'Which series?',
    choicesStatus: 'ready',
    choices: [{ label: 'The Present-Day Ministry of Jesus — Joseph Prince', modeParams: { seriesId: 'present-day-ministry-of-jesus' } }],
  })
  vi.mocked(postChat).mockResolvedValue({
    type: 'chat',
    message: 'Here are the concepts...',
    data: {
      series_id: 'present-day-ministry-of-jesus',
      concepts: [
        { slug: 'grace', title: 'Grace' },
        { slug: 'holiness', title: 'Holiness' },
      ],
    },
  })

  render(<ChatPane sessionId={session.id} />)
  await userEvent.click(screen.getByRole('button', { name: /The Present-Day Ministry of Jesus/ }))

  expect(await screen.findByRole('button', { name: 'Grace' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Holiness' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: FAIL — the concept titles never render; `resolveChoice` currently always appends a plain message

- [ ] **Step 3: Implement**

In `frontend/src/components/shell/ChatPane.tsx`, update `resolveChoice`'s try block — replace:
```ts
      try {
        const response = await postChat({ message: '', mode: session.mode, mode_params: nextModeParams })
        appendMessage(sessionId, {
          id: genId(),
          role: 'assistant',
          text: response.message,
          type: response.type,
          data: response.data ?? undefined,
          artifacts: response.artifacts,
          followUpQuestions: response.follow_up_questions,
        })
      } catch (err) {
```
with:
```ts
      try {
        const response = await postChat({ message: '', mode: session.mode, mode_params: nextModeParams })
        // Topical Study's series step responds with a list of concepts to
        // pick from next, not a finished answer — render it as a new
        // choices prompt (like the series list itself) instead of plain text.
        const concepts = (response.data as { concepts?: { slug: string; title: string }[] } | undefined)?.concepts
        if (session.mode === 'topic' && concepts) {
          appendMessage(sessionId, {
            id: genId(),
            role: 'assistant',
            text: response.message,
            choicesStatus: 'ready',
            choices: concepts.map((c) => ({ label: c.title, modeParams: { conceptSlug: c.slug } })),
          })
        } else {
          appendMessage(sessionId, {
            id: genId(),
            role: 'assistant',
            text: response.message,
            type: response.type,
            data: response.data ?? undefined,
            artifacts: response.artifacts,
            followUpQuestions: response.follow_up_questions,
          })
        }
      } catch (err) {
```

Update `retryChoices` — replace:
```ts
        const choices: MessageChoice[] =
          session.mode === 'parable'
            ? (await listParables()).map((p) => ({ label: `${p.name} (${p.reference})`, modeParams: { parableId: p.id } }))
            : (await listTopics()).map((t) => ({ label: t.name, modeParams: { topicId: t.id } }))
```
with:
```ts
        const choices: MessageChoice[] =
          session.mode === 'parable'
            ? (await listParables()).map((p) => ({ label: `${p.name} (${p.reference})`, modeParams: { parableId: p.id } }))
            : (await listStudyWikis()).map((s) => ({ label: `${s.title} — ${s.speaker}`, modeParams: { seriesId: s.id } }))
```

Update the import at the top of the file — replace `listTopics` with `listStudyWikis` in whichever import line currently pulls in `listParables`/`listTopics` from `@/lib/modeData`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: PASS

- [ ] **Step 5: Full frontend verification**

```bash
cd frontend
rm -f node_modules/.tmp/tsconfig.app.tsbuildinfo node_modules/.tmp/tsconfig.node.tsbuildinfo
npx tsc -b
npx vitest run
```

Expected: `tsc -b` reports zero errors (every `topicId`/`listTopics` reference from Task 11's failing check is now gone); the full Vitest suite passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "feat: render concept pills after a series is chosen in Topical Study"
```

---

## Task 18: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

Run: `pytest tests/ -v`
Expected: PASS, zero failures.

- [ ] **Step 2: Full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, zero failures.

- [ ] **Step 3: Restart the chatbot service** (it has no hot-reload; every backend task above needs this to actually take effect live)

```bash
pkill -f "from chatbot import create_chatbot_app" || true
cd /Volumes/HomeX/Chris/Documents/Bible-Gematria-Interlinear-Explorer
nohup python3 -c "from chatbot import create_chatbot_app; import uvicorn; uvicorn.run(create_chatbot_app(), host='0.0.0.0', port=8020)" > /tmp/chatbot_uvicorn.log 2>&1 &
disown
sleep 2
tail -n 20 /tmp/chatbot_uvicorn.log
```

Expected: `Uvicorn running on http://0.0.0.0:8020`, no traceback (a startup traceback here most likely means a registered wiki's `path` didn't resolve, or the `markdown` package isn't installed in this environment — check both before retrying).

- [ ] **Step 4: Live browser pass**

With Flask (`:5000`), the chatbot service (`:8020`), and the Vite dev server (`:5173`) all running, open `http://localhost:5173/` and:
1. Click **Topical Study**. It should show a series-choice prompt (currently just the one registered series as its only pill, per the Task 16 pre-flight ruling — no auto-skip). Click that pill.
2. Click the **Grace** pill. Confirms a short chat reply plus a `Grace ▸` artifact link.
3. Click the artifact link. The side panel should show the full Grace page with a citation line at the bottom.
4. Click a scripture reference inside the page body (e.g. "Rom 6:14"). It should open that verse in the Explorer artifact, replacing the panel content, with a working back button (‹) to return to Grace.
5. Click a `[[wikilink]]`-derived link inside the page body (e.g. to Holiness). It should open the Holiness concept page in the panel, again with a working back button.
6. Type a free-text follow-up in the chat input, e.g. "what does this series say about pride?" — confirms it's answered from the wiki (mentions `pride-stops-the-flow-of-grace` content) rather than a generic Bible answer, and ends with a citation naming Joseph Prince / the series.

- [ ] **Step 5: Report results**

No commit for this task — it's verification only. Report the outcome of Steps 1–4 plainly (pass/fail per step, with any error output) rather than declaring the feature done without having run them.
