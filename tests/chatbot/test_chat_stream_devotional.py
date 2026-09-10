import json


def _events(raw: str):
    out = []
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if line.startswith("data: "):
            out.append(json.loads(line[len("data: "):]))
    return out


def _patch_stream_devotional(monkeypatch, gen):
    # api.py imports stream_devotional lazily inside the branch, so patch the
    # source module.
    import chatbot.devotional as devo
    monkeypatch.setattr(devo, "stream_devotional", gen)


def test_devotional_stream_emits_verse_final_with_artifact(client, monkeypatch):
    async def fake_stream(raw, source, page_context=None, rotation=None):
        assert raw == "peace"
        assert source == "user"
        yield {"type": "stream", "chunk": "Some morning "}
        yield {"type": "stream", "chunk": "you wake..."}
        yield {"type": "done", "text": "Some morning you wake...",
               "reference": "JHN 14:27", "translations": {"eng-KJV": "Peace I leave..."}}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "peace", "mode": "devotional", "mode_params": {"source": "user"},
    })
    assert resp.status_code == 200
    events = _events(resp.text)

    assert any(e["type"] == "stream" for e in events)
    final = next(e for e in events if e["type"] == "final")["result"]
    assert final["type"] == "verse"
    assert final["message"] == "Here's a devotional on **JHN 14:27**."
    assert final["data"]["reference"] == "JHN 14:27"
    assert final["data"]["devotional"] == "Some morning you wake..."
    assert final["data"]["translations"] == {"eng-KJV": "Peace I leave..."}
    assert final["artifacts"] == [{
        "type": "devotional",
        "label": "Read the devotional ▸",
        "params": {"reference": "JHN 14:27", "text": "Some morning you wake..."},
    }]
    assert "follow_up_questions" not in final or final["follow_up_questions"] in ([], None)
    assert events[-1]["type"] == "trace"


def test_devotional_stream_empty_message_system_source_still_generates(client, monkeypatch):
    async def fake_stream(raw, source, page_context=None, rotation=None):
        assert raw is None
        assert source == "system"
        yield {"type": "done", "text": "A devotional.", "reference": "ROM 8:28",
               "translations": {"eng-KJV": "..."}}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "", "mode": "devotional", "mode_params": {"source": "system"},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["type"] == "verse"
    assert final["data"]["reference"] == "ROM 8:28"


def test_devotional_stream_devotional_error_becomes_error_result(client, monkeypatch):
    import chatbot.devotional as devo

    async def fake_stream(raw, source, page_context=None, rotation=None):
        raise devo.DevotionalError("no text")
        yield  # noqa: unreachable — makes this an async generator

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "Nonexistent 9:9", "mode": "devotional", "mode_params": {"source": "user"},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["type"] == "error"
    assert "try another verse or a theme" in final["message"].lower()


def test_devotional_stream_llm_error_becomes_error_result(client, monkeypatch):
    async def fake_stream(raw, source, page_context=None, rotation=None):
        yield {"type": "error", "message": "LLM API error: boom"}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "peace", "mode": "devotional", "mode_params": {"source": "user"},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["type"] == "error"
    assert "boom" in final["message"]


def test_rotation_params_reach_stream_devotional(client, monkeypatch):
    seen = {}

    async def fake_stream(raw, source, page_context=None, rotation=None):
        seen["raw"] = raw
        seen["source"] = source
        seen["rotation"] = rotation
        yield {"type": "done", "text": "d", "reference": "PSA 100:4",
               "translations": {"eng-KJV": "Enter into his gates"}}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "",
        "mode": "devotional",
        "mode_params": {"source": "system", "rotation_seed": 555, "rotation_cursor": 4},
    })
    assert resp.status_code == 200
    assert seen["rotation"] == (555, 4)


def test_missing_rotation_params_pass_none(client, monkeypatch):
    seen = {}

    async def fake_stream(raw, source, page_context=None, rotation=None):
        seen["rotation"] = rotation
        yield {"type": "done", "text": "d", "reference": "PSA 100:4",
               "translations": {"eng-KJV": "Enter into his gates"}}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "", "mode": "devotional", "mode_params": {"source": "system"},
    })
    assert resp.status_code == 200
    assert seen["rotation"] is None


def test_devotional_stream_delivered_true_falls_through_to_normal_routing(client, monkeypatch):
    # After delivery, a follow-up must NOT re-enter the devotional branch —
    # it routes like any freeform message. A bare verse ref → deterministic
    # verse response.
    def fake_fetch_verse(book, chapter, verse):
        return {"eng-KJV": "Jesus wept."}

    monkeypatch.setattr("chatbot.tools._fetch_verse", fake_fetch_verse)

    resp = client.post("/chat/stream", json={
        "message": "quote John 11:35", "mode": "devotional",
        "mode_params": {"source": "user", "delivered": True},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["type"] == "verse"
    assert "11:35" in final["data"]["reference"]
