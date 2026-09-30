import importlib.util
import json
from pathlib import Path

from chatbot import passage_tsk

ROOT = Path(__file__).resolve().parents[2]


def _script():
    spec = importlib.util.spec_from_file_location("build_tsk", ROOT / "scripts" / "build_tsk_crossrefs.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_parse_ref_handles_plain_and_range_starts():
    build = _script()
    assert build.parse_ref("Gen.1.1") == (1, 1, 1)
    assert build.parse_ref("Prov.8.22-Prov.8.30") == (20, 8, 22)     # range → its first verse
    assert build.parse_ref("1Thess.4.17") == (52, 4, 17)
    assert build.parse_ref("Rev.22.21") == (66, 22, 21)
    assert build.parse_ref("Nonsense.1.1") is None
    assert len(build.ABBREVIATIONS) == 66


def test_related_verse_ids_sums_votes_and_orders(monkeypatch):
    monkeypatch.setattr(passage_tsk, "_TABLE", {"1": [[10, 5], [20, 9]], "2": [[10, 7], [30, 1]]})
    monkeypatch.setattr(passage_tsk, "_LOADED", True)
    assert passage_tsk.related_verse_ids([1, 2]) == [10, 20, 30]        # 10 → 12 votes
    assert passage_tsk.related_verse_ids([1, 2], limit=1) == [10]
    assert passage_tsk.related_verse_ids([99]) == []


def test_related_verse_ids_is_empty_when_the_file_is_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(passage_tsk, "TSK_FILE", tmp_path / "nope.json")
    monkeypatch.setattr(passage_tsk, "_LOADED", False)
    monkeypatch.setattr(passage_tsk, "_TABLE", {})
    assert passage_tsk.related_verse_ids([1]) == []


def test_committed_table_is_well_formed():
    table = json.loads((ROOT / "chatbot" / "data" / "tsk_crossrefs.json").read_text())
    assert len(table) > 15000
    for key, targets in list(table.items())[:500]:
        assert 1 <= int(key) <= 31102
        assert 1 <= len(targets) <= 25
        for target_id, votes in targets:
            assert 1 <= target_id <= 31102 and votes >= 5
    assert len(table["1"]) >= 5            # Genesis 1:1 is heavily cross-referenced
