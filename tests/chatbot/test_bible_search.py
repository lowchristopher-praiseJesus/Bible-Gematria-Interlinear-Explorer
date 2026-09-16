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


from chatbot.bible_search import fetch_interlinear_sync, fetch_strongs_entries_sync


def test_fetch_interlinear_returns_original_word_alignment():
    result = fetch_interlinear_sync("GEN", 1, 1)
    assert result["ref"] == "Genesis 1:1"
    # Original_Words_SN for Genesis 1:1 holds 7 entries, brace-wrapped.
    assert [w["strongs"] for w in result["words"]] == [
        "H7225", "H1254", "H430", "H853", "H8064", "H853", "H776",
    ]
    assert result["words"][0]["translit"] == "bəreyshiyt"
    assert result["words"][0]["value"] == 913


def test_fetch_interlinear_returns_root_alignment_separately():
    result = fetch_interlinear_sync("GEN", 1, 1)
    # Roots align with KJV_SN (6 entries), NOT with Original_Words_SN (7).
    assert [r["strongs"] for r in result["roots"]] == [
        "H7225", "H430", "H1254", "H8064", "H853", "H776",
    ]
    assert result["roots"][1]["translit"] == "ʾelohiym"
    assert "God" in result["roots"][1]["english"]


def test_fetch_interlinear_strips_markup_from_english():
    result = fetch_interlinear_sync("GEN", 1, 1)
    assert all("<" not in r["english"] for r in result["roots"])


def test_fetch_interlinear_unknown_book_returns_none():
    assert fetch_interlinear_sync("ZZZ", 1, 1) is None


def test_fetch_interlinear_missing_verse_returns_none():
    assert fetch_interlinear_sync("GEN", 1, 999) is None


def test_fetch_strongs_entries_returns_entries_by_number():
    entries = fetch_strongs_entries_sync(["H430", "H1254"])
    assert set(entries) == {"H430", "H1254"}
    assert entries["H430"]["transliteration1"] == "ʾelohiym"
    assert "God" in entries["H430"]["meaning"]


def test_fetch_strongs_entries_skips_unknown_numbers():
    entries = fetch_strongs_entries_sync(["H430", "H999999"])
    assert set(entries) == {"H430"}


def test_fetch_strongs_entries_of_nothing_is_empty():
    assert fetch_strongs_entries_sync([]) == {}
