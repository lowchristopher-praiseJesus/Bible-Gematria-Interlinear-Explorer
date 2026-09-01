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
