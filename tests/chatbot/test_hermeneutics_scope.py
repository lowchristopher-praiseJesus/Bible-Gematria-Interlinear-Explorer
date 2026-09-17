import pytest

from chatbot import hermeneutics


def test_parse_scope_single_verse():
    assert hermeneutics.parse_scope("ROM 8:1") == ("ROM", 8, 1, 1)


def test_parse_scope_range():
    assert hermeneutics.parse_scope("1TH 4:15-18") == ("1TH", 4, 15, 18)


def test_parse_scope_allows_the_longest_curated_parable():
    # The Prodigal Son, Luke 15:11-32 — 22 verses, the corpus maximum.
    assert hermeneutics.parse_scope("LUK 15:11-32") == ("LUK", 15, 11, 32)


def test_parse_scope_allows_a_twenty_five_verse_range():
    assert hermeneutics.parse_scope("ROM 8:1-25") == ("ROM", 8, 1, 25)


def test_parse_scope_rejects_a_twenty_six_verse_range():
    with pytest.raises(hermeneutics.ScopeError) as exc:
        hermeneutics.parse_scope("ROM 8:1-26")
    assert "26 verses" in exc.value.message


def test_every_curated_parable_is_within_the_cap():
    """The cap and the parable corpus are two settings that can silently
    collide — this is the guard that they have not."""
    from chatbot.data.parables import PARABLES
    from chatbot.router import _resolve_verse_reference

    for parable in PARABLES:
        resolved = _resolve_verse_reference(parable["reference"])
        assert resolved, f"{parable['id']}: reference does not resolve"
        hermeneutics.parse_scope(resolved)  # raises ScopeError if over


def test_parse_scope_rejects_a_bare_chapter_and_says_how_long_it_is():
    with pytest.raises(hermeneutics.ScopeError) as exc:
        hermeneutics.parse_scope("GEN 1")
    assert "31 verses" in exc.value.message
    assert "which part" in exc.value.message.lower()


def test_scope_error_message_is_user_facing_not_a_stack_trace():
    with pytest.raises(hermeneutics.ScopeError) as exc:
        hermeneutics.parse_scope("GEN 1")
    assert not exc.value.message.startswith("Traceback")


async def test_resolve_passage_prefers_a_reference_named_this_turn():
    resolved = await hermeneutics.resolve_passage(
        "Actually, run Romans 8:1", reference="1TH 4:15-18", history=None
    )
    assert resolved.reference == "ROM 8:1"


async def test_resolve_passage_falls_back_to_the_session_reference():
    resolved = await hermeneutics.resolve_passage(
        "what about the covenant here?", reference="1TH 4:15-18", history=None
    )
    assert resolved.reference == "1TH 4:15-18"


async def test_resolve_passage_does_not_fall_back_to_history(monkeypatch):
    # History carries this mode's own example references ("for example
    # Romans 8:1"); the primer puts a chosen passage into the session
    # reference instead, so history is never read for one.
    async def none(*args, **kwargs):
        return "NONE"

    monkeypatch.setattr(hermeneutics, "simple_completion", none)
    history = [{"role": "user", "text": "Let's look at John 3:16"}]
    resolved = await hermeneutics.resolve_passage("go on", reference=None, history=history)
    assert resolved.reference is None


async def test_resolve_passage_returns_none_when_no_passage_anywhere():
    result = await hermeneutics.resolve_passage("hello", reference=None, history=[])
    assert result.reference is None
