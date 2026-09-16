import pytest

from chatbot import hermeneutics

DIGEST = "1. Context: addressed to the Church\nFinal verified interpretation: the rapture."


@pytest.fixture
def no_rerun(monkeypatch):
    """Fails the test loudly if the pipeline runs when it shouldn't."""
    async def exploding_run(*args, **kwargs):
        raise AssertionError("the pipeline must not re-run on a follow-up turn")
        yield  # pragma: no cover — makes this an async generator

    monkeypatch.setattr(hermeneutics, "run", exploding_run)


@pytest.fixture
def fake_chat(monkeypatch):
    captured = {}

    async def fake_call(message, research_data, conversation_history=None,
                        page_context=None, system_prompt=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "Because Paul writes to the Church.", "data": None}

    async def no_follow_ups(user_message, assistant_message, page_context=None):
        return []

    monkeypatch.setattr(hermeneutics, "call_ollama_with_context", fake_call)
    monkeypatch.setattr(hermeneutics, "generate_llm_follow_ups", no_follow_ups)
    return captured


async def test_followup_answers_from_the_digest_without_rerunning(no_rerun, fake_chat):
    result = await hermeneutics.answer(
        "1TH 4:15-18", "why does the audience matter?", history=None, run_digest=DIGEST
    )
    assert result["type"] == "chat"
    assert "rapture" in fake_chat["research_data"]


async def test_followup_route_names_the_digest_path(no_rerun, fake_chat):
    result = await hermeneutics.answer(
        "1TH 4:15-18", "say more", history=None, run_digest=DIGEST
    )
    assert "digest" in result["route"]


async def test_a_new_passage_starts_a_fresh_run(monkeypatch, fake_chat):
    ran = {}

    async def fake_run(reference, message, history=None):
        ran["reference"] = reference
        yield {"kind": "final", "result": {"type": "chat", "message": "ran", "data": None}}

    monkeypatch.setattr(hermeneutics, "run", fake_run)
    result = await hermeneutics.answer(
        "1TH 4:15-18", "now run Romans 8:1", history=None, run_digest=DIGEST
    )
    assert result["message"] == "ran"


async def test_a_newly_named_parable_starts_a_fresh_run(monkeypatch, fake_chat):
    ran = {}

    async def fake_run(reference, message, history=None):
        ran["called"] = True
        yield {"kind": "final", "result": {"type": "chat", "message": "ran", "data": None}}

    monkeypatch.setattr(hermeneutics, "run", fake_run)
    result = await hermeneutics.answer(
        "1TH 4:15-18", "now do the prodigal son", history=None, run_digest=DIGEST
    )
    assert ran.get("called"), "a parable named by description is a new passage"
    assert result["message"] == "ran"


async def test_a_vague_question_stays_on_the_digest(no_rerun, fake_chat):
    # Only the table is consulted here, never the LLM fallback — a vague
    # follow-up is a question about the passage in hand.
    result = await hermeneutics.answer(
        "1TH 4:15-18", "what about the bit with the trumpet?", history=None, run_digest=DIGEST
    )
    assert result["type"] == "chat"


async def test_no_digest_means_run_the_pipeline(monkeypatch, fake_chat):
    async def fake_run(reference, message, history=None):
        yield {"kind": "final", "result": {"type": "chat", "message": "ran", "data": None}}

    monkeypatch.setattr(hermeneutics, "run", fake_run)
    result = await hermeneutics.answer("1TH 4:15-18", "go", history=None, run_digest=None)
    assert result["message"] == "ran"


async def test_answer_returns_the_last_final_event(monkeypatch, fake_chat):
    async def fake_run(reference, message, history=None):
        yield {"kind": "phase", "phase": {"index": 1, "title": "t", "status": "done", "markdown": ""}}
        yield {"kind": "final", "result": {"type": "chat", "message": "done", "data": None}}

    monkeypatch.setattr(hermeneutics, "run", fake_run)
    result = await hermeneutics.answer("ROM 8:1", "go", history=None)
    assert result["message"] == "done"
