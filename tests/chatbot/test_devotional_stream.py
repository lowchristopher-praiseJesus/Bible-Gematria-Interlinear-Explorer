import pytest

from chatbot import devotional


@pytest.mark.asyncio
async def test_stream_devotional_happy_path(monkeypatch):
    async def fake_resolve(raw, source, rotation=None):
        return "JHN 14:27", {"eng-KJV": "Peace I leave with you..."}

    async def fake_completion(system, user, *, max_tokens=3600):
        assert "JHN 14:27 (KJV)" in user
        for chunk in ["Some ", "morning ", "you wake..."]:
            yield {"type": "stream", "chunk": chunk}
        yield {"type": "done"}

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)

    events = [e async for e in devotional.stream_devotional("John 14:27", "user", None)]
    assert [e["type"] for e in events[:-1]] == ["stream", "stream", "stream"]
    done = events[-1]
    assert done["type"] == "done"
    assert done["text"] == "Some morning you wake..."
    assert done["reference"] == "JHN 14:27"
    assert done["translations"] == {"eng-KJV": "Peace I leave with you..."}


@pytest.mark.asyncio
async def test_stream_devotional_llm_error_is_forwarded(monkeypatch):
    async def fake_resolve(raw, source, rotation=None):
        return "JHN 14:27", {"eng-KJV": "..."}

    async def fake_completion(system, user, *, max_tokens=3600):
        yield {"type": "error", "message": "LLM API error: boom"}

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)

    events = [e async for e in devotional.stream_devotional("x", "user", None)]
    assert events == [{"type": "error", "message": "LLM API error: boom"}]


@pytest.mark.asyncio
async def test_stream_devotional_propagates_devotional_error(monkeypatch):
    async def fake_resolve(raw, source, rotation=None):
        raise devotional.DevotionalError("nope")

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)

    with pytest.raises(devotional.DevotionalError):
        [e async for e in devotional.stream_devotional("x", "user", None)]
