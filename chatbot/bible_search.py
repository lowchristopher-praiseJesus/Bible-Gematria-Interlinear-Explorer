"""Direct SQLite queries against Complete.db for gematria and English
full-text search.

Ported from myproject.py's gematria_api_data() / english_api_data()
(the JSON-shaped API helpers, not the HTML-rendering routes), with the
Flask response-caching decorator dropped. Deliberately independent of
the mybibletoolbox-code dependency the rest of chatbot/ relies on.
"""

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import dataset

DB_PATH = f"sqlite:///{Path(__file__).resolve().parent.parent / 'Complete.db'}"
ROW_RESULT_LIMIT = 20000

_TAG_RE = re.compile(r"</?(?:i|divine|inscription|psalmheader|headingletter|colophon)>")


def _remove_tags(text: str) -> str:
    return _TAG_RE.sub("", text)


def _find_match_positions(text: str, search_term: str) -> List[Dict[str, int]]:
    positions = []
    text_lower = text.lower()
    term_lower = search_term.lower()
    start = 0
    while True:
        idx = text_lower.find(term_lower, start)
        if idx == -1:
            break
        positions.append({"start": idx, "length": len(search_term)})
        start = idx + 1
    return positions


def _strongs_row_to_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "strongsNumber": row["StrongsNumber"],
        "root": row["Root"],
        "value": row["Value"],
        "transliteration1": row["Transliteration1"],
        "transliteration2": row["Transliteration2"],
        "transliteration": row["Transliteration"],
        "partOfSpeech": row["Part_of_Speech"],
        "meaning": row["Meaning"],
        "strongsDefinition": row["Strongs_Definition"],
        "outline": row["Outline"],
        "verseCount": row["VerseCount"],
        "bookCount": row["BookCount"],
        "usageCount": row["UsageCount"],
        "note": row["Note"],
    }


def search_gematria_sync(value: int) -> Dict[str, Any]:
    """Find original-language words and verse totals matching a gematria value."""
    db = dataset.connect(DB_PATH)
    strongs_table = db["Strongs_"]

    word_rows = list(db.query(
        "SELECT * FROM Complete WHERE Original_Words_values LIKE :otv LIMIT " + str(ROW_RESULT_LIMIT),
        otv="%~" + str(value) + "~%",
    ))
    verse_rows = list(db.query("SELECT * FROM Complete WHERE total = :value", value=value))

    word_results: List[Dict[str, Any]] = []
    all_sns: List[str] = []
    for row in word_rows:
        sn_list = row["Original_Words_SN"].strip("{").strip("}").strip("~").split("~")
        ow_list = row["Original_Words"].split("~")
        val_list = row["Original_Words_values"].strip("{").strip("}").strip("~").split("~")
        lang = "G" if row["id"] > 23145 else "H"
        for sn, ow, ov in zip(sn_list, ow_list, val_list):
            if ov == "NONE":
                continue
            try:
                if int(ov) == value:
                    word_results.append({
                        "id": row["id"], "ref": row["ref"], "bnum": row["bnum"],
                        "cnum": row["cnum"], "vnum": row["vnum"],
                        "strongsNumber": sn, "wordHtml": ow, "language": lang,
                    })
                    if sn not in all_sns:
                        all_sns.append(sn)
            except ValueError:
                pass

    verse_results = [
        {
            "id": r["id"], "ref": r["ref"], "bnum": r["bnum"], "cnum": r["cnum"],
            "vnum": r["vnum"], "total": r["total"], "text1769": r["text_1769"],
        }
        for r in verse_rows
    ]

    strongs_defs: Dict[str, Any] = {}
    if all_sns:
        for result in strongs_table.find(StrongsNumber=all_sns):
            if result["Root"] is not None:
                strongs_defs[result["StrongsNumber"]] = _strongs_row_to_dict(result)

    return {
        "value": value,
        "wordResults": word_results,
        "verseResults": verse_results,
        "strongsDefinitions": strongs_defs,
    }


def search_english_sync(query: str) -> Dict[str, Any]:
    """Full-text search of KJV verse text."""
    db = dataset.connect(DB_PATH)
    rows = list(db.query(
        "SELECT * FROM Complete WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("
        "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(text_1769, "
        "'</i>', ''), '<i>', ''), '</divine>', ''), '<divine>', ''), "
        "'</inscription>', ''), '<inscription>', ''), '</psalmheader>', ''), "
        "'<psalmheader>', ''), '</headingletter>', ''), '<headingletter>', ''), "
        "'</colophon>', ''), '<colophon>', '') LIKE :words LIMIT " + str(ROW_RESULT_LIMIT),
        words="%" + query + "%",
    ))

    results = []
    for row in rows:
        plain = _remove_tags(row["text_1769"])
        results.append({
            "id": row["id"], "ref": row["ref"], "bnum": row["bnum"],
            "cnum": row["cnum"], "vnum": row["vnum"], "text": plain,
            "matchPositions": _find_match_positions(plain, query),
        })

    return {
        "query": query,
        "results": results,
        "truncated": len(rows) == ROW_RESULT_LIMIT,
    }


def random_verse_sync() -> tuple:
    """Pick a random canonical (non-Apocrypha) verse. Returns (book, chapter, verse)."""
    import random
    db = dataset.connect(DB_PATH)
    verse_id = random.randint(1, 31102)
    row = db["Complete"].find_one(id=verse_id)
    return row["book"], row["cnum"], row["vnum"]


def list_passage_verses_sync(
    book_name: str,
    chapter: int,
    start_verse: Optional[int] = None,
    end_verse: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """List a chapter's (or verse-range's) verses as bare structural refs —
    versenumber/vnum/ref only, no translation text. Callers hydrate the text
    themselves (e.g. via fetch_verse_translations), so this stays a fast,
    local-only lookup independent of any external fetch."""
    db = dataset.connect(DB_PATH)
    rows = db["Complete"].find(book=book_name, cnum=chapter, order_by="vnum")
    verses = []
    for row in rows:
        if start_verse is not None and row["vnum"] < start_verse:
            continue
        if end_verse is not None and row["vnum"] > end_verse:
            continue
        # The row already carries the 1769 KJV text (it's the same row
        # english_search_sync reads for full-text search) — surfacing it
        # here costs nothing extra and lets callers show a chapter's KJV
        # instantly from the local DB, without waiting on the external
        # multi-translation fetch fetch_verse_translations() does.
        kjv = _remove_tags(row["text_1769"]) if row["text_1769"] else None
        verses.append({"versenumber": row["id"], "vnum": row["vnum"], "ref": row["ref"], "kjv": kjv})
    return verses
