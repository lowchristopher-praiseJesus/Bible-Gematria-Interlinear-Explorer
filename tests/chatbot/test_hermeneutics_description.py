import pytest

from chatbot import hermeneutics


def test_parable_lookup_matches_the_full_name():
    assert hermeneutics.find_parable_reference("the parable of the ten virgins") == "MAT 25:1-13"


def test_parable_lookup_matches_a_bare_name():
    assert hermeneutics.find_parable_reference("ten virgins") == "MAT 25:1-13"


def test_parable_lookup_matches_digits_for_number_words():
    assert hermeneutics.find_parable_reference("the 10 virgins") == "MAT 25:1-13"


def test_parable_lookup_matches_inside_a_sentence():
    assert hermeneutics.find_parable_reference(
        "Could you run the prodigal son for me?"
    ) == "LUK 15:11-32"


def test_parable_lookup_ignores_an_unrelated_message():
    assert hermeneutics.find_parable_reference("what does grace mean?") is None


def test_parable_lookup_does_not_match_on_a_single_common_word():
    # "The Lost Sheep" and "The Lost Coin" both contain "lost"; one weak
    # token must not pick a parable arbitrarily.
    assert hermeneutics.find_parable_reference("I feel lost") is None


async def test_resolve_description_prefers_the_table_over_the_llm(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("the table should have answered without an LLM call")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)
    res = await hermeneutics.resolve_description("the ten virgins")
    assert res.reference == "MAT 25:1-13"
    assert res.source == "description"


async def test_resolve_description_falls_back_to_the_llm(monkeypatch):
    async def fake(system_prompt, user_prompt, *, max_tokens=64, **kwargs):
        return "Ephesians 6:10-18"

    monkeypatch.setattr(hermeneutics, "simple_completion", fake)
    res = await hermeneutics.resolve_description("the armour of God")
    assert res.reference == "EPH 6:10-18"
    assert res.source == "description"


async def test_resolve_description_retries_once_then_gives_up(monkeypatch):
    calls = []

    async def unparseable(system_prompt, user_prompt, *, max_tokens=64, **kwargs):
        calls.append(1)
        return "I'm not sure which passage you mean."

    monkeypatch.setattr(hermeneutics, "simple_completion", unparseable)
    res = await hermeneutics.resolve_description("something vague")
    assert res.reference is None
    assert res.source == "none"
    assert len(calls) == 2, "one retry, then give up"


async def test_resolve_description_never_guesses_a_random_verse(monkeypatch):
    async def empty(system_prompt, user_prompt, *, max_tokens=64, **kwargs):
        return ""

    monkeypatch.setattr(hermeneutics, "simple_completion", empty)
    # Unlike devotional.pick_verse_for_theme, which falls back to a random
    # verse: an eight-phase analysis of a passage the user did not ask about
    # is worse than asking them.
    res = await hermeneutics.resolve_description("???")
    assert res.reference is None
    assert res.source == "none"


async def test_resolve_passage_flags_a_described_passage(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("no LLM call expected")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)
    res = await hermeneutics.resolve_passage(
        "run the parable of the ten virgins", reference=None, history=None
    )
    assert res.reference == "MAT 25:1-13"
    assert res.source == "description"


async def test_resolve_passage_does_not_flag_an_explicit_reference():
    res = await hermeneutics.resolve_passage("run Romans 8:1", reference=None, history=None)
    assert res.reference == "ROM 8:1"
    assert res.source == "reference"


async def test_resolve_passage_prefers_an_explicit_reference_over_a_description(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("no LLM call expected")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)
    res = await hermeneutics.resolve_passage(
        "the parable of the ten virgins — actually, Matthew 25:1", reference=None, history=None
    )
    assert res.reference == "MAT 25:1"
    assert res.source == "reference"


async def test_resolve_passage_reports_nothing_found():
    res = await hermeneutics.resolve_passage("hello there", reference=None, history=[])
    assert res.reference is None
    assert res.source == "none"


# --- A claim is not a passage -------------------------------------------
#
# "Verify this claim — the patriarchs are raised with the Church" names no
# passage at all. Without this branch the LLM fallback quietly picks one
# verse and the mode analyses that instead, answering a question the user
# did not ask while looking authoritative doing it.

async def test_a_doctrinal_claim_is_classified_as_a_claim(monkeypatch):
    async def classifies(system_prompt, user_prompt, *, max_tokens=64, **kwargs):
        return "CLAIM: 1 Thessalonians 4:13-18"

    monkeypatch.setattr(hermeneutics, "simple_completion", classifies)
    res = await hermeneutics.resolve_passage(
        "Verify this claim - Patriarchs like Abraham and Moses will get their "
        "resurrected body the same time as Christ's church",
        reference=None, history=None,
    )
    assert res.source == "claim"
    assert res.reference == "1TH 4:13-18", "the bearing passage is offered, not run"


async def test_a_claim_with_no_suggested_passage_still_classifies(monkeypatch):
    async def bare_claim(system_prompt, user_prompt, *, max_tokens=64, **kwargs):
        return "CLAIM"

    monkeypatch.setattr(hermeneutics, "simple_completion", bare_claim)
    res = await hermeneutics.resolve_passage("Is the rapture pre-tribulation?", reference=None, history=None)
    assert res.source == "claim"
    assert res.reference is None


async def test_a_claim_that_cites_a_passage_runs_that_passage(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("an explicit reference needs no LLM call")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)
    res = await hermeneutics.resolve_passage(
        "Verify this claim from 1 Thess 4:16 — the patriarchs rise with the Church",
        reference=None, history=None,
    )
    assert res.source == "reference"
    assert res.reference == "1TH 4:16"


async def test_a_parable_request_is_never_classified_as_a_claim(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("the table answers before any classification")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)
    res = await hermeneutics.resolve_passage("the ten virgins", reference=None, history=None)
    assert res.source == "description"


@pytest.mark.parametrize("dash", ["‑", "–", "—", "−"])
async def test_a_range_written_with_a_unicode_dash_keeps_its_end_verse(monkeypatch, dash):
    # Models commonly emit "14:13‑21" with a non-breaking hyphen; parsing
    # that as MAT 14:13 would silently run one verse instead of the account.
    async def fake(system_prompt, user_prompt, *, max_tokens=64, **kwargs):
        return f"Matthew 14:13{dash}21"

    monkeypatch.setattr(hermeneutics, "simple_completion", fake)
    res = await hermeneutics.resolve_description("Jesus feeding the 5000")
    assert res.reference == "MAT 14:13-21"


async def test_the_classifier_leaves_room_for_a_reasoning_model(monkeypatch):
    # A reasoning model spends max_tokens on its reasoning before any
    # content; a tight budget comes back as an empty answer.
    budgets = []

    async def fake(system_prompt, user_prompt, *, max_tokens=64, **kwargs):
        budgets.append(max_tokens)
        return "Ephesians 6:10-18"

    monkeypatch.setattr(hermeneutics, "simple_completion", fake)
    await hermeneutics.resolve_description("the armour of God")
    assert budgets and budgets[0] >= 1024
