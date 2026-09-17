"""Passage resolution regressions. These exercise the real reference
parsers, the real parable table and Complete.db — only the LLM
(`simple_completion`) is ever faked."""

import pytest

from chatbot import hermeneutics


@pytest.fixture
def no_llm(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("no LLM call expected")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)


@pytest.fixture
def run_llm(monkeypatch):
    """A stub for every phase of a real (unmocked) run()."""
    prompts = []

    async def fake(system_prompt, user_prompt, *, max_tokens=2048, **kwargs):
        prompts.append({"system": system_prompt, "user": user_prompt, "max_tokens": max_tokens})
        if "PHASE 4" in system_prompt:
            return "Confirmed.\nWITNESSES: 1CO 15:51-52, JHN 14:2-3"
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Phase findings."

    async def empty_search(q):
        return {"results": []}

    monkeypatch.setattr(hermeneutics, "simple_completion", fake)
    monkeypatch.setattr(hermeneutics, "llm_unconfigured_error", lambda: None)
    monkeypatch.setattr(hermeneutics, "search_english", empty_search)
    return prompts


# --- C1: a typed range keeps its end verse --------------------------------

@pytest.mark.parametrize("message, expected", [
    ("Romans 8:1-4", "ROM 8:1-4"),
    ("run 1 Thessalonians 4:15-18", "1TH 4:15-18"),
    ("Rom 8:1-4", "ROM 8:1-4"),
    ("Run 1TH 4:13-18", "1TH 4:13-18"),
    ("Romans 8:1–4", "ROM 8:1-4"),
    ("now do 1 Thess 4:13", "1TH 4:13"),
])
async def test_a_typed_range_resolves_to_the_whole_range(no_llm, message, expected):
    res = await hermeneutics.resolve_passage(message, reference=None, history=None)
    assert res.reference == expected
    assert res.source == "reference"


async def test_a_bare_chapter_still_reaches_the_narrowing_reply(no_llm):
    res = await hermeneutics.resolve_passage("Genesis 1", reference=None, history=None)
    assert res.reference == "GEN 1"


async def test_the_claim_redirect_pill_runs_the_full_range(run_llm):
    events = [e async for e in hermeneutics.run(None, "Run 1TH 4:13-18", None)]
    final = events[-1]["result"]
    assert final["artifacts"][0]["params"]["reference"] == "1TH 4:13-18"


# --- C2: a stale reference never runs a passage the user didn't choose -----

async def test_history_is_not_a_reference_source(monkeypatch):
    # The mode's own replies say "for example Romans 8:1"; that must not
    # become the passage.
    async def none(*args, **kwargs):
        return "NONE"

    monkeypatch.setattr(hermeneutics, "simple_completion", none)
    history = [{"role": "assistant", "text": 'Give me a verse — for example "Romans 8:1".'}]
    res = await hermeneutics.resolve_passage("why?", reference=None, history=history)
    assert res.reference is None


async def test_a_named_parable_beats_the_session_reference(no_llm):
    res = await hermeneutics.resolve_passage(
        "actually, the prodigal son", reference="ROM 8:1", history=None
    )
    assert res.reference == "LUK 15:11-32"


async def test_the_claim_redirect_does_not_hand_back_a_session_reference(monkeypatch, run_llm):
    route_end = "claim, not a passage"
    message = "Verify this claim - the patriarchs rise with the Church"
    async def classify(*args, **kwargs):
        return "CLAIM: 1 Thessalonians 4:13-18"

    monkeypatch.setattr(hermeneutics, "simple_completion", classify)
    events = [e async for e in hermeneutics.run(None, message, None)]
    result = events[-1]["result"]
    assert result["route"].endswith(route_end)
    assert not (result.get("data") or {}).get("reference")


async def test_the_scope_refusal_does_not_hand_back_a_session_reference(run_llm):
    events = [e async for e in hermeneutics.run(None, "Genesis 1", None)]
    result = events[-1]["result"]
    assert "which part" in result["message"].lower()
    assert not (result.get("data") or {}).get("reference")
    assert result["data"]["scopeChapter"] == "GEN 1"


async def test_the_no_text_reply_does_not_hand_back_a_session_reference(run_llm):
    events = [e async for e in hermeneutics.run(None, "Matthew 14:900-905", None)]
    result = events[-1]["result"]
    assert result["route"].endswith("no text")
    assert not (result.get("data") or {}).get("reference")


async def test_verses_after_a_narrowing_reply_use_that_chapter(no_llm):
    res = await hermeneutics.resolve_passage(
        "verses 1-5", reference=None, history=None, scope_chapter="GEN 1"
    )
    assert res.reference == "GEN 1:1-5"
    assert res.source == "reference"


async def test_verses_after_a_narrowing_reply_run_rather_than_refuse_again(run_llm):
    events = [
        e async for e in hermeneutics.stream(None, "verses 1-5", None, scope_chapter="GEN 1")
    ]
    phases = [e for e in events if e["kind"] == "phase"]
    assert len(phases) == 8
    assert events[-1]["result"]["data"]["reference"] == "GEN 1:1-5"


async def test_bare_verses_with_no_chapter_known_do_not_invent_one(monkeypatch):
    async def none(*args, **kwargs):
        return "NONE"

    monkeypatch.setattr(hermeneutics, "simple_completion", none)
    res = await hermeneutics.resolve_passage("verses 1-5", reference=None, history=None)
    assert res.reference is None


# --- C3: claim markers wrapped in markdown ---------------------------------

@pytest.mark.parametrize("reply", [
    "`CLAIM: 1 Thessalonians 4:13-18`",
    "**CLAIM:** 1 Thessalonians 4:13-18",
    "Answer: CLAIM: 1TH 4:13-18",
    "claim: 1TH 4:13-18",
])
async def test_a_decorated_claim_marker_is_still_a_claim(monkeypatch, reply):
    async def classify(*args, **kwargs):
        return reply

    monkeypatch.setattr(hermeneutics, "simple_completion", classify)
    res = await hermeneutics.resolve_description("the patriarchs rise with the Church")
    assert res.source == "claim"
    assert res.reference == "1TH 4:13-18"


async def test_none_is_still_none(monkeypatch):
    async def none(*args, **kwargs):
        return "`NONE`"

    monkeypatch.setattr(hermeneutics, "simple_completion", none)
    res = await hermeneutics.resolve_description("something vague")
    assert res.source == "none"


# --- I2: the parable table must not hijack ordinary sentences --------------

@pytest.mark.parametrize("text", [
    "The rapture will come like a thief in the night",
    "Christ died only for his sheep",
    "the fool hath said there is no God",
    "we need to cast the net wider",
    "use your talents",
])
def test_an_ordinary_sentence_is_not_a_parable(text):
    assert hermeneutics.find_parable_reference(text) is None


@pytest.mark.parametrize("text, expected", [
    ("the good samaritan", "LUK 10:25-37"),
    ("the lost sheep", "LUK 15:3-7"),
    ("the parable of the sower", "MAT 13:3-9"),
    ("the parable of the thief in the night", "MAT 24:42-44"),
])
def test_a_named_or_explicit_parable_still_matches(text, expected):
    assert hermeneutics.find_parable_reference(text) == expected


async def test_a_claim_using_a_parable_phrase_reaches_the_classifier(monkeypatch):
    async def classify(*args, **kwargs):
        return "CLAIM: 1 Thessalonians 5:1-4"

    monkeypatch.setattr(hermeneutics, "simple_completion", classify)
    res = await hermeneutics.resolve_passage(
        "The rapture will come like a thief in the night", reference=None, history=None
    )
    assert res.source == "claim"


# --- I3: follow-up routing names the same passage run() uses ---------------

DIGEST = "1. Context: addressed to the Church\nFinal verified interpretation: no condemnation."


@pytest.mark.parametrize("message, expected", [
    ("now do the prodigal son", "LUK 15:11-32"),
    ("now do 1 Thess 4:13", "1TH 4:13"),
    ("now run Romans 8:1-4", "ROM 8:1-4"),
])
async def test_a_new_passage_after_a_run_runs_that_passage(run_llm, message, expected):
    events = [
        e async for e in hermeneutics.stream("ROM 8:1", message, None, run_digest=DIGEST)
    ]
    phases = [e for e in events if e["kind"] == "phase" and e["phase"]["index"] > 0]
    assert len(phases) == 8, "a newly named passage runs, not a digest answer"
    assert events[-1]["result"]["data"]["reference"] == expected


async def test_the_same_passage_after_a_run_answers_from_the_digest(monkeypatch, run_llm):
    async def fake_call(message, research_data, conversation_history=None,
                        page_context=None, system_prompt=None):
        return {"type": "chat", "message": "from digest", "data": None}

    async def no_follow_ups(*args, **kwargs):
        return []

    monkeypatch.setattr(hermeneutics, "call_ollama_with_context", fake_call)
    monkeypatch.setattr(hermeneutics, "generate_llm_follow_ups", no_follow_ups)
    result = await hermeneutics.answer("ROM 8:1-4", "what about Romans 8:1-4?", None, run_digest=DIGEST)
    assert result["message"] == "from digest"
