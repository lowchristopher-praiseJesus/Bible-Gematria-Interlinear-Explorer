# tests/test_chatbot_proxy.py
"""Regression coverage for the /api/bible-chat/* proxy's streaming behavior.

Guards against a real bug: the proxy used to call `requests.request(...)`
without `stream=True` and return `resp.content`, which fully buffers the
upstream response before Flask sends a single byte to the client. That
silently defeated /chat/stream's SSE streaming — every token the chatbot
streamed still arrived at the browser in one burst, only once the whole
answer had finished generating.
"""
import types

import pytest

import myproject


class FakeUpstreamResponse:
    """Stands in for `requests.request(..., stream=True)`'s return value.

    Deliberately has no `.content` attribute — a proxy implementation that
    regresses to reading `resp.content` (instead of iterating
    `resp.iter_content()`) fails with an AttributeError here rather than
    silently passing.
    """

    def __init__(self, status_code, chunks, headers=None):
        self.status_code = status_code
        self._chunks = chunks
        self.raw = types.SimpleNamespace(headers=headers or {})
        self.closed = False

    def iter_content(self, chunk_size=None):
        return iter(self._chunks)

    def close(self):
        self.closed = True


@pytest.fixture
def client():
    myproject.app.config.update(TESTING=True)
    return myproject.app.test_client()


def test_proxy_requests_a_streaming_response_from_the_chatbot(client, monkeypatch):
    captured = {}

    def fake_request(method, url, **kwargs):
        captured.update(kwargs)
        captured["method"] = method
        captured["url"] = url
        return FakeUpstreamResponse(200, [b"data: one\n\n", b"data: two\n\n"])

    monkeypatch.setattr(myproject.requests, "request", fake_request)

    resp = client.post("/api/bible-chat/chat/stream", json={"message": "hi"})

    assert resp.status_code == 200
    assert captured["stream"] is True
    assert captured["url"] == "http://localhost:8020/chat/stream"


def test_proxy_forwards_every_chunk_and_closes_the_upstream_connection(client, monkeypatch):
    upstream = FakeUpstreamResponse(200, [b"data: one\n\n", b"data: two\n\n", b"data: three\n\n"])
    monkeypatch.setattr(myproject.requests, "request", lambda *a, **k: upstream)

    resp = client.post("/api/bible-chat/chat/stream", json={"message": "hi"})

    assert resp.data == b"data: one\n\ndata: two\n\ndata: three\n\n"
    # The generator's `finally: resp.close()` ran once the body was fully
    # consumed, releasing the upstream connection back to the pool.
    assert upstream.closed is True


def test_proxy_still_returns_503_on_a_connection_error(client, monkeypatch):
    import requests as requests_module

    def raise_connection_error(*a, **k):
        raise requests_module.exceptions.ConnectionError("boom")

    monkeypatch.setattr(myproject.requests, "request", raise_connection_error)

    resp = client.get("/api/bible-chat/parables")

    assert resp.status_code == 503
    assert resp.get_json()["error"].startswith("Chatbot service unavailable")
