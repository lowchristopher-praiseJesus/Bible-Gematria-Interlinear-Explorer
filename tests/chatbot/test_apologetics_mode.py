import json
from pathlib import Path

import pytest

from chatbot import apologetics_mode, router
from chatbot.apologetics_mode import SHORTS_PATH_ENV, grounding_for, list_tracks, load_manifest, primer

FIXTURE = Path(__file__).parent / "fixtures" / "apologetics" / "manifest.json"


@pytest.fixture(autouse=True)
def _fixture_manifest(monkeypatch):
    monkeypatch.setenv(SHORTS_PATH_ENV, str(FIXTURE))
    load_manifest.cache_clear()
    yield
    load_manifest.cache_clear()


@pytest.fixture
def llm(monkeypatch):
    calls = []
    state = {"reply": {"type": "chat", "message": "See 1 Corinthians 15:3 in 'First Short Title'.", "data": None}}

    async def fake_call(message, research_data, conversation_history=None, page_context=None, system_prompt=None):
        calls.append({"message": message, "research_data": research_data,
                      "history": conversation_history, "system_prompt": system_prompt})
        return dict(state["reply"])

    async def fake_follow_ups(user_message, assistant_message, page_context=None):
        return ["Why does that matter?"]

    monkeypatch.setattr(apologetics_mode, "call_ollama_with_context", fake_call)
    monkeypatch.setattr(apologetics_mode, "generate_llm_follow_ups", fake_follow_ups)
    return type("LLM", (), {"calls": calls, "state": state})


def test_load_manifest_missing_file_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setenv(SHORTS_PATH_ENV, str(tmp_path / "nope.json"))
    load_manifest.cache_clear()
    assert load_manifest() == {}


def test_list_tracks_hides_empty_tracks_and_scripts():
    tracks = list_tracks()
    assert [t["id"] for t in tracks] == ["t1", "t2"]
    t1 = tracks[0]
    assert t1["title"] == "Track One" and t1["blurb"] == "First track."
    assert [s["number"] for s in t1["shorts"]] == [1, 2, 3]
    assert t1["shorts"][2]["youtube_id"] is None  # coming soon, still listed
    assert set(t1["shorts"][0]) == {"number", "title", "youtube_id", "thumbnail", "further_reading"}


def test_primer_returns_track_artifact():
    r = primer({"track_id": "t1"})
    assert r["type"] == "chat"
    assert r["message"] == apologetics_mode.INTRO
    assert r["artifacts"] == [{"type": "apologetics_track", "label": "Track One", "params": {"trackId": "t1"}}]


@pytest.mark.parametrize("params", [{"track_id": "gone"}, {}, None, {"track_id": "empty"}])
def test_primer_unknown_track(params):
    r = primer(params)
    assert r["artifacts"] == []
    assert "isn't available" in r["message"]


async def test_router_dispatches_primer():
    r = await router.build_mode_primer("apologetics", {"track_id": "t1"})
    assert r["artifacts"][0]["type"] == "apologetics_track"


def test_grounding_has_track_shorts_in_full_and_catalogue_for_others():
    g = grounding_for("t1", current_short=1, watched=[1])
    assert "SCRIPT ONE" in g and "SCRIPT TWO" in g
    assert '"First Short Title" [WATCHING NOW]' in g
    assert '"Second Short Title" [not watched yet]' in g
    assert "SCRIPT THREE" not in g  # not uploaded
    assert "fictional characters" in g
    assert "1 Corinthians 15:3–7" in g
    # catalogue: other uploaded shorts, one line each, never their scripts
    assert '"Loose Short Title" (track: none): Loose summary first sentence.' in g
    assert '"Other Track Short" (track: Track Two): Summary four is about morality.' in g
    assert "SCRIPT LOOSE" not in g and "SCRIPT FOUR" not in g
    assert "#1" not in g  # never numbers


def test_grounding_marks_watched():
    g = grounding_for("t1", current_short=2, watched=[1])
    assert '"First Short Title" [watched]' in g
    assert '"Second Short Title" [WATCHING NOW]' in g


def test_grounding_ignores_stale_params():
    g = grounding_for("t1", current_short=999, watched=[999, "x", None])
    assert "WATCHING NOW" not in g and "[watched]" not in g
    assert "SCRIPT ONE" in g


async def test_answer_grounds_links_refs_and_follow_ups(llm):
    r = await apologetics_mode.answer(
        "why?", [{"role": "user", "text": "hi"}],
        {"track_id": "t1", "current_short": 1, "watched_shorts": [1]},
    )
    call = llm.calls[0]
    assert call["research_data"] == grounding_for("t1", 1, [1])
    assert call["system_prompt"] == apologetics_mode.SYSTEM_PROMPT
    assert call["history"] == [{"role": "user", "content": "hi"}]
    assert "/explorer?reference=" in r["message"]
    assert r["follow_up_questions"] == ["Why does that matter?"]
    assert r["data"] is None
    assert r["route"].startswith("apologetics_mode")


async def test_answer_failure_message(llm):
    llm.state["reply"] = {"type": "error", "message": ""}
    r = await apologetics_mode.answer("why?", [], {"track_id": "t1"})
    assert r["message"] == apologetics_mode.FAILURE_MESSAGE


async def test_answer_unknown_track_still_answers_from_catalogue(llm):
    await apologetics_mode.answer("why?", [], {"track_id": "gone"})
    assert '"First Short Title"' in llm.calls[0]["research_data"]


def test_system_prompt_rules():
    p = apologetics_mode.SYSTEM_PROMPT
    for phrase in ("by its title", "never by number", "fictional", "doesn't cover", "Book chapter:verse"):
        assert phrase in p


def test_tracks_endpoint(client):
    res = client.get("/apologetics/tracks")
    assert res.status_code == 200
    body = res.json()
    assert [t["id"] for t in body["tracks"]] == ["t1", "t2"]
    assert "script" not in body["tracks"][0]["shorts"][0]


def test_post_chat_primer(client):
    res = client.post("/chat", json={"message": "", "mode": "apologetics", "mode_params": {"track_id": "t1"}})
    assert res.status_code == 200
    assert res.json()["artifacts"][0]["params"] == {"trackId": "t1"}


def test_post_chat_routes_apologetics(client, monkeypatch):
    import chatbot.api as api_module
    captured = {}

    async def fake_answer(message, history, mode_params):
        captured.update(message=message, mode_params=mode_params)
        return {"type": "chat", "message": "[apol]", "data": None, "route": "a"}

    monkeypatch.setattr(api_module.apologetics_mode, "answer", fake_answer)
    res = client.post("/chat", json={"message": "why?", "mode": "apologetics", "mode_params": {"track_id": "t1"}})
    assert res.json()["message"] == "[apol]"
    assert captured == {"message": "why?", "mode_params": {"track_id": "t1"}}


def test_chat_stream_routes_apologetics(client, monkeypatch):
    import chatbot.api as api_module

    async def fake_answer(message, history, mode_params):
        return {"type": "chat", "message": "[apol]", "data": None, "route": "a"}

    monkeypatch.setattr(api_module.apologetics_mode, "answer", fake_answer)
    res = client.post("/chat/stream", json={"message": "why?", "mode": "apologetics", "mode_params": {"track_id": "t1"}})
    events = [json.loads(c.strip()[len("data: "):]) for c in res.text.strip().split("\n\n")
              if c.strip().startswith("data: ")]
    finals = [e for e in events if e["type"] == "final"]
    assert len(finals) == 1 and finals[0]["result"]["message"] == "[apol]"
