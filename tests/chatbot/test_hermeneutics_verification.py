"""Witness verification runs against Complete.db — nothing here fakes the
lookup, because the bug being guarded is the lookup itself."""

import pytest

from chatbot import hermeneutics, tools


@pytest.fixture(autouse=True)
def no_external_fetch(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("witnesses are verified against Complete.db, not fetched")

    monkeypatch.setattr(tools, "fetch_verse_translations", explode)


async def test_verify_witnesses_keeps_resolvable_references_with_text():
    citations, dropped = await hermeneutics.verify_witnesses(
        "Reasoning here.\nWITNESSES: 1CO 15:51-52, JHN 14:2-3"
    )
    assert [c["reference"] for c in citations] == ["1CO 15:51-52", "JHN 14:2-3"]
    assert all(c["verified"] for c in citations)
    assert "mystery" in citations[0]["text"]
    assert "twinkling of an eye" in citations[0]["text"], "a range keeps every verse"
    assert dropped == 0


async def test_verify_witnesses_keeps_a_single_verse():
    citations, dropped = await hermeneutics.verify_witnesses("WITNESSES: John 3:16")
    assert citations[0]["reference"] == "JHN 3:16"
    assert "only begotten Son" in citations[0]["text"]
    assert dropped == 0


async def test_verify_witnesses_drops_unresolvable_references():
    citations, dropped = await hermeneutics.verify_witnesses(
        "WITNESSES: 1CO 15:51-52, HEB 4:19, Nowhere 1:1"
    )
    assert [c["reference"] for c in citations] == ["1CO 15:51-52"]
    assert dropped == 2


async def test_verify_witnesses_drops_a_range_running_past_the_chapter():
    # Hebrews 4 has 16 verses; a model inventing 4:15-19 must not be
    # credited with a verified witness.
    citations, dropped = await hermeneutics.verify_witnesses("WITNESSES: HEB 4:15-19")
    assert citations == []
    assert dropped == 1


async def test_verify_witnesses_with_no_marker_returns_nothing():
    assert await hermeneutics.verify_witnesses("No marker line here.") == ([], 0)


async def test_verify_witnesses_accepts_full_book_names():
    citations, _ = await hermeneutics.verify_witnesses(
        "WITNESSES: 1 Corinthians 15:51-52"
    )
    assert citations[0]["reference"] == "1CO 15:51-52"


async def test_verify_witnesses_accepts_unicode_dashes():
    citations, _ = await hermeneutics.verify_witnesses("WITNESSES: 1 Corinthians 15:51–52")
    assert citations[0]["reference"] == "1CO 15:51-52"


async def test_verify_witnesses_deduplicates_the_same_reference():
    # A repeated witness became a duplicate React key in the report; the
    # first occurrence is kept and the repeat is neither cited nor counted
    # as dropped.
    citations, dropped = await hermeneutics.verify_witnesses(
        "WITNESSES: JHN 14:2-3, John 14:2-3, 1CO 15:51-52"
    )
    assert [c["reference"] for c in citations] == ["JHN 14:2-3", "1CO 15:51-52"]
    assert dropped == 0


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


def test_parse_verdicts_survives_an_empty_reason():
    """A verdict with no reason must not swallow the next line. Regression:
    a trailing \\s* in the pattern consumed the following VERDICT line, which
    made a FAILED test disappear from the report entirely."""
    verdicts = hermeneutics.parse_verdicts(
        "VERDICT: heart=pass —\n"
        "VERDICT: cross=fail — reintroduces sin-consciousness\n"
        "VERDICT: grace=pass — sins are not counted"
    )
    assert [v["test"] for v in verdicts] == ["heart", "cross", "grace"]
    assert [v["passed"] for v in verdicts] == [True, False, True]
    assert verdicts[0]["reason"] == ""


def test_parse_marker_reads_audience():
    assert hermeneutics.parse_marker("prose\nAUDIENCE: church", "AUDIENCE") == "church"


def test_parse_marker_missing_returns_none():
    assert hermeneutics.parse_marker("prose only", "AUDIENCE") is None


def test_parse_verdicts_keeps_the_first_of_a_repeated_test():
    # A model restating a test produced duplicate React keys; the first
    # verdict given for a test stands.
    verdicts = hermeneutics.parse_verdicts(
        "VERDICT: heart=fail — first\n"
        "VERDICT: cross=pass — fine\n"
        "VERDICT: heart=pass — restated\n"
        "VERDICT: grace=pass — fine"
    )
    assert [v["test"] for v in verdicts] == ["heart", "cross", "grace"]
    assert verdicts[0]["passed"] is False
    assert verdicts[0]["reason"] == "first"
