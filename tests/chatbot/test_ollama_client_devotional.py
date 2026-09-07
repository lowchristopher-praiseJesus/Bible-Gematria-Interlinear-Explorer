import pytest

from chatbot import ollama_client


@pytest.fixture(autouse=True)
def _local_ollama_provider(monkeypatch):
    """Pin the provider to a locally-configured Ollama instance for every test
    in this file, regardless of what LLM_PROVIDER/*_API_KEY happen to be set to
    in the real environment (local dev loads an nvidia key from .env). Matches
    the guard in test_llm_follow_ups.py."""
    monkeypatch.setattr(ollama_client, "LLM_PROVIDER", "ollama")
    monkeypatch.setattr(ollama_client, "OLLAMA_API_URL", "http://localhost:11434")
    monkeypatch.setattr(ollama_client, "OLLAMA_API_KEY", None)


def test_build_request_default_max_tokens_is_2048():
    _p, _u, _h, payload = ollama_client._build_request(
        [{"role": "user", "content": "hi"}], stream=False
    )
    # ollama nests sampling params under "options"; nvidia puts them top-level
    got = payload.get("options", payload).get("max_tokens")
    assert got == 2048


def test_build_request_accepts_max_tokens_override():
    _p, _u, _h, payload = ollama_client._build_request(
        [{"role": "user", "content": "hi"}], stream=True, max_tokens=3600
    )
    got = payload.get("options", payload).get("max_tokens")
    assert got == 3600


@pytest.mark.asyncio
async def test_simple_completion_returns_text(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: None)

    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {"message": {"content": "John 14:27"}}

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return FakeResp()

    monkeypatch.setattr(ollama_client.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    out = await ollama_client.simple_completion("sys", "user", max_tokens=64)
    assert out == "John 14:27"


@pytest.mark.asyncio
async def test_simple_completion_swallows_errors(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: None)

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): raise ollama_client.httpx.HTTPError("boom")

    monkeypatch.setattr(ollama_client.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    assert await ollama_client.simple_completion("sys", "user") == ""


@pytest.mark.asyncio
async def test_simple_completion_empty_when_unconfigured(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: "no key")
    assert await ollama_client.simple_completion("sys", "user") == ""


@pytest.mark.asyncio
async def test_stream_devotional_completion_yields_chunks_then_done(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: None)

    class FakeStreamResp:
        def raise_for_status(self): pass
        async def aiter_lines(self):
            import json as _j
            yield _j.dumps({"message": {"content": "Peace "}})
            yield _j.dumps({"message": {"content": "I leave"}})
            yield _j.dumps({"done": True})

    class FakeStreamCtx:
        async def __aenter__(self): return FakeStreamResp()
        async def __aexit__(self, *a): return False

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        def stream(self, *a, **k): return FakeStreamCtx()

    monkeypatch.setattr(ollama_client.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    events = [e async for e in ollama_client.stream_devotional_completion("sys", "user")]
    assert [e["type"] for e in events] == ["stream", "stream", "done"]
    assert "".join(e["chunk"] for e in events if e["type"] == "stream") == "Peace I leave"


@pytest.mark.asyncio
async def test_stream_devotional_completion_emits_error_when_unconfigured(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: "no key")
    events = [e async for e in ollama_client.stream_devotional_completion("s", "u")]
    assert events == [{"type": "error", "message": "no key"}]
