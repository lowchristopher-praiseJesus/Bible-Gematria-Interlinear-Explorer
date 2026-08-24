from chatbot.bible_search import search_english_sync, search_gematria_sync


def test_search_gematria_verse_totals():
    result = search_gematria_sync(2701)
    assert result["value"] == 2701
    refs = {r["ref"] for r in result["verseResults"]}
    assert "Genesis 1:1" in refs


def test_search_gematria_word_matches():
    result = search_gematria_sync(913)
    assert len(result["wordResults"]) > 0
    assert all(r["strongsNumber"] for r in result["wordResults"])


def test_search_gematria_no_results():
    result = search_gematria_sync(39999)
    assert result["wordResults"] == []
    assert result["verseResults"] == []


def test_search_english_finds_known_verse():
    result = search_english_sync("beginning")
    assert result["query"] == "beginning"
    refs = {r["ref"] for r in result["results"]}
    assert "Genesis 1:1" in refs
    first = next(r for r in result["results"] if r["ref"] == "Genesis 1:1")
    assert first["matchPositions"], "expected at least one match position"


def test_search_english_no_results():
    result = search_english_sync("zzzxqnotarealword")
    assert result["results"] == []
    assert result["truncated"] is False
