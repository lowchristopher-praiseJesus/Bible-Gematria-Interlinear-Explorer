"""Local check that every DEVOTIONAL_POOL entry resolves to KJV verse text.

Two modes:

    python scripts/validate_devotional_pool.py            # against Complete.db
    python scripts/validate_devotional_pool.py --runtime  # against the live
                                                          # fetch path

The default queries `Complete.db` directly. `--runtime` instead calls
`chatbot.tools.fetch_verse_translations` for every ref — that's the corpus
actually used to render a devotional (MYBIBLETOOLBOX_PATH / the biblehub
fetcher), which can differ from `Complete.db`. A ref the runtime can't
serve is no longer fatal at request time (chatbot.devotional falls through
to the next rotation card, then to FALLBACK_VERSES), but it's still worth
knowing about.

This script only *validates* the pool — it never rewrites it. Editing
DEVOTIONAL_POOL reshuffles every existing browser's rotation deck and can
re-serve verses clients already saw, so pool changes must be rare and
deliberate. Exits non-zero and lists offenders if any entry doesn't
resolve."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chatbot.data.devotional_verses import DEVOTIONAL_POOL
from chatbot.devotional import _USFM_REF_RE, _kjv_text

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


def check_against_db():
    """Every pool entry must be a real verse with KJV text in Complete.db."""
    import dataset

    from chatbot.router import _usfm_from_name

    usfm_to_name = {_usfm_from_name(n): n for n in _NAMES}

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
        book = usfm_to_name.get(usfm)
        row = db["Complete"].find_one(book=book, cnum=chapter, vnum=verse)
        if row is None:
            bad.append((ref, f"no row for {book} {chapter}:{verse}"))
        elif not (row.get("text_1769") or "").strip():
            bad.append((ref, "empty KJV text"))
    return bad


def check_runtime():
    """Every pool entry must resolve through the live runtime fetch path
    (chatbot.tools.fetch_verse_translations) — the corpus a real devotional
    request reads from. For a range, the anchor (first) verse is probed,
    since the runtime joins whatever resolves in the span."""
    from chatbot.tools import fetch_verse_translations

    async def _run():
        bad = []
        for ref in DEVOTIONAL_POOL:
            m = _USFM_REF_RE.match(ref)
            if not m:
                bad.append((ref, "malformed"))
                continue
            probe = f"{m.group(1)} {m.group(2)}:{m.group(3)}"
            try:
                translations = await fetch_verse_translations(probe, languages=["eng"])
            except Exception as exc:  # noqa: BLE001 — report, don't abort the sweep
                bad.append((ref, f"raised {type(exc).__name__}: {exc}"))
                continue
            if not translations or not _kjv_text(translations):
                bad.append((ref, "empty / no translations"))
        return bad

    return asyncio.run(_run())


def main():
    runtime = "--runtime" in sys.argv[1:]
    label = "runtime fetch path" if runtime else "Complete.db"
    try:
        bad = check_runtime() if runtime else check_against_db()
    except Exception as exc:  # noqa: BLE001
        # A missing MYBIBLETOOLBOX_PATH / import error / blocked network makes
        # --runtime unavailable in some environments — say so plainly and exit
        # non-zero rather than pretending the pool is clean.
        sys.exit(
            f"{label} validation could not run: {type(exc).__name__}: {exc}"
        )

    print(f"checked {len(DEVOTIONAL_POOL)} refs against {label}, {len(bad)} problem(s)")
    for ref, why in bad:
        print(f"  {ref}: {why}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
