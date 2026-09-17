import json

from chatbot import api


def _events(body: str):
    return [
        json.loads(frame[len("data: "):])
        for frame in body.strip().split("\n\n")
        if frame.startswith("data: ")
    ]


def test_stream_emits_phase_events_then_one_final_then_trace(client, monkeypatch):
    async def fake_stream(reference, message, history=None, run_digest=None, scope_chapter=None):
        for i in (1, 2):
            yield {"kind": "phase", "phase": {
                "index": i, "title": f"Phase {i}", "status": "done", "markdown": "text",
            }}
        yield {"kind": "final", "result": {
            "type": "chat", "message": "report", "data": None, "route": "hermeneutics → 2 phases",
        }}

    monkeypatch.setattr(api.hermeneutics, "stream", fake_stream)
    response = client.post("/chat/stream", json={
        "message": "run it", "mode": "hermeneutics", "mode_params": {"reference": "ROM 8:1"},
    })
    events = _events(response.text)
    types = [e["type"] for e in events]
    assert types.count("final") == 1, "exactly one final event"
    assert types.index("final") > max(i for i, t in enumerate(types) if t == "phase")
    assert types[-1] == "trace"
    phases = [e for e in events if e["type"] == "phase"]
    assert [p["phase"]["index"] for p in phases] == [1, 2]


def test_stream_phase_event_carries_the_full_phase_payload(client, monkeypatch):
    async def fake_stream(reference, message, history=None, run_digest=None, scope_chapter=None):
        yield {"kind": "phase", "phase": {
            "index": 4, "title": "Witnesses", "status": "done", "markdown": "m",
            "citations": [{"reference": "1CO 15:51-52", "text": "t", "verified": True}],
        }}
        yield {"kind": "final", "result": {
            "type": "chat", "message": "report", "data": None, "route": "r",
        }}

    monkeypatch.setattr(api.hermeneutics, "stream", fake_stream)
    response = client.post("/chat/stream", json={
        "message": "run it", "mode": "hermeneutics", "mode_params": {"reference": "ROM 8:1"},
    })
    phase = next(e for e in _events(response.text) if e["type"] == "phase")
    assert phase["phase"]["citations"][0]["reference"] == "1CO 15:51-52"


def test_stream_sends_keepalives_while_a_phase_is_slow(client, monkeypatch):
    # The Flask proxy (180s) and nginx (300s) drop a silent connection; a
    # phase on a slow hosted model can be silent for longer than that.
    import asyncio

    async def slow_stream(reference, message, history=None, run_digest=None, scope_chapter=None):
        await asyncio.sleep(0.25)
        yield {"kind": "phase", "phase": {
            "index": 1, "title": "Phase 1", "status": "done", "markdown": "text",
        }}
        yield {"kind": "final", "result": {
            "type": "chat", "message": "report", "data": None, "route": "hermeneutics",
        }}

    monkeypatch.setattr(api.hermeneutics, "stream", slow_stream)
    monkeypatch.setattr(api, "HERMENEUTICS_KEEPALIVE_SECONDS", 0.05)
    response = client.post("/chat/stream", json={
        "message": "run it", "mode": "hermeneutics", "mode_params": {"reference": "ROM 8:1"},
    })
    frames = response.text.strip().split("\n\n")
    assert any(f.startswith(":") for f in frames[:frames.index(next(f for f in frames if '"phase"' in f))])
    types = [e["type"] for e in _events(response.text)]
    assert types == ["phase", "final", "trace"]


def test_stream_passes_the_narrowed_chapter_through(client, monkeypatch):
    seen = {}

    async def fake_stream(reference, message, history=None, run_digest=None, scope_chapter=None):
        seen["scope_chapter"] = scope_chapter
        yield {"kind": "final", "result": {"type": "chat", "message": "ok", "data": None, "route": "h"}}

    monkeypatch.setattr(api.hermeneutics, "stream", fake_stream)
    client.post("/chat/stream", json={
        "message": "verses 1-5", "mode": "hermeneutics", "mode_params": {"scope_chapter": "GEN 1"},
    })
    assert seen["scope_chapter"] == "GEN 1"

