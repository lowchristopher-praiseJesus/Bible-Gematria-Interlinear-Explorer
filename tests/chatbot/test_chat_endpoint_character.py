"""'Chat with a Character' mode: the GET /characters list, and every turn of a
mode=character session routing to chatbot.character_chat instead of the
generic deterministic/LLM-fallback path."""

import json


def _events(raw: str):
    out = []
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if not line.startswith("data: "):
            continue
        out.append(json.loads(line[len("data: "):]))
    return out


def test_get_characters_lists_the_profiles_without_jesus(client):
    res = client.get("/characters")
    assert res.status_code == 200
    characters = res.json()["characters"]
    by_id = {c["id"]: c for c in characters}
    assert len(characters) == 49
    assert "jesus" not in by_id
    assert by_id["david"] == {
        "id": "david",
        "name": "David",
        "testament": "OT",
        "summary": by_id["david"]["summary"],
    }
    assert by_id["david"]["summary"].startswith("The shepherd boy")
    assert by_id["peter"]["testament"] == "NT"


def test_chat_in_character_mode_routes_to_character_answer(client, monkeypatch):
    import chatbot.api as api_module

    captured = {}

    async def fake_answer(character_id, message, conversation_history=None):
        captured["character_id"] = character_id
        captured["message"] = message
        captured["history"] = conversation_history
        return {"type": "chat", "message": "[david answered]", "data": None, "route": "character_chat → test"}

    monkeypatch.setattr(api_module.character_chat, "answer", fake_answer)

    res = client.post(
        "/chat",
        json={
            "message": "Who was Goliath?",
            "mode": "character",
            "mode_params": {"character_id": "david"},
            "history": [{"role": "assistant", "text": "Peace."}],
        },
    )
    assert res.status_code == 200
    assert res.json()["message"] == "[david answered]"
    assert captured == {
        "character_id": "david",
        "message": "Who was Goliath?",
        "history": [{"role": "assistant", "text": "Peace."}],
    }


def test_chat_stream_in_character_mode_routes_to_character_answer(client, monkeypatch):
    import chatbot.api as api_module

    async def fake_answer(character_id, message, conversation_history=None):
        return {"type": "chat", "message": f"[{character_id} answered]", "data": None, "route": "character_chat → test"}

    monkeypatch.setattr(api_module.character_chat, "answer", fake_answer)

    res = client.post(
        "/chat/stream",
        json={"message": "Who was Goliath?", "mode": "character", "mode_params": {"character_id": "david"}},
    )
    assert res.status_code == 200
    final = next(e for e in _events(res.text) if e["type"] == "final")
    assert final["result"]["message"] == "[david answered]"


def test_character_mode_without_a_character_id_is_an_error_not_a_generic_answer(client):
    res = client.post("/chat", json={"message": "hello", "mode": "character", "mode_params": {}})
    assert res.status_code == 200
    assert res.json()["type"] == "error"


def test_empty_message_in_character_mode_returns_the_greeting_primer(client, monkeypatch):
    import chatbot.router as router_module

    async def fake_greeting(character_id):
        return {"type": "chat", "message": f"[greeting from {character_id}]", "data": None, "route": "Mode primer → character"}

    monkeypatch.setattr(router_module.character_chat, "greeting", fake_greeting)

    res = client.post("/chat", json={"message": "", "mode": "character", "mode_params": {"character_id": "ruth"}})
    assert res.status_code == 200
    assert res.json()["message"] == "[greeting from ruth]"
