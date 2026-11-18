import importlib.util
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIX = Path(__file__).parent / "fixtures" / "apologetics"
SCRIPT_TEXT = (FIX / "01 Historical Reliability - script.txt").read_text()


def _script():
    spec = importlib.util.spec_from_file_location("import_apologetics_shorts", ROOT / "scripts" / "import_apologetics_shorts.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TRACKS = {
    "tracks": [{"id": "t1", "title": "Track One", "blurb": "b", "shorts": [1, 3]}],
    "youtube_ids": {"1": "id1", "3": "id3"},
}


@pytest.fixture
def src(tmp_path):
    for name in ("01 Historical Reliability - description.txt", "01 Historical Reliability - script.txt",
                 "03 The Resurrection - description.txt"):
        shutil.copy(FIX / name, tmp_path / name)
    (tmp_path / "03 The Resurrection - script.txt").write_text("A magistrate brags.\n")
    return tmp_path


def test_build_manifest_uses_youtube_titles(src):
    s = _script()
    m = s.build_manifest(src, TRACKS, fetch_title=lambda vid: f"YT {vid}")
    one = m["shorts"]["1"]
    assert one["title"] == "YT id1"
    assert one["youtube_id"] == "id1"
    assert one["subject"] == "Historical Reliability"
    assert one["script"] == SCRIPT_TEXT
    assert one["thumbnail"] == "/apologetics/thumbs/01.jpg"
    assert one["summary"].startswith("A professor calls the Gospels")
    assert m["shorts"]["3"]["further_reading"][0] == {"text": "Acts 5 & 12", "refs": ["ACT 5:1", "ACT 12:1"]}
    assert m["tracks"] == [{"id": "t1", "title": "Track One", "blurb": "b", "shorts": [1, 3]}]


def test_short_without_youtube_id_is_not_fetched(src):
    s = _script()
    calls = []

    def fetch(vid):
        calls.append(vid)
        return "T"

    m = s.build_manifest(src, {**TRACKS, "youtube_ids": {"1": "id1"}}, fetch_title=fetch)
    assert calls == ["id1"]
    assert m["shorts"]["3"]["youtube_id"] is None
    assert m["shorts"]["3"]["title"] == "The Resurrection"  # not uploaded: subject only


def test_title_fetch_failure_fails_import(src):
    s = _script()

    def boom(vid):
        raise OSError("offline")

    with pytest.raises(s.ImportError_, match="id1"):
        s.build_manifest(src, TRACKS, fetch_title=boom)


def test_track_naming_missing_short_fails(src):
    s = _script()
    bad = {**TRACKS, "tracks": [{"id": "x", "title": "X", "blurb": "", "shorts": [99]}]}
    with pytest.raises(s.ImportError_, match="#99"):
        s.build_manifest(src, bad, fetch_title=str)


def test_rerun_is_idempotent(src):
    s = _script()
    assert s.build_manifest(src, TRACKS, fetch_title=str) == s.build_manifest(src, TRACKS, fetch_title=str)
