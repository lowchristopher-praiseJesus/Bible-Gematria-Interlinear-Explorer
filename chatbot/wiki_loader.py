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

# A small, non-exhaustive stopword list — just enough that generic question
# words ("what does this series say about...") don't themselves count as
# topical overlap between a query and every page in a series.
_STOPWORDS = {
    "what", "does", "this", "series", "say", "about", "the", "a", "an",
    "is", "are", "do", "did", "how", "why", "of", "in", "on", "to", "for",
    "and", "or", "i", "you",
}

# Minimum stopword-filtered term overlap required for a page to count as a
# match — capped at the query's own (stopword-filtered) term count via
# min(_MIN_MATCH_SCORE, len(terms)) in search(), so a genuine single-term
# query (e.g. "grace") isn't structurally unmatchable: it only needs its
# one term to overlap, while a 2+-term query still needs 2, which is what
# rejects genuinely off-topic queries. Below this floor, `search()` returns
# no matches so wiki_qa's "I couldn't find anything in this series about
# that" fallback can actually trigger.
_MIN_MATCH_SCORE = 2


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


def _strip_leading_h1(body: str) -> str:
    """Removes the leading `# Title` line _extract_title() pulled the page
    title from, so it isn't rendered twice — once by the API response's own
    `title` field, and again as an `<h1>` at the top of `body_html`. Only
    the first H1-shaped line at the very start of the body (ignoring
    leading blank lines) is removed; any later H1-shaped text is left
    alone."""
    m = _H1_RE.match(body.lstrip("\n"))
    if not m or m.start() != 0:
        return body
    stripped = body.lstrip("\n")
    return stripped[m.end():].lstrip("\n")


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
        body_for_rendering = _strip_leading_h1(page["body"])
        rendered_markdown = render_wiki_body(body_for_rendering, manifest["id"], titles_by_slug)
        page["body_html"] = _markdown.markdown(rendered_markdown, extensions=["tables", "fenced_code"])

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
    terms = set(re.findall(r"[a-z0-9']+", query.lower())) - _STOPWORDS
    if not terms:
        return []
    scored = []
    for slug, page in series["pages"].items():
        haystack = f"{page['title']} {' '.join(page['tags'])} {page['body']}".lower()
        haystack_terms = set(re.findall(r"[a-z0-9']+", haystack)) - _STOPWORDS
        raw_score = len(terms & haystack_terms)
        # Never require more overlapping terms than the query itself has
        # (after stopword-stripping) — a 1-term query like "grace" only
        # needs 1 overlapping term to match; a 2+-term query still needs
        # the full floor, which is what rejects genuinely off-topic
        # multi-word queries.
        if raw_score < min(_MIN_MATCH_SCORE, len(terms)):
            continue
        scored.append((raw_score, slug, page))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [
        {"slug": slug, "title": page["title"], "kind": page["kind"], "body": page["body"]}
        for _, slug, page in scored[:top_n]
    ]
