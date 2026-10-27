import pytest

from chatbot import router, tabernacle_mode
from chatbot.tabernacle_mode import SPOTS_PATH_ENV, load_spots, match_spot, primer

IDS = {"boards", "table", "menorah", "incense", "ark", "laver", "altar", "gate", "door", "veil"}
ARTIFACT = {"type": "tabernacle", "label": "The Tabernacle", "params": {"spot": None}}


@pytest.fixture(autouse=True)
def _fresh_cache():
    load_spots.cache_clear()
    yield
    load_spots.cache_clear()


def test_load_spots_reads_all_ten():
    assert set(load_spots()) == IDS


def test_load_spots_missing_file_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setenv(SPOTS_PATH_ENV, str(tmp_path / "nope.json"))
    load_spots.cache_clear()
    assert load_spots() == {}


def test_load_spots_invalid_file_returns_empty(monkeypatch, tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    monkeypatch.setenv(SPOTS_PATH_ENV, str(bad))
    load_spots.cache_clear()
    assert load_spots() == {}


@pytest.mark.parametrize("text,expected", [
    ("What was inside the ark?", "ark"),
    ("tell me about the lampstand", "menorah"),
    ("the golden altar", "incense"),
    ("altar of incense", "incense"),
    ("why a brazen altar", "altar"),
    ("what is the altar for", "altar"),
    ("the vail", "veil"),
    ("hello", None),
    ("dark", None),
])
def test_match_spot(text, expected):
    assert match_spot(text) == expected


def test_primer_returns_intro_and_artifact():
    r = primer({})
    assert r["type"] == "chat"
    assert "Holy of Holies" in r["message"]
    assert r["artifacts"] == [ARTIFACT]
    assert len(r["follow_up_questions"]) == 3


def test_primer_restores_saved_spot():
    assert primer({"tabernacle_spot": "ark"})["artifacts"][0]["params"]["spot"] == "ark"


def test_primer_drops_unknown_saved_spot():
    assert primer({"tabernacle_spot": "nope"})["artifacts"][0]["params"]["spot"] is None


def test_primer_none_params():
    assert primer(None)["artifacts"] == [ARTIFACT]


async def test_router_primer_dispatches_tabernacle():
    r = await router.build_mode_primer("tabernacle", {})
    assert r["artifacts"] == [ARTIFACT]
