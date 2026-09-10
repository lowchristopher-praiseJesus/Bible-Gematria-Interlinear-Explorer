import re
from pathlib import Path

import pytest

from chatbot.data.devotional_verses import DEVOTIONAL_POOL
from chatbot.devotional import _USFM_REF_RE

_DB_PATH = Path(__file__).resolve().parents[2] / "Complete.db"

# Invert the router's name->USFM map so a DB check can go USFM->book name.
from chatbot.router import _usfm_from_name  # noqa: E402

_USFM_TO_NAME = {}
for _name in [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
    "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
    "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
    "Psalm", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
    "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
    "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
    "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
    "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
]:
    _USFM_TO_NAME[_usfm_from_name(_name)] = _name


def test_pool_has_at_least_a_year_of_verses():
    assert len(DEVOTIONAL_POOL) >= 366


def test_pool_entries_are_wellformed_usfm_refs():
    bad = [r for r in DEVOTIONAL_POOL if not _USFM_REF_RE.match(r)]
    assert bad == [], f"malformed refs: {bad}"


def test_pool_has_no_duplicates():
    from collections import Counter
    dupes = [r for r, n in Counter(DEVOTIONAL_POOL).items() if n > 1]
    assert dupes == [], f"duplicate refs: {dupes}"


@pytest.mark.skipif(not _DB_PATH.exists(), reason="Complete.db not present")
def test_every_pool_ref_resolves_in_complete_db():
    import dataset

    db = dataset.connect(f"sqlite:///{_DB_PATH}")
    missing = []
    for ref in DEVOTIONAL_POOL:
        m = _USFM_REF_RE.match(ref)
        usfm, chapter, verse = m.group(1), int(m.group(2)), int(m.group(3))
        book = _USFM_TO_NAME.get(usfm)
        row = db["Complete"].find_one(book=book, cnum=chapter, vnum=verse)
        if row is None or not (row.get("text_1769") or "").strip():
            missing.append(ref)
    assert missing == [], f"refs with no KJV verse in Complete.db: {missing}"
