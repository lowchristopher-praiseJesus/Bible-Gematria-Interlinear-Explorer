# chatbot/apologetics_import.py
"""Pure parsing for the "Defend the Faith" import (no I/O): a short's file
name, its description file (summary, fiction note, further reading), and
Further-reading items into USFM refs. Used by
scripts/import_apologetics_shorts.py."""

import re
from typing import Any, Dict, List, Optional, Tuple

_FILENAME_RE = re.compile(r"^(\d{1,3}) (.+?) - ")
_FICTION_RE = re.compile(r"^\(.*fictional character.*\)$", re.IGNORECASE)
_READING_PREFIX = "📚 Further reading:"
# A whole item that is Scripture: "<book> <ch>[:<v>[-<v2>]]( & <ch2>)*",
# optionally followed by a parenthetical note.
_SCRIPTURE_RE = re.compile(
    r"^(?P<book>(?:[1-3]\s?)?[A-Za-z][A-Za-z .]*?)\s+"
    r"(?P<ch>\d{1,3})(?::(?P<v>\d{1,3})(?:-(?P<v2>\d{1,3}))?)?"
    r"(?P<more>(?:\s*&\s*\d{1,3})*)"
    r"(?:\s*\([^)]*\))?$"
)


def parse_short_filename(name: str) -> Optional[Tuple[int, str]]:
    """'03 The Resurrection - script.txt' -> (3, 'The Resurrection');
    None for a file that isn't named '<NN> <Subject> - ...'."""
    m = _FILENAME_RE.match(name)
    return (int(m.group(1)), m.group(2)) if m else None


def _book_usfm(book_text: str) -> Optional[str]:
    from chatbot.router import _BOOK_ABBREVIATIONS  # deferred, as in wiki_refs

    return _BOOK_ABBREVIATIONS.get(re.sub(r"[.\s]", "", book_text).lower())


def _item_refs(item: str) -> List[str]:
    m = _SCRIPTURE_RE.match(item.replace("–", "-").replace("—", "-"))
    if not m:
        return []
    usfm = _book_usfm(m.group("book"))
    if not usfm:
        return []
    ch = m.group("ch")
    if m.group("v"):
        first = f"{usfm} {ch}:{m.group('v')}" + (f"-{m.group('v2')}" if m.group("v2") else "")
    else:
        first = f"{usfm} {ch}:1"
    extra = [f"{usfm} {c}:1" for c in re.findall(r"\d{1,3}", m.group("more") or "")]
    return [first, *extra]


def parse_further_reading(line: str) -> List[Dict[str, Any]]:
    """Items separated by ' · ' -> [{'text', 'refs'}]; refs is [] for a
    non-Scripture item. A whole chapter opens at verse 1; 'Acts 5 & 12'
    gives one ref per chapter."""
    items = [part.strip() for part in line.split("·")]
    return [{"text": item, "refs": _item_refs(item)} for item in items if item]


def parse_description(text: str) -> Dict[str, Any]:
    """Summary (the DESCRIPTION body up to the Further-reading line), the
    parenthetical fiction note (or None), and the parsed further reading."""
    lines = text.splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == "DESCRIPTION:") + 1
    except StopIteration:
        start = 0
    summary_lines: List[str] = []
    reading: List[Dict[str, Any]] = []
    fiction: Optional[str] = None
    in_summary = True
    for line in lines[start:]:
        stripped = line.strip()
        if _FICTION_RE.match(stripped):
            fiction = stripped
            continue
        if stripped.startswith(_READING_PREFIX):
            reading = parse_further_reading(stripped[len(_READING_PREFIX):])
            in_summary = False
            continue
        if in_summary:
            summary_lines.append(line.rstrip())
    return {"summary": "\n".join(summary_lines).strip(), "fiction_note": fiction, "further_reading": reading}
