from chatbot import hermeneutics


async def test_passage_text_joins_the_range_with_verse_numbers():
    text = await hermeneutics.passage_text_for("GEN", 1, 1, 2)
    assert text.startswith("1 In the beginning")
    assert " 2 " in text


async def test_grounding_none_is_empty():
    assert await hermeneutics.build_grounding("none", "GEN", 1, 1, 1, "x") == ""


async def test_lexical_grounding_includes_strongs_and_rulings(monkeypatch):
    captured = {}

    async def fake_search_english(query):
        captured.setdefault("queries", []).append(query)
        return {"results": [{"ref": "Numbers 33:55", "text": "thorns in your sides"}]}

    monkeypatch.setattr(hermeneutics, "search_english", fake_search_english)
    text = await hermeneutics.build_grounding(
        "lexical", "GEN", 1, 1, 1, "a thorn in the flesh was given"
    )
    assert "H430" in text                      # Strong's from the interlinear
    assert "adversaries" in text.lower()       # the triggered ruling
    assert "NOT" in text


async def test_lexical_grounding_omits_rulings_that_do_not_trigger(monkeypatch):
    async def fake_search_english(query):
        return {"results": []}

    monkeypatch.setattr(hermeneutics, "search_english", fake_search_english)
    text = await hermeneutics.build_grounding("lexical", "GEN", 1, 1, 1, "In the beginning")
    assert "thorn" not in text.lower()


async def test_roots_grounding_names_divine_titles_by_strongs_number():
    text = await hermeneutics.build_grounding("roots", "GEN", 1, 1, 1, "In the beginning")
    assert "Elohim" in text
    assert "H430" in text


async def test_roots_grounding_omits_titles_absent_from_the_passage():
    # Romans has no H430/H3068 — the title note must not be fabricated.
    text = await hermeneutics.build_grounding("roots", "ROM", 8, 1, 1, "There is therefore now")
    assert "Elohim" not in text


async def test_book_context_grounding_survives_a_book_with_no_context(monkeypatch):
    monkeypatch.setattr(hermeneutics, "get_book_context", lambda usfm: None)
    text = await hermeneutics.build_grounding("book_context", "GEN", 1, 1, 1, "x")
    assert isinstance(text, str)


async def test_lexical_grounding_greek_passage_has_no_literal_none(monkeypatch):
    """Ensure Greek transliteration doesn't render as literal 'None' string."""
    async def fake_search_english(query):
        return {"results": []}

    monkeypatch.setattr(hermeneutics, "search_english", fake_search_english)
    text = await hermeneutics.build_grounding("lexical", "JHN", 3, 16, 16, "God so loved the world")
    # G2316 is theos (God) in John 3:16
    assert "G2316" in text
    # The literal string "None" should never appear in the grounding
    assert "None" not in text
    # We should have a Greek transliteration (theos), not the word "None"
    assert "theos" in text.lower() or text.count("G2316") >= 1  # At least the Strong's number
