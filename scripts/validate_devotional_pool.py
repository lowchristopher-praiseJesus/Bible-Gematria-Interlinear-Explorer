"""Local check that every DEVOTIONAL_POOL entry is a real verse with KJV
text in Complete.db. Run from the repo root:  python scripts/validate_devotional_pool.py
Exits non-zero and lists offenders if any entry doesn't resolve."""

import sys
from pathlib import Path

import dataset

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chatbot.data.devotional_verses import DEVOTIONAL_POOL
from chatbot.devotional import _USFM_REF_RE
from chatbot.router import _usfm_from_name

_NAMES = [
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
]
USFM_TO_NAME = {_usfm_from_name(n): n for n in _NAMES}

db_path = Path(__file__).resolve().parents[1] / "Complete.db"
if not db_path.exists():
    sys.exit(f"Complete.db not found at {db_path}")

db = dataset.connect(f"sqlite:///{db_path}")
bad = []
for ref in DEVOTIONAL_POOL:
    m = _USFM_REF_RE.match(ref)
    if not m:
        bad.append((ref, "malformed"))
        continue
    usfm, chapter, verse = m.group(1), int(m.group(2)), int(m.group(3))
    book = USFM_TO_NAME.get(usfm)
    row = db["Complete"].find_one(book=book, cnum=chapter, vnum=verse)
    if row is None:
        bad.append((ref, f"no row for {book} {chapter}:{verse}"))
    elif not (row.get("text_1769") or "").strip():
        bad.append((ref, "empty KJV text"))

print(f"checked {len(DEVOTIONAL_POOL)} refs, {len(bad)} problem(s)")
for ref, why in bad:
    print(f"  {ref}: {why}")
sys.exit(1 if bad else 0)
