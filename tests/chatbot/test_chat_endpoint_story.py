"""Tell a Story mode: every turn is an empty-message call, so router.py's
generic empty-message check in chatbot/api.py dispatches both the
theme-derivation primer and the "Make my story"/"Try again" submission to
story_mode.build_primer — unlike character/hermeneutics mode, api.py needs
no dedicated mode=="story" branch. See
docs/superpowers/specs/2026-09-23-tell-a-story-mode-design.md."""

import json


def _events(raw: str):
    out = []
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if not line.startswith("data: "):
            continue
        out.append(json.loads(line[len("data: "):]))
    return out


def test_chat_with_empty_message_and_no_themes_yet_derives_them(client, monkeypatch):
    import chatbot.router as router_module

    async def fake_build_primer(mode_params):
        assert mode_params == {"source_messages": [{"role": "user", "text": "hi"}]}
        return {
            "type": "chat", "message": "[themes derived]",
            "data": {"themes": [{"id": "t1", "label": "Trust", "description": ""}], "digest": "d"},
            "route": "test",
        }

    monkeypatch.setattr(router_module.story_mode, "build_primer", fake_build_primer)

    res = client.post("/chat", json={
        "message": "",
        "mode": "story",
        "mode_params": {"source_messages": [{"role": "user", "text": "hi"}]},
    })
    assert res.status_code == 200
    assert res.json()["message"] == "[themes derived]"
    assert res.json()["data"]["themes"][0]["label"] == "Trust"


def test_chat_stream_with_empty_message_dispatches_to_story_build_primer(client, monkeypatch):
    import chatbot.router as router_module

    async def fake_build_primer(mode_params):
        return {
            "type": "chat", "message": "[story generated]", "data": None, "route": "test",
            "artifacts": [{
                "type": "story", "label": "Read the story ▸",
                "params": {"title": "T", "themes": ["Trust"], "age_range": "3-6", "text": "...", "word_count": 650},
            }],
        }

    monkeypatch.setattr(router_module.story_mode, "build_primer", fake_build_primer)

    res = client.post("/chat/stream", json={
        "message": "",
        "mode": "story",
        "mode_params": {"story_selected_theme_ids": ["t1"]},
    })
    assert res.status_code == 200
    final = next(e for e in _events(res.text) if e["type"] == "final")
    assert final["result"]["artifacts"][0]["type"] == "story"


def test_empty_message_story_mode_with_no_mode_params_key_does_not_500(client):
    # ChatRequest.mode_params is Optional and defaults to None — a request
    # that omits the key entirely must not 500 (see story_mode.build_primer's
    # own mode_params=None guard).
    res = client.post("/chat", json={"message": "", "mode": "story"})
    assert res.status_code == 200
    assert res.json()["type"] == "chat"


def test_a_non_empty_message_in_story_mode_still_reaches_build_mode_primer(client, monkeypatch):
    # Tell a Story never sends a non-empty message in this plan, but the
    # mode should not silently fall through to the generic AI-fallback
    # path if it ever did — build_mode_primer is only reached for an
    # EMPTY message, so this documents (and locks in) that a stray
    # non-empty "story" message currently falls through to the
    # deterministic/AI-fallback path like any unhandled mode, rather than
    # erroring.
    res = client.post("/chat", json={"message": "hello", "mode": "story", "mode_params": {}})
    assert res.status_code == 200
