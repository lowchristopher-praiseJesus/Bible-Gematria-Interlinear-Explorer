import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "tabernacle"
SPOTS_JSON = ROOT / "data" / "spots.json"
INDEX_HTML = ROOT / "index.html"

SPOT_IDS = {"boards", "table", "menorah", "incense", "ark", "laver", "altar", "gate", "door", "veil"}


@pytest.fixture(scope="module")
def spots():
    return json.loads(SPOTS_JSON.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def index_html():
    return INDEX_HTML.read_text(encoding="utf-8")


def test_spot_ids_match_the_viewer_buttons(spots, index_html):
    button_ids = set(re.findall(r'data-spot="([^"]+)"', index_html))
    assert button_ids == set(spots) == SPOT_IDS


def test_every_spot_has_required_fields(spots):
    for spot_id, spot in spots.items():
        for field in ("label", "title", "html", "aliases", "refs"):
            assert spot.get(field), f"{spot_id}: missing {field}"
        for ref in spot["refs"]:
            assert ref.get("usfm") and ref.get("label"), f"{spot_id}: bad ref {ref!r}"
        assert all(a == a.lower() for a in spot["aliases"]), f"{spot_id}: aliases must be lowercase"


def test_every_ref_resolves_against_complete_db(spots):
    import dataset
    from chatbot.bible_search import DB_PATH, _USFM_TO_BNUM

    db = dataset.connect(DB_PATH)
    for spot_id, spot in spots.items():
        for ref in spot["refs"]:
            book, _, chapter_verse = ref["usfm"].partition(" ")
            chapter, _, verse = chapter_verse.partition(":")
            bnum = _USFM_TO_BNUM.get(book.upper())
            assert bnum, f"{spot_id}: unknown book in {ref['usfm']!r}"
            first_verse = int(re.split(r"[-,]", verse)[0])
            row = db["Complete"].find_one(bnum=bnum, cnum=int(chapter), vnum=first_verse)
            assert row is not None, f"{spot_id}: {ref['usfm']!r} does not resolve"


def test_index_html_has_no_info_templates(index_html):
    assert '<template id="info-' not in index_html
