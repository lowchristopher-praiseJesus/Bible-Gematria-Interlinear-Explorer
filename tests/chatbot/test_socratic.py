import pytest

from chatbot import socratic


@pytest.fixture(autouse=True)
def _no_llm_follow_ups(monkeypatch):
    """Stub the follow-up-question LLM call to a fast no-op by default, so
    tests that don't care about follow-ups never depend on a real LLM
    provider being reachable. Tests exercising follow-up behavior override
    this per-test."""
    async def fake(user_message, assistant_message, page_context=None):
        return []

    monkeypatch.setattr(socratic, "generate_llm_follow_ups", fake)


def test_system_prompt_requires_answering_direct_factual_questions():
    """Regression for a reported bug: the primer's and LLM-generated
    follow-up chips ("What's the historical context here?", "Who wrote
    Psalm 7?") are direct factual questions — clicking them must get an
    actual answer, not another Socratic question deflecting the click.
    Live-verified against the real model; this just guards the instruction
    itself from being edited away silently."""
    prompt = socratic.SOCRATIC_SYSTEM_PROMPT.lower()
    assert "factual question" in prompt
    assert "never deflect a direct question" in prompt


def test_system_prompt_aims_questions_toward_who_god_is():
    """The user wants Socratic questions to ultimately serve knowing God's
    character/nature, not just literary structure for its own sake — but
    only when the passage naturally supports it (not forced onto every
    verse, e.g. a genealogy). Live-verified against the real model; this
    guards the instruction itself from being edited away silently."""
    prompt = socratic.SOCRATIC_SYSTEM_PROMPT.lower()
    assert "who god is" in prompt
    assert "character" in prompt and "nature" in prompt
    assert "forcing a theological angle" in prompt


def test_system_prompt_requires_affirming_a_correct_answer():
    """Regression for a reported bug: the user gave a substantively correct,
    thoughtful answer and the assistant just asked another question without
    any acknowledgment, reading as if it hadn't listened. Live-verified
    against the real model; this guards the instruction itself from being
    edited away silently."""
    prompt = socratic.SOCRATIC_SYSTEM_PROMPT.lower()
    assert "say so briefly first" in prompt
    assert "never silently move on" in prompt


def test_system_prompt_requires_progressing_past_an_answered_point():
    """Regression for a reported bug: affirming a correct answer ("Good
    insight.") and then re-asking essentially the same question in
    different words still reads as ignoring the user — the conversation
    needs to move to a genuinely new angle, not just add a verbal nod on
    top of the same repeated question. Live-verified against the real
    model; this guards the instruction itself from being edited away
    silently."""
    prompt = socratic.SOCRATIC_SYSTEM_PROMPT.lower()
    assert "genuinely new angle" in prompt
    assert "never re-ask essentially the same question" in prompt


@pytest.mark.parametrize(
    "message",
    [
        "I don't know",
        "i dont know",
        "I'm stuck",
        "im stuck",
        "Give me a hint.",
        "just tell me",
        "Tell me",
        "What's the answer?",
        "IDK",
    ],
)
def test_is_stuck_signal_recognizes_give_up_phrases(message):
    assert socratic._is_stuck_signal(message)


@pytest.mark.parametrize(
    "message",
    [
        "what stands out?",
        "I think it's about God's mercy",
        "Let's look at John 3:16",
        "What's the historical context here?",
    ],
)
def test_is_stuck_signal_ignores_ordinary_turns(message):
    assert not socratic._is_stuck_signal(message)


@pytest.mark.asyncio
async def test_answer_forces_direct_answer_on_stuck_signal(monkeypatch):
    """Regression for a reported bug: on a real conversation (GEN 3:21),
    the model kept ignoring an exact "I don't know" / "Tell me" and just
    kept asking rephrased versions of its own question — the persona
    instruction alone wasn't reliable, so a stuck signal must now force an
    explicit per-turn override onto the system prompt sent to the LLM."""
    captured = {}

    async def fake_fetch_verse(reference, languages=None):
        return {"eng-KJV": "Unto Adam also and to his wife did the LORD God make coats of skins, and clothed them."}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        captured["system_prompt"] = system_prompt
        return {"type": "chat", "message": "God clothed them out of care despite their sin.", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    await socratic.answer("GEN 3:21", "I don't know")

    assert captured["system_prompt"] != socratic.SOCRATIC_SYSTEM_PROMPT
    assert captured["system_prompt"].startswith(socratic.SOCRATIC_SYSTEM_PROMPT)
    assert "do not ask another question" in captured["system_prompt"].lower()


@pytest.mark.asyncio
async def test_answer_does_not_force_override_on_ordinary_turn(monkeypatch):
    captured = {}

    async def fake_fetch_verse(reference, languages=None):
        return {"eng-KJV": "text"}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        captured["system_prompt"] = system_prompt
        return {"type": "chat", "message": "A question.", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    await socratic.answer("GEN 3:21", "what stands out to you first?")

    assert captured["system_prompt"] == socratic.SOCRATIC_SYSTEM_PROMPT


@pytest.mark.asyncio
async def test_answer_grounds_on_explicit_reference(monkeypatch):
    captured = {}

    async def fake_fetch_verse(reference, languages=None):
        assert reference == "JHN 3:16"
        return {"eng-KJV": "For God so loved the world..."}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        captured["message"] = message
        captured["research_data"] = research_data
        captured["system_prompt"] = system_prompt
        return {"type": "chat", "message": "Why does John open this way?", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(
        socratic,
        "get_book_context",
        lambda usfm: {
            "book": "JHN", "book_name": "John",
            "sections": {"literary_context": "Part of the Fourth Gospel's prologue.", "immediate_purpose": None},
        },
    )
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await socratic.answer("JHN 3:16", "what stands out?")

    assert captured["message"] == "what stands out?"
    assert "For God so loved the world..." in captured["research_data"]
    assert "Part of the Fourth Gospel's prologue." in captured["research_data"]
    assert captured["system_prompt"] == socratic.SOCRATIC_SYSTEM_PROMPT
    assert result["message"] == "Why does John open this way?"
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "JHN 3:16"
    assert result["data"]["translations"] == {"eng-KJV": "For God so loved the world..."}


@pytest.mark.asyncio
async def test_answer_no_reference_and_none_detected_prompts_for_one(monkeypatch):
    captured = {}

    async def fake_fetch_verse(reference, languages=None):
        raise AssertionError("should not fetch a verse when no reference is known")

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "What passage would you like to dig into?", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await socratic.answer(None, "tell me about faith")

    assert "no passage" in captured["research_data"].lower()
    assert result["data"] == {"reference": None}


@pytest.mark.asyncio
async def test_answer_detects_reference_embedded_in_freeform_message(monkeypatch):
    captured = {}

    async def fake_fetch_verse(reference, languages=None):
        captured["fetched_reference"] = reference
        return {"eng-KJV": "For God so loved the world..."}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        return {"type": "chat", "message": "ok", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await socratic.answer(None, "Let's look at John 3:16")

    assert captured["fetched_reference"] == "JHN 3:16"
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "JHN 3:16"


@pytest.mark.asyncio
async def test_answer_naming_a_new_passage_overrides_the_persisted_reference(monkeypatch):
    """The frontend now persists whatever reference a turn resolved to into
    mode_params, so `reference` here is normally last turn's passage, not
    necessarily this one — a passage named explicitly in the *current*
    message (switching mid-session) must win over that stale value."""
    captured = {}

    async def fake_fetch_verse(reference, languages=None):
        captured["fetched_reference"] = reference
        return {"eng-KJV": "For God so loved the world..."}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        return {"type": "chat", "message": "ok", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await socratic.answer("MAT 27:31", "Let's switch to John 3:16 instead")

    assert captured["fetched_reference"] == "JHN 3:16"
    assert result["data"]["reference"] == "JHN 3:16"


@pytest.mark.asyncio
async def test_answer_falls_back_to_reference_from_history_when_none_given(monkeypatch):
    """Regression for the "context gets lost" bug: the frontend never
    writes a primer-resolved reference back into mode_params, so a later
    turn arrives with reference=None and a message with no verse in it
    ("I'm stuck — give me a hint."). The passage named earlier in the
    conversation's own history must still ground the turn instead of the
    LLM being told no passage has been named."""
    captured = {}

    async def fake_fetch_verse(reference, languages=None):
        captured["fetched_reference"] = reference
        return {"eng-KJV": "Fear ye not therefore, ye are of more value than many sparrows."}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "What made you notice that first?", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    history = [
        {"role": "user", "text": "🤔 Socratic Study"},
        {"role": "assistant", "text": "Name a passage you want to interrogate, or just start typing what's on your mind."},
        {"role": "assistant", "text": "**MAT 10:31** — \"Fear ye not therefore, ye are of more value than many sparrows.\"\n\nBefore I say anything about it — what do you notice first?"},
    ]

    result = await socratic.answer(None, "I'm stuck — give me a hint.", conversation_history=history)

    assert captured["fetched_reference"] == "MAT 10:31"
    assert "no passage" not in captured["research_data"].lower()
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "MAT 10:31"


@pytest.mark.asyncio
async def test_answer_range_reference_has_no_single_verse_box(monkeypatch):
    """A verse range has no single-verse translations dict, so the turn
    stays a plain chat response (no verse box) even though a reference is
    known."""
    async def fake_fetch_verse(reference, languages=None):
        raise AssertionError("a range should never hit the single-verse fetch path")

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        return {"type": "chat", "message": "ok", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await socratic.answer("1TH 4:13-18", "what stands out?")

    assert result["type"] == "chat"
    assert result["data"] == {"reference": "1TH 4:13-18"}


@pytest.mark.asyncio
async def test_answer_missing_book_context_falls_back_to_verse_text_only(monkeypatch):
    captured = {}

    async def fake_fetch_verse(reference, languages=None):
        return {"eng-KJV": "In the beginning God created the heaven and the earth."}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "ok", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    await socratic.answer("GEN 1:1", "what stands out?")

    assert "In the beginning God created" in captured["research_data"]


@pytest.mark.asyncio
async def test_answer_uses_llm_generated_follow_ups(monkeypatch):
    async def fake_fetch_verse(reference, languages=None):
        return {"eng-KJV": "text"}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        return {"type": "chat", "message": "A question.", "data": None}

    async def fake_llm_follow_ups(user_message, assistant_message, page_context=None):
        return ["Why does this matter here?"]

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)
    monkeypatch.setattr(socratic, "generate_llm_follow_ups", fake_llm_follow_ups)

    result = await socratic.answer("GEN 1:1", "what stands out?")

    assert result["follow_up_questions"] == ["Why does this matter here?"]


@pytest.mark.asyncio
async def test_answer_leaves_follow_ups_unset_when_llm_gives_none(monkeypatch):
    async def fake_fetch_verse(reference, languages=None):
        return {"eng-KJV": "text"}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, system_prompt=None):
        return {"type": "chat", "message": "A question.", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await socratic.answer("GEN 1:1", "what stands out?")

    assert "follow_up_questions" not in result


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Gen 1", "GEN 1"),
        ("gen 1", "GEN 1"),
        ("Psalm 23", "PSA 23"),
        ("Let's look at Genesis 1", "GEN 1"),
        ("1 John 4", "1JN 4"),
    ],
)
def test_detect_reference_recognizes_chapter_only(text, expected):
    assert socratic._detect_reference(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "God is 3 in 1",
        "I have 2 ideas about this",
        "the numbers 7 and 40 recur",
        "what stands out?",
    ],
)
def test_detect_reference_ignores_non_references(text):
    assert socratic._detect_reference(text) is None


def _chapter_stubs(monkeypatch, captured):
    async def fake_fetch_verse(reference, languages=None):
        raise AssertionError("a bare chapter can't go through the single-verse fetch path")

    async def fake_list_passage_verses(book_name, chapter, start_verse=None, end_verse=None):
        captured["args"] = (book_name, chapter)
        return [
            {"vnum": 1, "kjv": "In the beginning God created the heaven and the earth."},
            {"vnum": 3, "kjv": "And God said, Let there be light: and there was light."},
        ]

    async def fake_call(message, research_data, conversation_history=None, system_prompt=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "What does God's speaking reveal about Him?", "data": None}

    monkeypatch.setattr(socratic, "fetch_verse_translations", fake_fetch_verse)
    monkeypatch.setattr(socratic, "list_passage_verses", fake_list_passage_verses)
    monkeypatch.setattr(socratic, "get_book_context", lambda usfm: None)
    monkeypatch.setattr(socratic, "call_ollama_with_context", fake_call)


@pytest.mark.asyncio
async def test_answer_grounds_on_chapter_only_reference(monkeypatch):
    captured = {}
    _chapter_stubs(monkeypatch, captured)

    result = await socratic.answer(None, "Gen 1")

    assert captured["args"] == ("Genesis", 1)
    assert "In the beginning God created" in captured["research_data"]
    assert "no passage" not in captured["research_data"].lower()
    assert result["type"] == "chat"
    assert result["data"] == {"reference": "GEN 1"}
    assert result["artifacts"][0]["type"] == "chapter"


@pytest.mark.asyncio
async def test_answer_recovers_chapter_only_reference_from_history(monkeypatch):
    """Regression for a reported bug: the user typed "Gen 1", then answered
    the first question — but a bare chapter was never recognized, so the
    next turn told the model no passage had been named and it asked the
    user to pick a passage instead of affirming their answer."""
    captured = {}
    _chapter_stubs(monkeypatch, captured)
    history = [
        {"role": "user", "text": "Gen 1"},
        {"role": "assistant", "text": "What does the way God creates the world reveal about His character?"},
    ]

    result = await socratic.answer(
        None,
        "God is an orderly God and he only needs to speak and creation is done",
        conversation_history=history,
    )

    assert "no passage" not in captured["research_data"].lower()
    assert result["data"] == {"reference": "GEN 1"}
