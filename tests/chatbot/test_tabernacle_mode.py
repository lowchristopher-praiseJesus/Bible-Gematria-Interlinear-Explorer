import json
import re
from pathlib import Path

import pytest

from chatbot import router, tabernacle_mode
from chatbot.tabernacle_mode import SPOTS_PATH_ENV, load_spots, match_spot, primer

IDS = {"boards", "table", "menorah", "incense", "ark", "laver", "altar", "gate", "door", "veil"}
ARTIFACT = {"type": "tabernacle", "label": "The Tabernacle", "params": {"spot": None}}


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    monkeypatch.delenv(SPOTS_PATH_ENV, raising=False)
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


def test_match_spot_skips_malformed_entries(monkeypatch):
    monkeypatch.setattr(tabernacle_mode, "load_spots", lambda: {
        "bad1": "not a dict",
        "bad2": {"aliases": "ark"},
        "good": {"aliases": ["ark"]},
    })
    assert match_spot("the ark") == "good"


# --- grounded answers -------------------------------------------------------

@pytest.fixture
def llm(monkeypatch):
    calls = []
    state = {"reply": {"type": "chat", "message": "It was gold.", "data": None}}

    async def fake_call(message, research_data, conversation_history=None, page_context=None, system_prompt=None):
        calls.append({"message": message, "research_data": research_data,
                      "history": conversation_history, "system_prompt": system_prompt})
        return dict(state["reply"])

    async def fake_follow_ups(user_message, assistant_message, page_context=None):
        return ["Why gold?"]

    monkeypatch.setattr(tabernacle_mode, "call_ollama_with_context", fake_call)
    monkeypatch.setattr(tabernacle_mode, "generate_llm_follow_ups", fake_follow_ups)
    return type("LLM", (), {"calls": calls, "state": state})


def test_verse_text_reads_kjv():
    assert "testimony" in tabernacle_mode.verse_text("EXO 25:22").lower()


def test_verse_text_range_and_unresolvable():
    assert len(tabernacle_mode.verse_text("EXO 25:10-12")) > len(tabernacle_mode.verse_text("EXO 25:10"))
    assert tabernacle_mode.verse_text("XXX 1:1") == ""
    assert tabernacle_mode.verse_text("garbage") == ""


def test_grounding_for_spot_has_panel_text_and_verses():
    g = tabernacle_mode.grounding_for("ark")
    assert "<" not in g
    assert tabernacle_mode._plain(load_spots()["ark"]["html"])[:80] in g
    assert "&mdash;" not in g
    assert "testimony" in g.lower()
    assert tabernacle_mode.verse_text("EXO 25:22") in g


def test_grounding_for_none_lists_all_spots():
    g = tabernacle_mode.grounding_for(None)
    for spot in load_spots().values():
        assert spot["label"] in g


async def test_answer_uses_spot_named_in_message(llm):
    r = await tabernacle_mode.answer("what was the laver for?", [], {"tabernacle_spot": "ark"})
    assert tabernacle_mode.grounding_for("laver") == llm.calls[0]["research_data"]
    assert r["data"] == {"tabernacle_spot": "laver"}
    assert r["follow_up_questions"] == ["Why gold?"]
    assert r["route"] == "tabernacle_mode → laver"


async def test_answer_falls_back_to_current_spot(llm):
    r = await tabernacle_mode.answer("why gold?", [], {"tabernacle_spot": "ark"})
    # grounded on the saved spot, but the camera stays put: neither text names one
    assert tabernacle_mode.grounding_for("ark") == llm.calls[0]["research_data"]
    assert r["data"] == {"tabernacle_spot": None}


async def test_answer_cue_from_reply_over_saved_spot(llm):
    llm.state["reply"] = {"type": "chat", "message": "Then the priest washed at the laver.", "data": None}
    r = await tabernacle_mode.answer("what came next?", [], {"tabernacle_spot": "ark"})
    assert tabernacle_mode.grounding_for("ark") == llm.calls[0]["research_data"]
    assert r["data"] == {"tabernacle_spot": "laver"}


@pytest.mark.parametrize("text,expected", [
    ("Beyond the veil stood the ark", "veil"),
    ("the altar of incense", "incense"),
    ("At the altar, then the laver", "altar"),
    ("nothing here", None),
    ("", None),
])
def test_first_spot_in(text, expected):
    assert tabernacle_mode.first_spot_in(text) == expected


async def test_answer_cue_from_reply_when_message_names_none(llm):
    llm.state["reply"] = {"type": "chat", "message": "Next came the laver.", "data": None}
    r = await tabernacle_mode.answer("what came next?", [], {})
    assert r["data"] == {"tabernacle_spot": "laver"}
    assert r["route"] == "tabernacle_mode → general"


async def test_answer_maps_history(llm):
    await tabernacle_mode.answer("why?", [{"role": "user", "text": "hi"}], None)
    assert llm.calls[0]["history"] == [{"role": "user", "content": "hi"}]


async def test_answer_resolves_scripture_refs(llm):
    llm.state["reply"] = {"type": "chat", "message": "See Exodus 25:22.", "data": None}
    r = await tabernacle_mode.answer("tell me about the ark", [], None)
    assert "](/explorer?" in r["message"]


async def test_answer_llm_failure_is_honest(llm):
    llm.state["reply"] = {"type": "error", "message": ""}
    r = await tabernacle_mode.answer("tell me about the ark", [], None)
    assert r["type"] == "chat"
    assert r["message"] == "I couldn't answer that right now \u2014 please try again."
    assert r["data"] == {"tabernacle_spot": "ark"}


async def test_answer_llm_failure_does_not_cue_the_saved_spot(llm):
    llm.state["reply"] = {"type": "error", "message": ""}
    r = await tabernacle_mode.answer("why gold?", [], {"tabernacle_spot": "ark"})
    assert r["message"] == "I couldn't answer that right now \u2014 please try again."
    assert r["data"] == {"tabernacle_spot": None}


async def test_answer_without_spot_data_says_so(llm, monkeypatch):
    monkeypatch.setattr(tabernacle_mode, "load_spots", lambda: {})
    await tabernacle_mode.answer("hello", [], None)
    assert "panel text is unavailable" in llm.calls[0]["research_data"]


def test_post_chat_routes_tabernacle(client, monkeypatch):
    import chatbot.api as api_module
    captured = {}

    async def fake_answer(message, history, mode_params):
        captured.update(message=message, mode_params=mode_params)
        return {"type": "chat", "message": "[tab]", "data": None, "route": "t"}

    monkeypatch.setattr(api_module.tabernacle_mode, "answer", fake_answer)
    res = client.post("/chat", json={"message": "why gold?", "mode": "tabernacle",
                                     "mode_params": {"tabernacle_spot": "ark"}})
    assert res.status_code == 200
    assert res.json()["message"] == "[tab]"
    assert captured == {"message": "why gold?", "mode_params": {"tabernacle_spot": "ark"}}


def test_chat_stream_routes_tabernacle(client, monkeypatch):
    import chatbot.api as api_module
    captured = {}

    async def fake_answer(message, history, mode_params):
        captured.update(message=message, mode_params=mode_params)
        return {"type": "chat", "message": "[tab]", "data": {"tabernacle_spot": "laver"}, "route": "t"}

    monkeypatch.setattr(api_module.tabernacle_mode, "answer", fake_answer)
    res = client.post("/chat/stream", json={"message": "why gold?", "mode": "tabernacle",
                                            "mode_params": {"tabernacle_spot": "ark"}})
    assert res.status_code == 200
    events = [json.loads(c.strip()[len("data: "):]) for c in res.text.strip().split("\n\n")
              if c.strip().startswith("data: ")]
    finals = [e for e in events if e["type"] == "final"]
    assert len(finals) == 1
    assert finals[0]["result"]["message"] == "[tab]"
    assert finals[0]["result"]["data"] == {"tabernacle_spot": "laver"}
    assert captured == {"message": "why gold?", "mode_params": {"tabernacle_spot": "ark"}}


def test_chatbot_image_ships_spot_data():
    dockerfile = (Path(__file__).resolve().parents[2] / "Dockerfile.chatbot").read_text(encoding="utf-8")
    assert re.search(r"^COPY\s+frontend/public/tabernacle/data/spots\.json\s+\./data/tabernacle_spots\.json",
                     dockerfile, flags=re.MULTILINE)
    assert "ENV TABERNACLE_SPOTS_PATH=/app/data/tabernacle_spots.json" in dockerfile
