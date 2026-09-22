"""Loads the character profiles in characters/ for "Chat with a Character"
mode. The README's two tables (Old / New Testament) are the manifest — id,
display name, testament and one-line summary — and each <id>.md is the
profile the chat is grounded on. Parsed once, then cached."""

import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

CHARACTERS_DIR = Path(__file__).resolve().parent.parent / "characters"

# Held back for now: voicing Jesus in the first person may be sensitive.
EXCLUDED_IDS = frozenset({"jesus"})

_ROW_RE = re.compile(
    r"^\|\s*\[([^\]]+)\]\(([a-z_]+)\.md\)\s*\|\s*[\d,]+\s*\|\s*(.+?)\s*\|\s*$"
)
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([a-z_]+\.md\)")
_TESTAMENT_HEADINGS = {"## Old Testament": "OT", "## New Testament": "NT"}


@lru_cache(maxsize=1)
def _manifest() -> tuple:
    readme = CHARACTERS_DIR / "README.md"
    try:
        lines = readme.read_text(encoding="utf-8").splitlines()
    except OSError:
        logger.warning("Character profiles unavailable: cannot read %s", readme)
        return ()

    entries: List[Dict[str, Any]] = []
    testament: Optional[str] = None
    for line in lines:
        heading = next((t for h, t in _TESTAMENT_HEADINGS.items() if line.startswith(h)), None)
        if heading:
            testament = heading
            continue
        m = _ROW_RE.match(line)
        if not m or not testament:
            continue
        name, char_id, summary = m.groups()
        if char_id in EXCLUDED_IDS or not (CHARACTERS_DIR / f"{char_id}.md").is_file():
            continue
        entries.append({"id": char_id, "name": name, "testament": testament, "summary": summary})
    return tuple(entries)


def list_characters() -> List[Dict[str, Any]]:
    return [dict(e) for e in _manifest()]


@lru_cache(maxsize=None)
def _profile(char_id: str) -> str:
    text = (CHARACTERS_DIR / f"{char_id}.md").read_text(encoding="utf-8")
    return _MD_LINK_RE.sub(r"\1", text)


def get_character(char_id: str) -> Optional[Dict[str, Any]]:
    """The manifest entry plus its full `profile` text, or None for an
    unknown or excluded id. Only ids present in the manifest are ever used
    to build a file path."""
    entry = next((e for e in _manifest() if e["id"] == char_id), None)
    if not entry:
        return None
    return {**entry, "profile": _profile(char_id)}
