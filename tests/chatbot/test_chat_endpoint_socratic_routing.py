"""A free-text message in a Socratic Study session always routes to
chatbot.socratic.answer() rather than the generic deterministic/Ollama
fallback used by most modes — every turn (not just the primer) needs the
Socratic persona and passage grounding."""

import json


def _events(raw: str):
    out = []
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if not line.startswith("data: "):
            continue
        out.append(json.loads(line[len("data: "):]))
    return out


def test_chat_in_socratic_mode_routes_to_socratic_answer(client, monkeypatch):
    import chatbot.api as api_module

    captured = {}

    async def fake_socratic_answer(reference, message, conversation_history=None):
        captured["reference"] = reference
        captured["message"] = message
        return {
            "type": "chat",
            "message": "[socratic answered]",
            "data": {"reference": reference},
            "route": "socratic → test",
        }

    monkeypatch.setattr(api_module.socratic, "answer", fake_socratic_answer)

    res = client.post(
        "/chat",
        json={
            "message": "why does it start this way?",
            "mode": "socratic",
            "mode_params": {"reference": "JHN 3:16"},
        },
    )
    assert res.status_code == 200
    assert res.json()["message"] == "[socratic answered]"
    assert captured["reference"] == "JHN 3:16"
    assert captured["message"] == "why does it start this way?"


def test_chat_stream_in_socratic_mode_routes_to_socratic_answer(client, monkeypatch):
    import chatbot.api as api_module

    async def fake_socratic_answer(reference, message, conversation_history=None):
        return {
            "type": "chat",
            "message": "[socratic answered]",
            "data": {"reference": reference},
            "route": "socratic → test",
        }

    monkeypatch.setattr(api_module.socratic, "answer", fake_socratic_answer)

    res = client.post(
        "/chat/stream",
        json={
            "message": "why does it start this way?",
            "mode": "socratic",
            "mode_params": {"reference": "JHN 3:16"},
        },
    )
    assert res.status_code == 200
    events = _events(res.text)
    final = next(e for e in events if e["type"] == "final")
    assert final["result"]["message"] == "[socratic answered]"
