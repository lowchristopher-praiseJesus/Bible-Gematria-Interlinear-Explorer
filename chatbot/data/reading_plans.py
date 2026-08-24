"""Static data for the 'Bible in a Year' reading-plan mode.

Both plans read all 66 books at chapter granularity. CHRONOLOGICAL_ORDER
reorders the books per a widely used simplified chronological reading
order (book-level only — full verse-level interleaving, as done by some
published chronological plans, is out of scope for v1).
"""

from typing import Dict, List

CHAPTER_COUNTS: Dict[str, int] = {
    "Genesis": 50, "Exodus": 40, "Leviticus": 27, "Numbers": 36, "Deuteronomy": 34,
    "Joshua": 24, "Judges": 21, "Ruth": 4, "1 Samuel": 31, "2 Samuel": 24,
    "1 Kings": 22, "2 Kings": 25, "1 Chronicles": 29, "2 Chronicles": 36,
    "Ezra": 10, "Nehemiah": 13, "Esther": 10, "Job": 42, "Psalm": 150,
    "Proverbs": 31, "Ecclesiastes": 12, "Song of Solomon": 8, "Isaiah": 66,
    "Jeremiah": 52, "Lamentations": 5, "Ezekiel": 48, "Daniel": 12, "Hosea": 14,
    "Joel": 3, "Amos": 9, "Obadiah": 1, "Jonah": 4, "Micah": 7, "Nahum": 3,
    "Habakkuk": 3, "Zephaniah": 3, "Haggai": 2, "Zechariah": 14, "Malachi": 4,
    "Matthew": 28, "Mark": 16, "Luke": 24, "John": 21, "Acts": 28, "Romans": 16,
    "1 Corinthians": 16, "2 Corinthians": 13, "Galatians": 6, "Ephesians": 6,
    "Philippians": 4, "Colossians": 4, "1 Thessalonians": 5, "2 Thessalonians": 3,
    "1 Timothy": 6, "2 Timothy": 4, "Titus": 3, "Philemon": 1, "Hebrews": 13,
    "James": 5, "1 Peter": 5, "2 Peter": 3, "1 John": 5, "2 John": 1, "3 John": 1,
    "Jude": 1, "Revelation": 22,
}

CANONICAL_ORDER: List[str] = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges",
    "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles",
    "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalm", "Proverbs",
    "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations",
    "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
    "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
    "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
    "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
    "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus",
    "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John",
    "3 John", "Jude", "Revelation",
]

CHRONOLOGICAL_ORDER: List[str] = [
    "Job", "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
    "Judges", "Ruth", "1 Samuel", "2 Samuel", "Psalm", "1 Kings", "1 Chronicles",
    "2 Chronicles", "Proverbs", "Ecclesiastes", "Song of Solomon", "Joel",
    "Obadiah", "Jonah", "Amos", "Hosea", "Isaiah", "Micah", "Nahum", "2 Kings",
    "Zephaniah", "Jeremiah", "Habakkuk", "Lamentations", "Ezekiel", "Daniel",
    "Ezra", "Haggai", "Zechariah", "Esther", "Nehemiah", "Malachi",
    "Matthew", "Mark", "Luke", "John", "Acts", "James", "Galatians",
    "1 Thessalonians", "2 Thessalonians", "1 Corinthians", "2 Corinthians",
    "Romans", "Ephesians", "Philippians", "Colossians", "Philemon", "1 Timothy",
    "Titus", "1 Peter", "2 Timothy", "Hebrews", "2 Peter", "Jude", "1 John",
    "2 John", "3 John", "Revelation",
]

_DAYS = 365
_PLANS_CACHE: Dict[str, List[List[Dict[str, int]]]] = {}


def _build_plan(book_order: List[str], days: int = _DAYS) -> List[List[Dict[str, int]]]:
    """Distribute every chapter in book_order across `days` daily readings,
    never splitting a book's chapters out of order."""
    total_chapters = sum(CHAPTER_COUNTS[b] for b in book_order)
    target_per_day = total_chapters / days
    plan: List[List[Dict[str, int]]] = [[] for _ in range(days)]
    day = 0
    assigned = 0
    for book in book_order:
        for chapter in range(1, CHAPTER_COUNTS[book] + 1):
            plan[day].append({"book": book, "chapter": chapter})
            assigned += 1
            if day < days - 1 and assigned >= round(target_per_day * (day + 1)):
                day += 1
    return plan


def get_reading_plan(plan: str) -> List[List[Dict[str, int]]]:
    if plan not in _PLANS_CACHE:
        order = CANONICAL_ORDER if plan == "canonical" else CHRONOLOGICAL_ORDER
        _PLANS_CACHE[plan] = _build_plan(order)
    return _PLANS_CACHE[plan]


def get_day_reading(plan: str, day_index: int) -> List[Dict[str, int]]:
    schedule = get_reading_plan(plan)
    if day_index < 0 or day_index >= len(schedule):
        raise ValueError(f"day_index must be between 0 and {len(schedule) - 1}, got {day_index}")
    return schedule[day_index]
