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
