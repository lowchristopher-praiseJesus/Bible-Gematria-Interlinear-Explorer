import pytest

from chatbot.router import route_deterministic


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
