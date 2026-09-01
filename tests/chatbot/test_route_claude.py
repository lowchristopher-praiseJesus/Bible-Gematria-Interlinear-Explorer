"""Tests for route_claude()'s post-processing: when the AI fallback cites
a verse reference in free-text prose, the response should still get the
same structured verse/passage data (boxed, with original-language and
book-context links) every other response uses — not be left as plain
text just because it came from the AI path instead of the deterministic
router."""

import pytest

from chatbot.router import route_claude


@pytest.mark.asyncio
async def test_ai_response_citing_a_single_verse_gets_boxed(monkeypatch):
    async def fake_ollama(message, conversation_history=None, page_context=None):
        return {
            "type": "chat",
            "message": 'The shortest verse in most English Bible translations is John 11:35:\n\n> "Jesus wept."',
            "data": None,
            "route": "AI Fallback → Ollama",
        }

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "Jesus wept."}

    monkeypatch.setattr("chatbot.router.chat_with_ollama", fake_ollama)
    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)

    result = await route_claude("What's the shortest verse in the Bible?")

    assert result["type"] == "verse"
    assert result["data"]["reference"] == "JHN 11:35"
    assert result["data"]["translations"] == {"eng-KJV": "Jesus wept."}
    # The prose itself is left exactly as the AI wrote it.
    assert "shortest verse" in result["message"]
    assert result["follow_up_questions"]


@pytest.mark.asyncio
async def test_ai_response_citing_a_verse_range_gets_a_chapter_artifact(monkeypatch):
    async def fake_ollama(message, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "Paul's famous passage on love is 1 Corinthians 13:4-7.", "data": None}

    monkeypatch.setattr("chatbot.router.chat_with_ollama", fake_ollama)

    result = await route_claude("Where is the love chapter?")

    assert result["type"] == "chat"  # ranges stay "chat" + a "chapter" artifact, same as everywhere else
    assert result["data"]["reference"] == "1CO 13:4-7"
    assert any(a["type"] == "chapter" for a in result["artifacts"])


@pytest.mark.asyncio
async def test_ai_response_with_no_verse_reference_is_left_untouched(monkeypatch):
    async def fake_ollama(message, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "The Bible was written over roughly 1,500 years.", "data": None}

    monkeypatch.setattr("chatbot.router.chat_with_ollama", fake_ollama)

    result = await route_claude("How long did it take to write the Bible?")

    assert result["type"] == "chat"
    assert result["data"] is None


@pytest.mark.asyncio
async def test_ai_response_citing_every_distinct_verse_gets_all_of_them_boxed(monkeypatch):
    # Reproduces "which verse in the New Testament has the word joy in
    # it?" — the AI names four distinct verses in one reply; all four
    # should be boxed, not just the first.
    async def fake_ollama(message, conversation_history=None, page_context=None):
        return {
            "type": "chat",
            "message": (
                "One prominent example is Galatians 5:22. Other well-known examples "
                "include James 1:2, Romans 15:13, and 1 Peter 1:8."
            ),
            "data": None,
        }

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"text for {reference}"}

    monkeypatch.setattr("chatbot.router.chat_with_ollama", fake_ollama)
    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)

    result = await route_claude("Which verse in the New Testament has the word Joy in it?")

    assert result["type"] == "verses"
    refs = [v["reference"] for v in result["data"]["verses"]]
    assert refs == ["GAL 5:22", "JAS 1:2", "ROM 15:13", "1PE 1:8"]
    # Every verse actually got fetched, in the same order they were cited.
    assert all(v["translations"] for v in result["data"]["verses"])


@pytest.mark.asyncio
async def test_ai_response_citing_verses_does_not_repeat_the_same_verse_twice(monkeypatch):
    async def fake_ollama(message, conversation_history=None, page_context=None):
        return {
            "type": "chat",
            "message": "See John 3:16 for this. As John 3:16 says, God so loved the world.",
            "data": None,
        }

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.chat_with_ollama", fake_ollama)
    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)

    result = await route_claude("Tell me about John 3:16 twice")

    assert result["type"] == "verse"
    assert result["data"]["reference"] == "JHN 3:16"


@pytest.mark.asyncio
async def test_ai_response_citing_too_many_verses_is_capped(monkeypatch):
    refs = [f"John {n}:1" for n in range(1, 10)]  # 9 distinct chapters

    async def fake_ollama(message, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "See " + ", ".join(refs) + ".", "data": None}

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.chat_with_ollama", fake_ollama)
    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)

    result = await route_claude("give me a tour of John")

    assert len(result["data"]["verses"]) == 5


@pytest.mark.asyncio
async def test_ai_response_falls_back_gracefully_when_the_verse_fetch_fails(monkeypatch):
    async def fake_ollama(message, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "The shortest verse is John 11:35.", "data": None}

    async def failing_fetch(reference, languages=None):
        raise RuntimeError("network error")

    monkeypatch.setattr("chatbot.router.chat_with_ollama", fake_ollama)
    monkeypatch.setattr("chatbot.router.fetch_verse_translations", failing_fetch)

    result = await route_claude("What's the shortest verse?")

    assert result["type"] == "chat"
    assert result["data"] is None
    assert "shortest verse" in result["message"]


@pytest.mark.asyncio
async def test_ai_error_response_is_left_untouched(monkeypatch):
    async def fake_ollama(message, conversation_history=None, page_context=None):
        return {"type": "error", "message": "Ollama API error: timeout", "data": None}

    monkeypatch.setattr("chatbot.router.chat_with_ollama", fake_ollama)

    result = await route_claude("anything")

    assert result["type"] == "error"
