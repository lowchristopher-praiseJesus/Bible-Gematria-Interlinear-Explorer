"""Provider-switch coverage for chatbot.ollama_client.

LLM_PROVIDER=openrouter flips it to OpenRouter's OpenAI-compatible wire
format (https://openrouter.ai/api/v1/chat/completions) — the same shape
NVIDIA NIM already uses, so it shares that request/response code path.
"""

import httpx
import pytest

from chatbot import ollama_client as oc


def _set_provider(monkeypatch, provider, **overrides):
    values = {
        "LLM_PROVIDER": provider,
        "OPENROUTER_API_URL": "https://openrouter.ai/api/v1",
        "OPENROUTER_MODEL": "qwen/qwen3.8-27b:free",
        "OPENROUTER_API_KEY": "sk-or-test",
        "OLLAMA_API_URL": "http://localhost:11434",
        "OLLAMA_MODEL": "deepseek-v4-pro:cloud",
        "OLLAMA_API_KEY": None,
    }
    values.update(overrides)
    for name, value in values.items():
        monkeypatch.setattr(oc, name, value)


def test_build_request_openrouter_is_openai_compatible(monkeypatch):
    _set_provider(monkeypatch, "openrouter")
    provider, url, headers, payload = oc._build_request(
        [{"role": "user", "content": "hi"}], stream=False
    )
    assert provider == "openrouter"
    assert url == "https://openrouter.ai/api/v1/chat/completions"
    assert headers["Authorization"] == "Bearer sk-or-test"
    assert payload["model"] == "qwen/qwen3.8-27b:free"
    assert payload["temperature"] == 0.7
    assert payload["max_tokens"] == 2048
    assert "options" not in payload


def test_llm_unconfigured_error_openrouter_needs_key(monkeypatch):
    _set_provider(monkeypatch, "openrouter", OPENROUTER_API_KEY=None)
    assert "OPENROUTER_API_KEY" in oc.llm_unconfigured_error()
    _set_provider(monkeypatch, "openrouter", OPENROUTER_API_KEY="sk-or-test")
    assert oc.llm_unconfigured_error() is None


def test_active_model_label_openrouter(monkeypatch):
    _set_provider(monkeypatch, "openrouter")
    assert oc.active_model_label() == "OpenRouter (qwen/qwen3.8-27b:free)"


def test_extract_content_openrouter():
    body = {"choices": [{"message": {"content": "Hello there"}}]}
    assert oc._extract_content("openrouter", body) == ("Hello there", None)


def test_stream_delta_openrouter_sse():
    assert oc._stream_delta(
        "openrouter", 'data: {"choices":[{"delta":{"content":"Hi"}}]}'
    ) == ("chunk", "Hi")
    assert oc._stream_delta("openrouter", "data: [DONE]") == ("done", None)


@pytest.mark.asyncio
async def test_call_ollama_with_context_parses_openrouter_response(monkeypatch):
    _set_provider(monkeypatch, "openrouter")

    def handler(request):
        assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer sk-or-test"
        return httpx.Response(200, json={"choices": [{"message": {"content": "42"}}]})

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(oc.httpx, "AsyncClient", client_factory)

    result = await oc.call_ollama_with_context("q", research_data="")
    assert result["type"] == "chat"
    assert result["message"] == "42"
    assert "OpenRouter (qwen/qwen3.8-27b:free)" in result["route"]
