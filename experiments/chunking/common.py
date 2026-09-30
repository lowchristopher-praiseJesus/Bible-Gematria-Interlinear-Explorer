"""Shared helpers for the chunk-boundary experiment: KJV text from Complete.db,
ground-truth section headings (BSB, via helloao), and the labelled sample."""
import json
import re
import sqlite3
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
DB_PATH = ROOT / "Complete.db"
GROUND_TRUTH = HERE / "ground_truth.json"   # {"<id>": true}  heading starts at KJV verse id
SAMPLE = HERE / "sample.json"

_FOOTNOTE_RE = re.compile(r"<f\b[^>]*>.*?</f>", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


def clean(raw: str) -> str:
    text = _FOOTNOTE_RE.sub("", raw or "")
    text = _TAG_RE.sub("", text)
    return _SPACE_RE.sub(" ", text).strip()


def load_verses():
    """Canonical KJV verses in order: list of dicts (id, ref, bnum, cnum, vnum, text).
    Uses text_1769 (the KJV as printed), tags/footnotes stripped."""
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT id, ref, bnum, cnum, vnum, text_1769 FROM Complete ORDER BY id").fetchall()
    con.close()
    return [dict(id=r[0], ref=r[1], bnum=r[2], cnum=r[3], vnum=r[4], text=clean(r[5]))
            for r in rows]
