"""Parse context.md NT book data into an in-memory lookup."""

import re
from pathlib import Path
from typing import Dict, Optional

CONTEXT_FILE = Path(__file__).resolve().parent.parent / "context.md"

# Maps markdown heading name → USFM code
NT_NAME_TO_USFM: Dict[str, str] = {
    "Matthew": "MAT", "Mark": "MRK", "Luke": "LUK", "John": "JHN",
    "Acts": "ACT", "Romans": "ROM", "1 Corinthians": "1CO",
    "2 Corinthians": "2CO", "Galatians": "GAL", "Ephesians": "EPH",
    "Philippians": "PHP", "Colossians": "COL", "1 Thessalonians": "1TH",
    "2 Thessalonians": "2TH", "1 Timothy": "1TI", "2 Timothy": "2TI",
    "Titus": "TIT", "Philemon": "PHM", "Hebrews": "HEB", "James": "JAS",
    "1 Peter": "1PE", "2 Peter": "2PE", "1 John": "1JN", "2 John": "2JN",
    "3 John": "3JN", "Jude": "JUD", "Revelation": "REV",
}

_USFM_TO_NAME: Dict[str, str] = {v: k for k, v in NT_NAME_TO_USFM.items()}

_SECTION_KEYS: Dict[str, str] = {
    "Historical Setting": "historical_setting",
    "Cultural Background": "cultural_background",
    "Author and Audience": "author_and_audience",
    "Literary Context": "literary_context",
    "Genre and Style": "genre_and_style",
    "Language and Translation": "language_and_translation",
    "Theological Themes": "theological_themes",
    "Immediate Purpose": "immediate_purpose",
}

_SECTION_RE = re.compile(r"^\*\*\d+\.\s+(.+?):\*\*\s*(.*)")
_BOOK_HEADING_RE = re.compile(r"^###\s+(.+)")


def _parse_context_file() -> Dict[str, Dict]:
    """Parse context.md into {USFM_CODE: {book, book_name, sections}}."""
    if not CONTEXT_FILE.exists():
        return {}

    text = CONTEXT_FILE.read_text(encoding="utf-8")
    result: Dict[str, Dict] = {}
    current_usfm: Optional[str] = None
    current_sections: Dict[str, Optional[str]] = {}

    for line in text.splitlines():
        book_match = _BOOK_HEADING_RE.match(line)
        if book_match:
            if current_usfm:
                result[current_usfm] = {
                    "book": current_usfm,
                    "book_name": _USFM_TO_NAME[current_usfm],
                    "sections": {k: None for k in _SECTION_KEYS.values()} | current_sections,
                }
            book_name = book_match.group(1).strip()
            current_usfm = NT_NAME_TO_USFM.get(book_name)
            current_sections = {}
            continue

        if current_usfm:
            section_match = _SECTION_RE.match(line)
            if section_match:
                label = section_match.group(1).strip()
                content = section_match.group(2).strip()
                key = _SECTION_KEYS.get(label)
                if key:
                    current_sections[key] = content or None

    if current_usfm:
        result[current_usfm] = {
            "book": current_usfm,
            "book_name": _USFM_TO_NAME[current_usfm],
            "sections": {k: None for k in _SECTION_KEYS.values()} | current_sections,
        }

    return result


_BOOK_CONTEXT_DATA: Dict[str, Dict] = _parse_context_file()

NT_USFM_CODES = set(NT_NAME_TO_USFM.values())


def get_book_context(book: str) -> Optional[Dict]:
    """Return context dict for a NT book, or None if not found.

    Accepts USFM code (e.g. 'MAT') or full name (e.g. 'Matthew').
    """
    usfm = book.strip().upper()
    if usfm in _BOOK_CONTEXT_DATA:
        return _BOOK_CONTEXT_DATA[usfm]
    for name, code in NT_NAME_TO_USFM.items():
        if name.lower() == book.strip().lower():
            return _BOOK_CONTEXT_DATA.get(code)
    return None
