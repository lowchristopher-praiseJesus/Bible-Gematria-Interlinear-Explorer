from chatbot import hermeneutics


async def _fake_fetch(reference, languages=None):
    known = {
        "1CO 15:51-52": "Behold, I shew you a mystery...",
        "JHN 14:2-3": "In my Father's house are many mansions...",
    }
    if reference not in known:
        raise ValueError("no such verse")
    return {"eng-KJV": known[reference]}


async def test_verify_witnesses_keeps_resolvable_references_with_text(monkeypatch):
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", _fake_fetch)
    citations, dropped = await hermeneutics.verify_witnesses(
        "Reasoning here.\nWITNESSES: 1CO 15:51-52, JHN 14:2-3"
    )
    assert [c["reference"] for c in citations] == ["1CO 15:51-52", "JHN 14:2-3"]
    assert all(c["verified"] for c in citations)
    assert "mystery" in citations[0]["text"]
    assert dropped == 0


async def test_verify_witnesses_drops_unresolvable_references(monkeypatch):
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", _fake_fetch)
    citations, dropped = await hermeneutics.verify_witnesses(
        "WITNESSES: 1CO 15:51-52, HEB 4:19"
    )
    assert [c["reference"] for c in citations] == ["1CO 15:51-52"]
    assert dropped == 1


async def test_verify_witnesses_with_no_marker_returns_nothing(monkeypatch):
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", _fake_fetch)
    assert await hermeneutics.verify_witnesses("No marker line here.") == ([], 0)


async def test_verify_witnesses_accepts_full_book_names(monkeypatch):
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", _fake_fetch)
    citations, _ = await hermeneutics.verify_witnesses(
        "WITNESSES: 1 Corinthians 15:51-52"
    )
    assert citations[0]["reference"] == "1CO 15:51-52"


def test_parse_verdicts_reads_all_three_tests():
    verdicts = hermeneutics.parse_verdicts(
        "Some prose.\n"
        "VERDICT: heart=pass — it produces gratitude\n"
        "VERDICT: cross=fail — it reintroduces sin-consciousness\n"
        "VERDICT: grace=pass — sins are not counted"
    )
    assert [v["test"] for v in verdicts] == ["heart", "cross", "grace"]
    assert [v["passed"] for v in verdicts] == [True, False, True]
    assert "sin-consciousness" in verdicts[1]["reason"]


def test_parse_verdicts_of_prose_without_markers_is_empty():
    assert hermeneutics.parse_verdicts("All three tests passed.") == []


def test_parse_marker_reads_audience():
    assert hermeneutics.parse_marker("prose\nAUDIENCE: church", "AUDIENCE") == "church"


def test_parse_marker_missing_returns_none():
    assert hermeneutics.parse_marker("prose only", "AUDIENCE") is None
