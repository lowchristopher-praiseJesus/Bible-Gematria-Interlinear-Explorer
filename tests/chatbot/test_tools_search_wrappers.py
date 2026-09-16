import pytest


@pytest.mark.asyncio
async def test_search_gematria_wrapper():
    from chatbot.tools import search_gematria
    result = await search_gematria(2701)
    refs = {r["ref"] for r in result["verseResults"]}
    assert "Genesis 1:1" in refs


@pytest.mark.asyncio
async def test_search_english_wrapper():
    from chatbot.tools import search_english
    result = await search_english("beginning")
    refs = {r["ref"] for r in result["results"]}
    assert "Genesis 1:1" in refs


@pytest.mark.asyncio
async def test_random_verse_wrapper_returns_valid_book():
    from chatbot.tools import random_verse
    book, chapter, verse = await random_verse()
    assert isinstance(book, str) and book
    assert chapter >= 1
    assert verse >= 1


@pytest.mark.asyncio
async def test_fetch_interlinear_wrapper_returns_words():
    from chatbot.tools import fetch_interlinear
    result = await fetch_interlinear("GEN", 1, 1)
    assert result["ref"] == "Genesis 1:1"
    assert result["words"][0]["strongs"] == "H7225"


@pytest.mark.asyncio
async def test_fetch_strongs_local_wrapper_returns_entries():
    from chatbot.tools import fetch_strongs_local
    entries = await fetch_strongs_local(["H430"])
    assert "H430" in entries
