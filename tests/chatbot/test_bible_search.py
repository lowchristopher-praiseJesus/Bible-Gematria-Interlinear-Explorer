from chatbot.bible_search import list_passage_verses_sync, search_english_sync, search_gematria_sync


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


def test_list_passage_verses_whole_chapter():
    verses = list_passage_verses_sync("Job", 1)
    assert len(verses) == 22
    assert verses[0]["versenumber"] == 12871
    assert verses[0]["vnum"] == 1
    assert verses[0]["ref"] == "Job 1:1"
    assert verses[-1]["vnum"] == 22


def test_list_passage_verses_includes_local_kjv_text():
    # The KJV text is already sitting in Complete.db (it's the same column
    # english search reads), so it should come back for free alongside the
    # bare structural fields — no external fetch required to get it.
    verses = list_passage_verses_sync("Job", 1)
    assert verses[0]["kjv"].startswith("There was a man in the land of Uz")
    # The 1769-column's inline markup (e.g. <i>was</i>) is stripped, same
    # as english search's cleaned text.
    assert "<i>" not in verses[0]["kjv"]


def test_list_passage_verses_range():
    verses = list_passage_verses_sync("Luke", 15, start_verse=11, end_verse=32)
    assert [v["vnum"] for v in verses] == list(range(11, 33))
    assert verses[0]["ref"] == "Luke 15:11"


def test_list_passage_verses_unknown_book_or_chapter():
    assert list_passage_verses_sync("Not A Book", 1) == []
    assert list_passage_verses_sync("Job", 999) == []
