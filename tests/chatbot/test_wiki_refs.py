from chatbot.wiki_refs import resolve_scripture_refs, resolve_wikilinks, render_wiki_body


def test_resolve_wikilinks_known_slug():
    result = resolve_wikilinks("See [[grace]] for more.", "s1", {"grace": "Grace"})
    assert result == "See [Grace](/topic-wiki?series=s1&page=grace) for more."


def test_resolve_wikilinks_unknown_slug_left_as_plain_text():
    result = resolve_wikilinks("See [[nonexistent]] for more.", "s1", {"grace": "Grace"})
    assert result == "See [[nonexistent]] for more."


def test_resolve_scripture_refs_recognized_abbreviation():
    result = resolve_scripture_refs("As it is written in Heb 4:14, we have hope.")
    assert result == "As it is written in [Heb 4:14](/explorer?reference=HEB%204%3A14), we have hope."


def test_resolve_scripture_refs_en_dash_range_collapses_to_first_verse():
    # The wiki's own citation style uses an en dash for ranges
    # ("Heb 4:14–15"); the link opens the first verse of the range,
    # consistent with how stripVerseRange() already behaves elsewhere
    # in this app.
    result = resolve_scripture_refs("See Heb 4:14–15 for the full point.")
    assert result == "See [Heb 4:14–15](/explorer?reference=HEB%204%3A14) for the full point."


def test_resolve_scripture_refs_unrecognized_token_left_as_plain_text():
    result = resolve_scripture_refs("See the transcript at md:71 for the quote.")
    assert result == "See the transcript at md:71 for the quote."


def test_resolve_scripture_refs_two_word_book_abbreviation():
    result = resolve_scripture_refs("Paul writes in 1 Cor 15:10 about grace.")
    assert result == "Paul writes in [1 Cor 15:10](/explorer?reference=1CO%2015%3A10) about grace."


def test_render_wiki_body_resolves_both_kinds_without_double_processing():
    body = "See [[grace]] and Heb 4:14 together."
    result = render_wiki_body(body, "s1", {"grace": "Grace"})
    assert result == (
        "See [Grace](/topic-wiki?series=s1&page=grace) and "
        "[Heb 4:14](/explorer?reference=HEB%204%3A14) together."
    )
