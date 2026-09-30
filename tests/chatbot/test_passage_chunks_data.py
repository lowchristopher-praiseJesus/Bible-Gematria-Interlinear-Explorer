"""The committed chunk table must cover every canonical verse exactly once."""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHUNKS = ROOT / "chatbot" / "data" / "passage_chunks.json"


def _verse_books():
    con = sqlite3.connect(f"file:{ROOT / 'Complete.db'}?mode=ro", uri=True)
    rows = con.execute("SELECT id, bnum FROM Complete ORDER BY id").fetchall()
    con.close()
    return dict(rows)


def test_chunks_cover_every_verse_exactly_once():
    pairs = json.loads(CHUNKS.read_text())
    books = _verse_books()
    assert len(books) == 31102
    assert pairs[0][0] == 1
    assert pairs[-1][1] == 31102
    for (a, b), nxt in zip(pairs, pairs[1:] + [None]):
        assert a <= b
        if nxt is not None:
            assert nxt[0] == b + 1, f"gap or overlap after {b}"


def test_chunks_are_two_to_sixteen_verses_and_stay_inside_one_book():
    pairs = json.loads(CHUNKS.read_text())
    books = _verse_books()
    assert len(pairs) == 4284
    for a, b in pairs:
        assert 2 <= b - a + 1 <= 16, (a, b)
        assert books[a] == books[b], f"chunk {a}-{b} crosses a book"
