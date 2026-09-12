"""POST /chat/stream's voice-mode BYOK override: `use_openai_llm: true` in
the body plus an `X-OpenAI-Key` header routes the AI-fallback generation to
OpenAI's gpt-5.4-mini via chatbot.ollama_client's `llm_override`, instead of
the server's configured Ollama/NVIDIA provider. See
docs/superpowers/specs/2026-09-11-voice-mode-design.md.
"""

import json


def _final_result(raw: str):
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if not line.startswith("data: "):
            continue
        event = json.loads(line[len("data: "):])
        if event["type"] == "final":
            return event["result"]
    raise AssertionError("no final event in stream")


def test_openai_key_header_and_flag_route_to_the_override(client, monkeypatch):
    captured = {}

    async def fake_stream_chat_with_ollama(
        message, conversation_history=None, page_context=None, llm_override=None
    ):
        captured["llm_override"] = llm_override
        yield {"type": "stream", "chunk": "Grace is unmerited favor."}
        yield {"type": "done", "message": ""}

    monkeypatch.setattr(
        "chatbot.ollama_client.stream_chat_with_ollama", fake_stream_chat_with_ollama
    )

    resp = client.post(
        "/chat/stream",
        json={"message": "What is grace?", "use_openai_llm": True},
        headers={"X-OpenAI-Key": "sk-user-supplied"},
    )
    result = _final_result(resp.text)

    assert captured["llm_override"] == {
        "provider": "openai",
        "api_key": "sk-user-supplied",
        "model": "gpt-5.4-mini",
    }
    assert result["message"] == "Grace is unmerited favor."
    assert "OpenAI (gpt-5.4-mini)" in result["route"]


def test_flag_without_header_is_ignored(client, monkeypatch):
    # use_openai_llm=true with no X-OpenAI-Key header must fall back to the
    # server's normal (here: unconfigured) provider rather than silently
    # trying to call OpenAI with no key.
    captured = {}

    async def fake_stream_chat_with_ollama(
        message, conversation_history=None, page_context=None, llm_override=None
    ):
        captured["llm_override"] = llm_override
        yield {"type": "done", "message": ""}

    monkeypatch.setattr(
        "chatbot.ollama_client.stream_chat_with_ollama", fake_stream_chat_with_ollama
    )
    monkeypatch.setattr("chatbot.ollama_client.llm_unconfigured_error", lambda: None)

    resp = client.post("/chat/stream", json={"message": "What is grace?", "use_openai_llm": True})
    _final_result(resp.text)

    assert captured["llm_override"] is None


def test_header_without_flag_is_ignored(client, monkeypatch):
    # A stray X-OpenAI-Key header (e.g. a typed turn that happens to carry
    # it) must not activate the override without the explicit body flag.
    captured = {}

    async def fake_stream_chat_with_ollama(
        message, conversation_history=None, page_context=None, llm_override=None
    ):
        captured["llm_override"] = llm_override
        yield {"type": "done", "message": ""}

    monkeypatch.setattr(
        "chatbot.ollama_client.stream_chat_with_ollama", fake_stream_chat_with_ollama
    )
    monkeypatch.setattr("chatbot.ollama_client.llm_unconfigured_error", lambda: None)

    resp = client.post(
        "/chat/stream",
        json={"message": "What is grace?"},
        headers={"X-OpenAI-Key": "sk-user-supplied"},
    )
    _final_result(resp.text)

    assert captured["llm_override"] is None
