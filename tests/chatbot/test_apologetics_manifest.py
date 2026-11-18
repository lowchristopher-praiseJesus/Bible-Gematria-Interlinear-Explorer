"""Integrity of the committed Defend the Faith manifest
(chatbot/data/apologetics_shorts.json, built by
scripts/import_apologetics_shorts.py). Checks structure and refs only — never
the exact titles, which follow YouTube."""

import json
from pathlib import Path

import pytest

from chatbot import tabernacle_mode

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "chatbot" / "data" / "apologetics_shorts.json"


@pytest.fixture(scope="module")
def manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def test_tracks_reference_existing_shorts(manifest):
    for track in manifest["tracks"]:
        assert track["shorts"], track["id"]
        for n in track["shorts"]:
            assert str(n) in manifest["shorts"], f"{track['id']} -> #{n}"


def test_track_ids_unique_and_titles_nonempty(manifest):
    ids = [t["id"] for t in manifest["tracks"]]
    assert len(ids) == len(set(ids))
    assert all(t["title"].strip() for t in manifest["tracks"])
    assert all(s["title"].strip() and s["script"].strip() for s in manifest["shorts"].values())


def test_every_ref_resolves_in_complete_db(manifest):
    for short in manifest["shorts"].values():
        for item in short["further_reading"]:
            for ref in item["refs"]:
                assert tabernacle_mode.verse_text(ref), f"#{short['number']}: {ref} ({item['text']})"


def test_every_thumbnail_exists_under_frontend_public(manifest):
    for short in manifest["shorts"].values():
        assert (ROOT / "frontend" / "public" / short["thumbnail"].lstrip("/")).is_file(), short["thumbnail"]
