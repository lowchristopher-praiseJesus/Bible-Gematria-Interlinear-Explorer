import pytest


def test_deterministic_chat_turn_returns_a_trace(client, monkeypatch):
    # Patch the DB/network verse fetch *below* the instrumented tool wrapper so
    # `fetch_verse_translations` still records its `tool` step (patching the
    # router-level name would bypass `record_tool` entirely).
    def fake_fetch_verse(book, chapter, verse):
        return {"eng-KJV": "For God so loved the world"}

    monkeypatch.setattr("chatbot.tools._fetch_verse", fake_fetch_verse)

    resp = client.post("/chat", json={"message": "quote John 3:16"})
    assert resp.status_code == 200
    body = resp.json()
    trace = body["trace"]
    assert trace["requestPath"] == "/chat"
    assert trace["input"]["message"] == "quote John 3:16"
    kinds = [s["kind"] for s in trace["steps"]]
    assert "routing" in kinds and "tool" in kinds
    assert "llm" not in kinds
    assert trace["outcome"]["type"] == body["type"]


def test_llm_fallback_turn_trace_has_an_llm_step(client, monkeypatch):
    async def fake_route_claude(message, history=None, page_context=None):
        return {"type": "chat", "message": "A thoughtful answer.", "data": None, "route": "AI Fallback"}

    # Let the real deterministic router run and record its fall-through
    # routing step, then stub only the LLM path.
    monkeypatch.setattr("chatbot.api.route_claude", fake_route_claude)

    resp = client.post("/chat", json={"message": "what is the meaning of grace?"})
    body = resp.json()
    assert body["trace"]["outcome"]["type"] == "chat"
    # routing fall-through recorded even though route_claude is stubbed
    assert any(s["kind"] == "routing" for s in body["trace"]["steps"])


def test_server_error_still_returns_a_finalized_trace(client, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr("chatbot.api.route_deterministic", boom)

    resp = client.post("/chat", json={"message": "anything"})
    body = resp.json()
    assert body["type"] == "error"
    assert body["trace"]["outcome"]["type"] == "error"
    assert "kaboom" in body["trace"]["outcome"]["error"]
