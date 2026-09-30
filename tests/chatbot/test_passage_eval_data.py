# tests/chatbot/test_passage_eval_data.py
"""Every must-see reference in the eval set must be a real verse in Complete.db,
and the set must have its intended shape."""
import sqlite3
from pathlib import Path

from chatbot.data.passage_eval import CONCEPT, OFF_TOPIC, PASSAGE

ROOT = Path(__file__).resolve().parents[2]


def _refs():
    con = sqlite3.connect(f"file:{ROOT / 'Complete.db'}?mode=ro", uri=True)
    refs = {r[0] for r in con.execute("SELECT ref FROM Complete")}
    con.close()
    return refs


def test_shape():
    assert len(CONCEPT) == 30 and len(PASSAGE) == 6 and len(OFF_TOPIC) == 6
    for item in CONCEPT + PASSAGE:
        assert item["query"].strip() and len(item["must_see"]) >= 3
    assert len({i["query"] for i in CONCEPT + PASSAGE}) == 36


def test_every_must_see_reference_exists():
    refs = _refs()
    missing = [(i["query"], r) for i in CONCEPT + PASSAGE for r in i["must_see"] if r not in refs]
    assert missing == []


def test_passage_queries_parse_as_passages():
    from chatbot.passage_search import Query, parse_query
    for item in PASSAGE:
        assert isinstance(parse_query(item["query"]), Query), item["query"]
        assert parse_query(item["query"]).kind == "passage"
