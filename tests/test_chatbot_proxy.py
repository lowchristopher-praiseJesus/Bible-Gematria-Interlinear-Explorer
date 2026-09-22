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


def test_proxy_forwards_content_length_for_an_uncompressed_response(client, monkeypatch):
    # Regression test: the proxy used to strip Content-Length from every
    # response (needed for /chat/stream's SSE body, which never has one
    # upstream), forcing even small, complete, uncompressed bodies like a
    # generated devotional's MP3 into Transfer-Encoding: chunked. Browsers
    # (mobile ones especially) can then read an <audio> element's `duration`
    # as Infinity instead of the real value, breaking anything computed from
    # it (e.g. the Listen overlay's playback-position scroll sync).
    upstream = FakeUpstreamResponse(
        200, [b"id3-mp3-bytes"], headers={"Content-Type": "audio/mpeg", "Content-Length": "13"}
    )
    monkeypatch.setattr(myproject.requests, "request", lambda *a, **k: upstream)

    resp = client.get("/api/bible-chat/devotional-audio/abc.mp3")

    assert resp.headers.get("Content-Length") == "13"


def test_proxy_drops_content_length_for_a_compressed_response(client, monkeypatch):
    # A Content-Encoding response has its Content-Length forwarded from
    # requests's iter_content(), which transparently decompresses the body -
    # so the original (compressed) Content-Length would no longer match the
    # bytes actually sent and must still be dropped.
    upstream = FakeUpstreamResponse(
        200,
        [b"decompressed-bytes"],
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": "9999"},
    )
    monkeypatch.setattr(myproject.requests, "request", lambda *a, **k: upstream)

    resp = client.get("/api/bible-chat/parables")

    assert "Content-Length" not in resp.headers
    assert "Content-Encoding" not in resp.headers


def test_proxy_still_returns_503_on_a_connection_error(client, monkeypatch):
    import requests as requests_module

    def raise_connection_error(*a, **k):
        raise requests_module.exceptions.ConnectionError("boom")

    monkeypatch.setattr(myproject.requests, "request", raise_connection_error)

    resp = client.get("/api/bible-chat/parables")

    assert resp.status_code == 503
    assert resp.get_json()["error"].startswith("Chatbot service unavailable")


def test_proxy_returns_504_instead_of_crashing_on_a_read_timeout(client, monkeypatch):
    # Regression test: a slow LLM turn (e.g. Chat with a Character's
    # greeting) can take close to the chatbot's own internal LLM-call
    # timeout. The proxy's `requests.request(..., timeout=180)` read
    # timeout used to fire around the same moment and wasn't caught —
    # only ConnectionError was — so it reached the client as an unhandled
    # 500 with a raw traceback instead of a clean error.
    import requests as requests_module

    def raise_read_timeout(*a, **k):
        raise requests_module.exceptions.ReadTimeout("boom")

    monkeypatch.setattr(myproject.requests, "request", raise_read_timeout)

    resp = client.post("/api/bible-chat/chat", json={"message": "", "mode": "character"})

    assert resp.status_code == 504
    assert "timed out" in resp.get_json()["error"].lower()
