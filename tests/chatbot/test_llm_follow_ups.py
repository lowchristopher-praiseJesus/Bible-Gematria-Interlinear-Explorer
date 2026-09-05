"""Tests for chatbot.ollama_client.generate_llm_follow_ups() — the AI-fallback
path's LLM-authored follow-up questions, grounded in the exchange that just
happened, instead of the generic per-type templates every deterministic
route uses (see _generate_follow_ups() in router.py)."""

import httpx
import pytest

from chatbot import ollama_client as oc


@pytest.fixture(autouse=True)
def _local_ollama_provider(monkeypatch):
    """Pin the provider to a locally-configured Ollama instance for every
    test in this file, regardless of what LLM_PROVIDER/*_API_KEY happen to
    be set to in the real environment (e.g. an nvidia key for local dev)."""
    monkeypatch.setattr(oc, "LLM_PROVIDER", "ollama")
    monkeypatch.setattr(oc, "OLLAMA_API_URL", "http://localhost:11434")
    monkeypatch.setattr(oc, "OLLAMA_API_KEY", None)


def _mock_client(monkeypatch, content: str):
    """Patch httpx.AsyncClient so any request gets a fake chat-completion
    response whose assistant message is `content`."""

    def handler(request):
        return httpx.Response(200, json={"message": {"content": content}})

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(oc.httpx, "AsyncClient", client_factory)


@pytest.mark.asyncio
async def test_parses_a_clean_json_array(monkeypatch):
    _mock_client(monkeypatch, '["What does selah mean?", "Who wrote this psalm?"]')

    result = await oc.generate_llm_follow_ups("Tell me about Psalm 3", "Psalm 3 is a lament...")

    assert result == ["What does selah mean?", "Who wrote this psalm?"]


@pytest.mark.asyncio
async def test_parses_a_json_array_wrapped_in_a_markdown_fence(monkeypatch):
    _mock_client(monkeypatch, '```json\n["Question one?", "Question two?"]\n```')

    result = await oc.generate_llm_follow_ups("q", "a")

    assert result == ["Question one?", "Question two?"]


@pytest.mark.asyncio
async def test_parses_a_json_array_with_stray_prose_around_it(monkeypatch):
    _mock_client(
        monkeypatch,
        'Sure, here are some follow-ups:\n["Question one?", "Question two?"]\nHope that helps!',
    )

    result = await oc.generate_llm_follow_ups("q", "a")

    assert result == ["Question one?", "Question two?"]


@pytest.mark.asyncio
async def test_drops_blank_and_non_string_entries_and_caps_at_four(monkeypatch):
    _mock_client(monkeypatch, '["One?", "", "  ", 42, "Two?", "Three?", "Four?", "Five?"]')

    result = await oc.generate_llm_follow_ups("q", "a")

    assert result == ["One?", "Two?", "Three?", "Four?"]


@pytest.mark.asyncio
async def test_unparseable_content_returns_empty_list(monkeypatch):
    _mock_client(monkeypatch, "not json at all")

    result = await oc.generate_llm_follow_ups("q", "a")

    assert result == []


@pytest.mark.asyncio
async def test_non_array_json_returns_empty_list(monkeypatch):
    _mock_client(monkeypatch, '{"questions": ["One?"]}')

    result = await oc.generate_llm_follow_ups("q", "a")

    assert result == []


@pytest.mark.asyncio
async def test_http_error_returns_empty_list_instead_of_raising(monkeypatch):
    def handler(request):
        return httpx.Response(500, text="internal error")

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(oc.httpx, "AsyncClient", client_factory)

    result = await oc.generate_llm_follow_ups("q", "a")

    assert result == []


@pytest.mark.asyncio
async def test_unconfigured_llm_returns_empty_list_without_a_request(monkeypatch):
    monkeypatch.setattr(oc, "OLLAMA_API_URL", "https://api.ollama.com")
    monkeypatch.setattr(oc, "OLLAMA_API_KEY", None)

    def fail_if_called(*_a, **_k):
        raise AssertionError("should not make an HTTP request when unconfigured")

    monkeypatch.setattr(oc.httpx, "AsyncClient", fail_if_called)

    result = await oc.generate_llm_follow_ups("q", "a")

    assert result == []
