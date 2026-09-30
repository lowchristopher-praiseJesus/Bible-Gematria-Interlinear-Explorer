"""Find passages wiring: mode=passages turns, the primer, and /passages/status."""
import json


def _events(raw):
    return [json.loads(c.strip()[len("data: "):]) for c in raw.strip().split("\n\n") if c.strip().startswith("data: ")]


FAKE = {"type": "chat", "message": "[found]", "data": None, "route": "passages → test", "follow_up_questions": []}


def _fake_search(monkeypatch, captured):
    import chatbot.passage_search as ps

    async def fake(text):
        captured.append(text)
        return dict(FAKE)

    monkeypatch.setattr(ps, "search", fake)


def test_passages_mode_turn_routes_to_search(client, monkeypatch):
    captured = []
    _fake_search(monkeypatch, captured)
    res = client.post("/chat", json={"message": "Where is the rapture?", "mode": "passages", "mode_params": {}})
    assert res.status_code == 200
    assert res.json()["message"] == "[found]"
    assert captured == ["Where is the rapture?"]


def test_passages_mode_stream_routes_to_search(client, monkeypatch):
    captured = []
    _fake_search(monkeypatch, captured)
    res = client.post("/chat/stream", json={"message": "Romans 8:28", "mode": "passages", "mode_params": {}})
    final = next(e for e in _events(res.text) if e["type"] == "final")
    assert final["result"]["message"] == "[found]"
    assert captured == ["Romans 8:28"]


def test_passages_primer(client):
    res = client.post("/chat", json={"message": "", "mode": "passages", "mode_params": {}})
    body = res.json()
    assert "find the relevant passages" in body["message"]
    assert body["follow_up_questions"][0] == "Where is the rapture talked about in the Bible?"


def test_status_reports_availability(client, monkeypatch):
    import chatbot.passage_search as ps
    monkeypatch.setattr(ps, "is_available", lambda: True)
    assert client.get("/passages/status").json() == {"available": True}
    monkeypatch.setattr(ps, "is_available", lambda: False)
    assert client.get("/passages/status").json() == {"available": False}
