"""Coverage for the per-request `llm_override` in chatbot.ollama_client —
voice mode's BYOK path to OpenAI's gpt-5.4-mini. See
docs/superpowers/specs/2026-09-11-voice-mode-design.md and the LLM-choice
follow-up work in chatbot/api.py::_stream_chat_response.
"""

import httpx
import pytest

from chatbot import ollama_client as oc


def _set_provider(monkeypatch, provider, **overrides):
    """Point the *global* (env-configured) provider somewhere that is
    unconfigured/irrelevant, so a passing test proves `llm_override` — not
    the server's own LLM_PROVIDER — drove the call."""
    values = {
        "LLM_PROVIDER": provider,
        "NVIDIA_API_URL": "https://integrate.api.nvidia.com/v1",
        "NVIDIA_MODEL": "meta/llama-3.3-70b-instruct",
        "NVIDIA_API_KEY": None,
        "OLLAMA_API_URL": "http://localhost:11434",
        "OLLAMA_MODEL": "deepseek-v4-pro:cloud",
        "OLLAMA_API_KEY": None,
    }
    values.update(overrides)
    for name, value in values.items():
        monkeypatch.setattr(oc, name, value)


OVERRIDE = {"provider": "openai", "api_key": "sk-user-supplied", "model": "gpt-5.4-mini"}


def test_build_request_openai_override_ignores_global_provider(monkeypatch):
    _set_provider(monkeypatch, "nvidia", NVIDIA_API_KEY=None)  # globally unconfigured
    provider, url, headers, payload = oc._build_request(
        [{"role": "user", "content": "hi"}], stream=False, llm_override=OVERRIDE
    )
    assert provider == "openai"
    assert url == "https://api.openai.com/v1/chat/completions"
    assert headers["Authorization"] == "Bearer sk-user-supplied"
    assert payload["model"] == "gpt-5.4-mini"
    # gpt-5-class models on the Chat Completions endpoint reject a
    # non-default temperature and don't accept `max_tokens` at all — see
    # _build_request's openai branch.
    assert "temperature" not in payload
    assert "max_tokens" not in payload
    assert payload["max_completion_tokens"] == 2048
    assert "options" not in payload


def test_build_request_openai_override_defaults_model(monkeypatch):
    _set_provider(monkeypatch, "ollama")
    _, _, _, payload = oc._build_request(
        [{"role": "user", "content": "hi"}],
        stream=False,
        llm_override={"provider": "openai", "api_key": "sk-x"},
    )
    assert payload["model"] == oc.OPENAI_VOICE_MODEL


def test_active_model_label_with_override(monkeypatch):
    _set_provider(monkeypatch, "ollama")
    assert oc.active_model_label(OVERRIDE) == "OpenAI (gpt-5.4-mini)"
    # No override: falls back to describing the global provider, unchanged.
    assert oc.active_model_label() == "Ollama (deepseek-v4-pro:cloud)"


def test_extract_content_openai_is_nvidia_shaped():
    body = {"choices": [{"message": {"content": "Hello there"}}]}
    assert oc._extract_content("openai", body) == ("Hello there", None)


def test_stream_delta_openai_is_nvidia_shaped():
    assert oc._stream_delta(
        "openai", 'data: {"choices":[{"delta":{"content":"Hi"}}]}'
    ) == ("chunk", "Hi")
    assert oc._stream_delta("openai", "data: [DONE]") == ("done", None)


@pytest.mark.asyncio
async def test_stream_chat_with_ollama_bypasses_unconfigured_check_with_override(monkeypatch):
    # The global provider is deliberately left unconfigured (nvidia, no key)
    # — without the override, this would short-circuit with an error before
    # ever making a request. The override must skip that check entirely.
    _set_provider(monkeypatch, "nvidia", NVIDIA_API_KEY=None)
    assert oc.llm_unconfigured_error() is not None  # sanity: globally unconfigured

    async def fake_research(*_a, **_k):
        return ""

    monkeypatch.setattr(oc, "_fetch_research_data", fake_research)

    sse_body = (
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer sk-user-supplied"
        import json

        body = json.loads(request.content)
        assert body["model"] == "gpt-5.4-mini"
        return httpx.Response(200, text=sse_body)

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(oc.httpx, "AsyncClient", client_factory)

    events = [
        event async for event in oc.stream_chat_with_ollama("hi", llm_override=OVERRIDE)
    ]
    assert not any(e["type"] == "error" for e in events)
    assert "".join(e["chunk"] for e in events if e["type"] == "stream") == "Hello"
    assert events[-1]["type"] == "done"
