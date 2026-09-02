"""Provider-switch coverage for chatbot.ollama_client.

The module keeps its Ollama-era name; LLM_PROVIDER=nvidia flips it to the
OpenAI-compatible NVIDIA NIM wire format.
"""

import httpx
import pytest

from chatbot import ollama_client as oc


def _set_provider(monkeypatch, provider, **overrides):
    values = {
        "LLM_PROVIDER": provider,
        "NVIDIA_API_URL": "https://integrate.api.nvidia.com/v1",
        "NVIDIA_MODEL": "meta/llama-3.3-70b-instruct",
        "NVIDIA_API_KEY": "nvapi-test",
        "OLLAMA_API_URL": "http://localhost:11434",
        "OLLAMA_MODEL": "deepseek-v4-pro:cloud",
        "OLLAMA_API_KEY": None,
    }
    values.update(overrides)
    for name, value in values.items():
        monkeypatch.setattr(oc, name, value)


# --- request shaping --------------------------------------------------------

def test_build_request_nvidia_is_openai_compatible(monkeypatch):
    _set_provider(monkeypatch, "nvidia")
    provider, url, headers, payload = oc._build_request(
        [{"role": "user", "content": "hi"}], stream=False
    )
    assert provider == "nvidia"
    assert url == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert headers["Authorization"] == "Bearer nvapi-test"
    assert payload["model"] == "meta/llama-3.3-70b-instruct"
    assert payload["temperature"] == 0.7
    assert payload["max_tokens"] == 2048
    assert "options" not in payload  # top-level, not nested like Ollama


def test_build_request_ollama_is_native(monkeypatch):
    _set_provider(monkeypatch, "ollama")
    provider, url, headers, payload = oc._build_request(
        [{"role": "user", "content": "hi"}], stream=True
    )
    assert provider == "ollama"
    assert url == "http://localhost:11434/api/chat"
    assert "Authorization" not in headers
    assert payload["options"] == {"temperature": 0.7, "max_tokens": 2048}
    assert payload["stream"] is True


# --- configuration guard --------------------------------------------------------

def test_llm_unconfigured_error_nvidia_needs_key(monkeypatch):
    _set_provider(monkeypatch, "nvidia", NVIDIA_API_KEY=None)
    assert "NVIDIA_API_KEY" in oc.llm_unconfigured_error()
    _set_provider(monkeypatch, "nvidia", NVIDIA_API_KEY="nvapi-test")
    assert oc.llm_unconfigured_error() is None


def test_llm_unconfigured_error_local_ollama_needs_no_key(monkeypatch):
    _set_provider(monkeypatch, "ollama")
    assert oc.llm_unconfigured_error() is None


def test_active_model_label(monkeypatch):
    _set_provider(monkeypatch, "nvidia")
    assert oc.active_model_label() == "NVIDIA (meta/llama-3.3-70b-instruct)"


# --- response / stream parsing --------------------------------------------------------

def test_extract_content_nvidia():
    body = {"choices": [{"message": {"content": "Hello there"}}]}
    assert oc._extract_content("nvidia", body) == ("Hello there", None)

    content, error = oc._extract_content("nvidia", {"detail": "invalid model"})
    assert content == ""
    assert error == "invalid model"


def test_stream_delta_nvidia_sse():
    assert oc._stream_delta(
        "nvidia", 'data: {"choices":[{"delta":{"content":"Hi"}}]}'
    ) == ("chunk", "Hi")
    assert oc._stream_delta("nvidia", "data: [DONE]") == ("done", None)
    assert oc._stream_delta("nvidia", ": keep-alive") is None
    assert oc._stream_delta("nvidia", "") is None
    assert oc._stream_delta(
        "nvidia", 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'
    ) == ("done", None)


@pytest.mark.asyncio
async def test_stream_chat_with_ollama_parses_nvidia_sse(monkeypatch):
    _set_provider(monkeypatch, "nvidia")

    async def fake_research(*_a, **_k):
        return ""

    monkeypatch.setattr(oc, "_fetch_research_data", fake_research)

    sse_body = (
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n'
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request):
        assert str(request.url) == "https://integrate.api.nvidia.com/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer nvapi-test"
        return httpx.Response(200, text=sse_body)

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(oc.httpx, "AsyncClient", client_factory)

    events = [event async for event in oc.stream_chat_with_ollama("hi")]
    chunks = [e["chunk"] for e in events if e["type"] == "stream"]
    assert "".join(chunks) == "Hello world"
    assert events[-1]["type"] == "done"
    assert not any(e["type"] == "error" for e in events)


@pytest.mark.asyncio
async def test_call_ollama_with_context_parses_nvidia_response(monkeypatch):
    _set_provider(monkeypatch, "nvidia")

    def handler(request):
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "42"}}]}
        )

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(oc.httpx, "AsyncClient", client_factory)

    result = await oc.call_ollama_with_context("q", research_data="")
    assert result["type"] == "chat"
    assert result["message"] == "42"
    assert "NVIDIA (meta/llama-3.3-70b-instruct)" in result["route"]
