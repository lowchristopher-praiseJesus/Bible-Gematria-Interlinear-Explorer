from chatbot.bible_search import _USFM_TO_BNUM
from chatbot.data.hermeneutic_rulings import RULINGS, render_rulings, rulings_for


def test_ruling_ids_are_unique():
    ids = [r["id"] for r in RULINGS]
    assert len(ids) == len(set(ids))


def test_every_ruling_has_required_fields():
    for r in RULINGS:
        assert r["id"] and r["triggers"] and r["reading"] and r["rejects"]
        assert len(r["proofs"]) >= 1, f"{r['id']} has no proof texts"


def test_rulings_for_matches_case_insensitively():
    matched = rulings_for("A THORN IN THE FLESH was given to me")
    assert [r["id"] for r in matched] == ["thorn_in_the_flesh"]


def test_rulings_for_returns_empty_when_nothing_triggers():
    assert rulings_for("In the beginning God created the heaven and the earth.") == []


def test_rulings_for_matches_whole_phrases_only():
    # "tell me about the flesh" must not trigger the thorn ruling.
    assert rulings_for("tell me about the flesh") == []


def test_render_rulings_names_reading_and_rejection():
    text = render_rulings(rulings_for("thorn in the flesh"))
    assert "adversaries" in text.lower()
    assert "sickness" in text.lower()


def test_render_rulings_of_nothing_is_empty_string():
    assert render_rulings([]) == ""


def test_every_proof_text_resolves_against_complete_db():
    """Data-integrity guard, mirroring scripts/validate_devotional_pool.py:
    a ruling whose proof text does not exist would let the pipeline cite a
    verse that isn't there."""
    import dataset
    from chatbot.bible_search import DB_PATH

    db = dataset.connect(DB_PATH)
    for ruling in RULINGS:
        for proof in ruling["proofs"]:
            book, _, chapter_verse = proof.partition(" ")
            chapter, _, verse = chapter_verse.partition(":")
            bnum = _USFM_TO_BNUM.get(book.upper())
            assert bnum, f"{ruling['id']}: unknown book in proof {proof!r}"
            first_verse = int(verse.split("-")[0])
            row = db["Complete"].find_one(bnum=bnum, cnum=int(chapter), vnum=first_verse)
            assert row is not None, f"{ruling['id']}: proof {proof!r} does not resolve"
