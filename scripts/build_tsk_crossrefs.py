# scripts/build_tsk_crossrefs.py
"""Build chatbot/data/tsk_crossrefs.json from OpenBible.info's cross-reference
data (CC-BY; Treasury of Scripture Knowledge with community votes).

    python scripts/build_tsk_crossrefs.py [path/to/cross_references.txt]

With no argument the zip is downloaded from https://a.openbible.info/data/.
Keeps, for each source verse, up to 25 targets with votes >= 5, highest
first. A range target ("Prov.8.22-Prov.8.30") is stored as its first verse.
Output: {"<source verse id>": [[target verse id, votes], ...]}."""
import io
import json
import re
import sqlite3
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "chatbot" / "data" / "tsk_crossrefs.json"
URL = "https://a.openbible.info/data/cross-references.zip"
MIN_VOTES = 5
PER_VERSE = 25

ABBREVIATIONS = (
    "Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov "
    "Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal "
    "Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm "
    "Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev"
).split()
_BOOK_NUMBER = {a: i + 1 for i, a in enumerate(ABBREVIATIONS)}
_REF_RE = re.compile(r"^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$")


def parse_ref(text: str):
    """(book_number, chapter, verse) of a ref or of a range's first verse."""
    match = _REF_RE.match(text.split("-")[0])
    if not match or match.group(1) not in _BOOK_NUMBER:
        return None
    return _BOOK_NUMBER[match.group(1)], int(match.group(2)), int(match.group(3))


def _read_source(path: str = None) -> str:
    if path:
        return Path(path).read_text(encoding="utf-8")
    data = httpx.get(URL, timeout=60, follow_redirects=True).content
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return z.read("cross_references.txt").decode("utf-8")


def main() -> None:
    con = sqlite3.connect(f"file:{ROOT / 'Complete.db'}?mode=ro", uri=True)
    verse_id = {(b, c, v): i for i, b, c, v in con.execute("SELECT id, bnum, cnum, vnum FROM Complete")}
    con.close()
    table = defaultdict(dict)
    skipped = 0
    for line in _read_source(sys.argv[1] if len(sys.argv) > 1 else None).splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        source, target, votes = parse_ref(parts[0]), parse_ref(parts[1]), int(parts[2])
        if votes < MIN_VOTES or source is None or target is None:
            continue
        s_id, t_id = verse_id.get(source), verse_id.get(target)
        if s_id is None or t_id is None or s_id == t_id:
            skipped += 1
            continue
        table[s_id][t_id] = max(votes, table[s_id].get(t_id, 0))
    result = {
        str(s): [[t, v] for t, v in sorted(targets.items(), key=lambda kv: -kv[1])[:PER_VERSE]]
        for s, targets in sorted(table.items())
    }
    OUT.write_text(json.dumps(result, separators=(",", ":")))
    print(f"{len(result)} source verses, {sum(len(v) for v in result.values())} links, "
          f"{skipped} unmappable skipped → {OUT.name} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
