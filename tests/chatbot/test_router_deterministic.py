import pytest

from chatbot.router import route_deterministic, _find_flexible_verse_refs


@pytest.mark.asyncio
async def test_gematria_deterministic_route():
    result = await route_deterministic("find verses with gematria value 2701")
    assert result is not None
    assert result["type"] == "gematria"
    assert result["artifacts"][0]["params"]["value"] == 2701


@pytest.mark.asyncio
async def test_english_search_deterministic_route():
    result = await route_deterministic('search for "beginning"')
    assert result is not None
    assert result["type"] == "english_search"
    assert result["artifacts"][0]["params"]["query"] == "beginning"


@pytest.mark.asyncio
async def test_strongs_number_deterministic_route(monkeypatch):
    async def fake_fetch_strongs(numbers=None, words=None):
        return {"words": {"G0025": {"lemma": "agapaō"}}}

    monkeypatch.setattr("chatbot.router.fetch_strongs", fake_fetch_strongs)
    result = await route_deterministic("what does Strong's G25 mean?")
    assert result is not None
    assert result["type"] == "strongs"
    assert result["artifacts"] == [{"type": "strongs", "label": "G0025 ▸", "params": {"id": "G0025"}}]


@pytest.mark.asyncio
async def test_strongs_word_search_deterministic_route(monkeypatch):
    async def fake_fetch_strongs(numbers=None, words=None):
        return {"words": {"G0025": {}, "G5368": {}, "H0157": {}}}

    monkeypatch.setattr("chatbot.router.fetch_strongs", fake_fetch_strongs)
    result = await route_deterministic("what is the greek word for love")
    assert result is not None
    assert result["type"] == "strongs"
    assert [a["params"]["id"] for a in result["artifacts"]] == ["G0025", "G5368", "H0157"]


@pytest.mark.asyncio
async def test_strongs_word_search_caps_artifacts_at_five(monkeypatch):
    many_words = {f"G{i:04d}": {} for i in range(1, 9)}

    async def fake_fetch_strongs(numbers=None, words=None):
        return {"words": many_words}

    monkeypatch.setattr("chatbot.router.fetch_strongs", fake_fetch_strongs)
    result = await route_deterministic("what is the greek word for love")
    assert result is not None
    assert len(result["artifacts"]) == 5


@pytest.mark.asyncio
async def test_quote_deterministic_route_recognizes_abbreviated_book(monkeypatch):
    calls = []

    async def fake_fetch(reference, languages=None):
        calls.append(reference)
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await route_deterministic("quote 1 Th 4:16")
    assert calls == ["1TH 4:16"]
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "1TH 4:16"


@pytest.mark.asyncio
async def test_quote_deterministic_route_verse_range_reads_as_a_passage(monkeypatch):
    fetch_calls = []

    async def fake_fetch(reference, languages=None):
        fetch_calls.append(reference)
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await route_deterministic("quote 1 Thessalonians 4:13-18")

    assert fetch_calls == []
    assert result["type"] == "chat"
    assert result["data"]["reference"] == "1TH 4:13-18"
    assert result["artifacts"] == [
        {"type": "chapter", "label": "Read 1TH 4:13-18 ▸", "params": {"reference": "1TH 4:13-18"}},
        {"type": "book_context", "label": "1 Thessalonians — Book Context ▸", "params": {"book": "1TH"}},
    ]


@pytest.mark.asyncio
async def test_default_verse_lookup_recognizes_abbreviated_range(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    # No quote/study keyword — falls through to the default verse-ref lookup.
    result = await route_deterministic("1 Thess 4:13-18")
    assert result["data"]["reference"] == "1TH 4:13-18"


def test_find_flexible_verse_refs_ignores_ambiguous_english_words():
    # "is"/"am" are real English words and shouldn't false-positive just
    # because they're followed by an N:N-shaped pattern.
    assert _find_flexible_verse_refs("What is 4:1 as a percentage?") == []
    assert _find_flexible_verse_refs("I am 4:1 sure about this") == []


def test_find_flexible_verse_refs_ignores_non_book_words():
    assert _find_flexible_verse_refs("see chapter 5:3 of the manual") == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "message", ["one more", "another verse", "give me another", "random verse", "surprise me", "next verse"]
)
async def test_random_verse_phrasings_return_a_structured_verse_response(monkeypatch, message):
    async def fake_random_verse():
        return ("John", 3, 16)

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "For God so loved the world..."}

    monkeypatch.setattr("chatbot.router.random_verse", fake_random_verse)
    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await route_deterministic(message)
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "JHN 3:16"


@pytest.mark.asyncio
async def test_random_verse_phrasing_ignores_stale_history_context(monkeypatch):
    # "one more" after discussing Genesis 1:1 must pick a fresh random verse,
    # not re-fetch Genesis 1:1 from conversation history.
    async def fake_random_verse():
        return ("John", 3, 16)

    fetch_calls = []

    async def fake_fetch(reference, languages=None):
        fetch_calls.append(reference)
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.random_verse", fake_random_verse)
    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    history = [{"role": "assistant", "text": "Here is **GEN 1:1**."}]
    result = await route_deterministic("one more", history=history)
    assert fetch_calls == ["JHN 3:16"]
    assert result["data"]["reference"] == "JHN 3:16"


@pytest.mark.asyncio
async def test_random_verse_phrasing_yields_to_an_explicit_reference_in_the_same_message(monkeypatch):
    # An unlikely but possible combination — the explicit reference wins.
    async def fake_random_verse():
        raise AssertionError("should not be called when the message names a specific verse")

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.random_verse", fake_random_verse)
    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await route_deterministic("give me another verse, John 3:16")
    assert result["data"]["reference"] == "JHN 3:16"
