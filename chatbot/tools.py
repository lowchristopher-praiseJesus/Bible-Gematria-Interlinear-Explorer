"""Thin async wrappers around existing src/ library functions.

All synchronous I/O-bound functions are offloaded to a thread pool
to avoid blocking the FastAPI event loop.
"""

import asyncio
import functools
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Path to mybibletoolbox-code project (source of research data)
MYBIBLETOOLBOX_PATH = Path.home() / "Documents" / "mybibletoolbox-code"
if str(MYBIBLETOOLBOX_PATH) not in sys.path:
    sys.path.insert(0, str(MYBIBLETOOLBOX_PATH))

# Add quote-bible scripts path for biblehub_fetcher / book_codes
quote_bible_scripts = MYBIBLETOOLBOX_PATH / ".claude" / "skills" / "quote-bible" / "scripts"
if str(quote_bible_scripts) not in sys.path:
    sys.path.insert(0, str(quote_bible_scripts))

from book_codes import parse_reference as _parse_reference
from src.tools.fetch_verse import fetch_verse as _fetch_verse, filter_by_languages as _filter_by_languages
from src.lib.scripture_study import (
    merge_commentary_for_verses as _merge_commentary,
    parse_verse_reference as _parse_verse_reference,
    load_tool_registry as _load_tool_registry,
)
from src.lib.get_strongs import fetch_strongs_entries as _fetch_strongs
from src.config import COMMENTARY_DIR

# Path to the tool registry used by scripture_study
TOOL_REGISTRY_PATH = MYBIBLETOOLBOX_PATH / "bible-study-tools" / "tool-registry.yaml"


# ---------------------------------------------------------------------------
# Helper: run blocking functions in a thread pool
# ---------------------------------------------------------------------------
async def _run_in_thread(func, *args, **kwargs):
    loop = asyncio.get_running_loop()
    if kwargs:
        func = functools.partial(func, **kwargs)
    return await loop.run_in_executor(None, func, *args)


# ---------------------------------------------------------------------------
# Verse fetching
# ---------------------------------------------------------------------------
async def fetch_verse_translations(
    reference: str,
    languages: Optional[List[str]] = None,
) -> Dict[str, str]:
    """Fetch verse translations for a reference string (e.g. 'JHN 3:16')."""
    book, chapter, verse = _parse_reference(reference)

    # fetch_verse does web requests + file I/O
    translations = await _run_in_thread(_fetch_verse, book, chapter, verse)

    if languages:
        translations = await _run_in_thread(
            _filter_by_languages, translations, languages
        )

    return translations


# ---------------------------------------------------------------------------
# Scripture study / commentary
# ---------------------------------------------------------------------------
async def fetch_scripture_study(
    reference: str,
    depth: str = "medium",
    filters: Optional[List[str]] = None,
    excludes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Fetch merged commentary for a verse reference."""
    verses = await _run_in_thread(_parse_verse_reference, reference)
    tool_registry = await _run_in_thread(_load_tool_registry, TOOL_REGISTRY_PATH)

    result = await _run_in_thread(
        _merge_commentary,
        verses,
        depth,
        COMMENTARY_DIR,
        tool_registry,
        filters,
        excludes,
    )
    return result


# ---------------------------------------------------------------------------
# Strong's lookup
# ---------------------------------------------------------------------------
async def fetch_strongs(
    numbers: Optional[List[str]] = None,
    words: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Fetch Strong's entries by numbers or English word search."""
    result = await _run_in_thread(
        _fetch_strongs,
        numbers=numbers or None,
        words=words or None,
        case_sensitive=False,
    )
    return result


# ---------------------------------------------------------------------------
# Gematria / English search / random verse (Complete.db direct — no
# mybibletoolbox dependency). Used by chatbot.router's mode primers and
# deterministic routing; the frontend artifact panel calls Flask's existing
# /api/gematria and /api/english directly instead of duplicating a route here.
# ---------------------------------------------------------------------------
from chatbot.bible_search import random_verse_sync, search_english_sync, search_gematria_sync


async def search_gematria(value: int) -> Dict[str, Any]:
    return await _run_in_thread(search_gematria_sync, value)


async def search_english(query: str) -> Dict[str, Any]:
    return await _run_in_thread(search_english_sync, query)


async def random_verse() -> tuple:
    return await _run_in_thread(random_verse_sync)
