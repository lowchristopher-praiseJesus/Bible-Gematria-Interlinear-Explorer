import pytest

from chatbot import story_mode


@pytest.fixture
def llm(monkeypatch):
    """Stubs the simple_completion LLM boundary; records what story_mode
    sent it. `state["replies"]` is a queue consumed one per call."""
    calls = []
    state = {"replies": [
        '{"themes": [{"id": "t1", "label": "Trusting God", "description": '
        '"God provides even when we cannot see how."}, {"id": "t2", '
        '"label": "Coming home", "description": "It is never too late to '
        'return."}], "digest": "We talked about the prodigal son and how '
        'God welcomes us back."}'
    ]}

    async def fake_completion(system_prompt, user_prompt, *, max_tokens=2048, timeout=60.0):
        calls.append({
            "system_prompt": system_prompt, "user_prompt": user_prompt,
            "max_tokens": max_tokens, "timeout": timeout,
        })
        return state["replies"].pop(0) if state["replies"] else ""

    monkeypatch.setattr(story_mode, "simple_completion", fake_completion)
    monkeypatch.setattr(story_mode, "llm_unconfigured_error", lambda: None)
    return type("LLM", (), {"calls": calls, "state": state})


async def test_derive_themes_returns_up_to_three_themes_and_a_digest(llm):
    messages = [
        {"role": "user", "text": "Tell me about the prodigal son."},
        {"role": "assistant", "text": "It's a parable about a father's forgiveness."},
    ]
    result = await story_mode.derive_themes(messages)
    assert len(result["themes"]) == 2
    assert result["themes"][0] == {
        "id": "t1", "label": "Trusting God",
        "description": "God provides even when we cannot see how.",
    }
    assert "prodigal son" in result["digest"]


async def test_derive_themes_never_pads_below_three(llm):
    llm.state["replies"] = [
        '{"themes": [{"id": "t1", "label": "One lesson", "description": "..."}], "digest": "short chat"}'
    ]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert len(result["themes"]) == 1


async def test_derive_themes_handles_a_single_message_transcript(llm):
    result = await story_mode.derive_themes([{"role": "user", "text": "What does John 3:16 mean?"}])
    assert len(result["themes"]) >= 1


async def test_derive_themes_caps_long_transcripts(llm):
    long_transcript = [{"role": "user", "text": f"message {i}"} for i in range(200)]
    await story_mode.derive_themes(long_transcript)
    sent = llm.calls[0]["user_prompt"]
    assert "message 199" in sent
    assert "message 0" not in sent


async def test_derive_themes_returns_empty_on_unparseable_reply(llm):
    llm.state["replies"] = ["not json at all"]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert result["themes"] == []


async def test_derive_themes_returns_empty_for_no_messages(llm):
    result = await story_mode.derive_themes([])
    assert result["themes"] == []
    assert llm.calls == []


async def test_derive_themes_caps_at_three_even_if_the_model_returns_more(llm):
    llm.state["replies"] = [
        '{"themes": ['
        '{"id": "t1", "label": "A", "description": ""},'
        '{"id": "t2", "label": "B", "description": ""},'
        '{"id": "t3", "label": "C", "description": ""},'
        '{"id": "t4", "label": "D", "description": ""}'
        '], "digest": "d"}'
    ]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert len(result["themes"]) == 3
