"""The /chat/stream AI-fallback path should get LLM-authored follow-up
questions (chatbot.ollama_client.generate_llm_follow_ups()), same as the
non-streaming /chat path already does through route_claude(), falling back
to the generic per-type template only when the LLM gives nothing."""

import json

import pytest


def _final_result(raw: str):
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if not line.startswith("data: "):
            continue
        event = json.loads(line[len("data: "):])
        if event["type"] == "final":
            return event["result"]
    raise AssertionError("no final event in stream")


async def _fake_stream_chat_with_ollama(message, conversation_history=None, page_context=None):
    yield {"type": "stream", "chunk": "The Bible was written over roughly 1,500 years."}
    yield {"type": "done", "message": ""}


def test_stream_uses_llm_follow_ups_when_available(client, monkeypatch):
    # _stream_chat_response() imports stream_chat_with_ollama locally
    # (inside the function body) to avoid the eager module dependency —
    # so it must be patched on its home module, not chatbot.api.
    monkeypatch.setattr("chatbot.ollama_client.stream_chat_with_ollama", _fake_stream_chat_with_ollama)

    async def fake_llm_follow_ups(user_message, assistant_message, page_context=None):
        assert user_message == "How long did it take to write the Bible?"
        assert assistant_message == "The Bible was written over roughly 1,500 years."
        return ["Who were the human authors?"]

    monkeypatch.setattr("chatbot.router.generate_llm_follow_ups", fake_llm_follow_ups)

    resp = client.post("/chat/stream", json={"message": "How long did it take to write the Bible?"})
    result = _final_result(resp.text)

    assert result["follow_up_questions"] == ["Who were the human authors?"]


def test_stream_falls_back_to_the_template_when_the_llm_gives_nothing(client, monkeypatch):
    # _stream_chat_response() imports stream_chat_with_ollama locally
    # (inside the function body) to avoid the eager module dependency —
    # so it must be patched on its home module, not chatbot.api.
    monkeypatch.setattr("chatbot.ollama_client.stream_chat_with_ollama", _fake_stream_chat_with_ollama)

    async def fake_llm_follow_ups(user_message, assistant_message, page_context=None):
        return []

    monkeypatch.setattr("chatbot.router.generate_llm_follow_ups", fake_llm_follow_ups)

    resp = client.post("/chat/stream", json={"message": "How long did it take to write the Bible?"})
    result = _final_result(resp.text)

    assert result["follow_up_questions"] == [
        "Show me a relevant Bible verse on this topic",
        "What does the original language say about this?",
        "Can you elaborate on that?",
    ]
