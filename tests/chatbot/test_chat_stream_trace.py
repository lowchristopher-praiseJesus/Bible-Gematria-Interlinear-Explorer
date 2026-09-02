import json


def _events(raw: str):
    """Parse the SSE body into the list of chat events.

    `sse_stream` wraps every string `_stream_chat_response` yields in an outer
    ``data: {"chunk": <str>, "done": <bool>}`` frame, so each real chat event
    (`deterministic`, `stream`, `done`, `error`, `trace`) arrives as the
    ``chunk`` payload of an outer frame — itself a ``data: {...}`` line. Unwrap
    both layers here so assertions can read the inner event directly, the same
    two-step parse the browser SSE reader performs.
    """
    out = []
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if not line.startswith("data: "):
            continue
        outer = json.loads(line[len("data: "):])
        inner = outer.get("chunk", "") if isinstance(outer, dict) else ""
        if isinstance(inner, str) and inner.startswith("data: "):
            out.append(json.loads(inner[len("data: "):].strip()))
        elif isinstance(outer, dict) and "type" in outer:
            out.append(outer)
    return out


def test_stream_ends_with_a_trace_event_for_a_deterministic_turn(client, monkeypatch):
    # Patch the DB/network verse fetch *below* the instrumented tool wrapper so
    # `fetch_verse_translations` still records its `tool` step (patching the
    # router-level name would bypass `record_tool` entirely).
    def fake_fetch_verse(book, chapter, verse):
        return {"eng-KJV": "Jesus wept."}

    monkeypatch.setattr("chatbot.tools._fetch_verse", fake_fetch_verse)

    resp = client.post("/chat/stream", json={"message": "quote John 11:35"})
    assert resp.status_code == 200
    events = _events(resp.text)
    assert events[-1]["type"] == "trace"
    trace = events[-1]["trace"]
    assert trace["requestPath"] == "/chat/stream"
    assert any(s["kind"] == "routing" for s in trace["steps"])
    assert any(s["kind"] == "tool" for s in trace["steps"])
