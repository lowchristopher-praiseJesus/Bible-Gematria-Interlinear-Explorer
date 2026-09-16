import pytest

from chatbot import hermeneutics


@pytest.fixture
def fake_llm(monkeypatch):
    """Answers every phase with a marker-bearing stub, so marker parsing is
    exercised without a live provider."""
    calls = []

    async def fake_simple_completion(system_prompt, user_prompt, *, max_tokens=2048):
        calls.append({"system": system_prompt, "user": user_prompt})
        if "PHASE 1" in system_prompt:
            return "Context findings.\nAUDIENCE: church"
        if "PHASE 3" in system_prompt:
            return "Paul speaks by revelation.\nSPEAKER: prophet"
        if "PHASE 4" in system_prompt:
            return "Confirmed.\nWITNESSES: 1CO 15:51-52, JHN 14:2-3"
        if "PHASE 8" in system_prompt:
            return (
                "Checked.\n"
                "VERDICT: heart=pass — it comforts\n"
                "VERDICT: cross=pass — it rests on the finished work\n"
                "VERDICT: grace=pass — sins are not counted"
            )
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "This passage promises the resurrection and rapture of every believer."
        return "Phase findings."

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"text of {reference}"}

    monkeypatch.setattr(hermeneutics, "simple_completion", fake_simple_completion)
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", fake_fetch)
    monkeypatch.setattr(hermeneutics, "llm_unconfigured_error", lambda: None)
    monkeypatch.setattr(hermeneutics, "search_english", lambda q: _empty_search())
    return calls


async def _empty_search():
    return {"results": []}


async def _collect(reference, message="run it", history=None):
    return [event async for event in hermeneutics.run(reference, message, history)]


async def test_run_emits_eight_phases_in_order_then_a_final(fake_llm):
    events = await _collect("1TH 4:15-18")
    phases = [e["phase"] for e in events if e["kind"] == "phase"]
    assert [p["index"] for p in phases] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert events[-1]["kind"] == "final"


async def test_run_final_carries_the_synthesis_and_an_artifact(fake_llm):
    events = await _collect("1TH 4:15-18")
    result = events[-1]["result"]
    assert "resurrection and rapture" in result["message"]
    artifact = result["artifacts"][0]
    assert artifact["type"] == "hermeneutics_report"
    assert artifact["params"]["reference"] == "1TH 4:15-18"
    assert len(artifact["params"]["phases"]) == 8


async def test_a_described_passage_is_echoed_back_before_any_phase(monkeypatch, fake_llm):
    async def from_table(text):
        return hermeneutics.Resolution("MAT 25:1-13", "description")

    monkeypatch.setattr(hermeneutics, "resolve_description", from_table)
    events = await _collect(None, message="run the parable of the ten virgins")
    first = events[0]["phase"]
    assert first["index"] == 0
    assert "MAT 25:1-13" in first["markdown"]
    assert events[1]["phase"]["index"] == 1, "the notice precedes phase 1"


async def test_the_echo_notice_is_not_part_of_the_report(monkeypatch, fake_llm):
    async def from_table(text):
        return hermeneutics.Resolution("MAT 25:1-13", "description")

    monkeypatch.setattr(hermeneutics, "resolve_description", from_table)
    events = await _collect(None, message="run the parable of the ten virgins")
    report_phases = events[-1]["result"]["artifacts"][0]["params"]["phases"]
    assert [p["index"] for p in report_phases] == [1, 2, 3, 4, 5, 6, 7, 8]


async def test_an_explicit_reference_is_not_echoed_back(fake_llm):
    events = await _collect("1TH 4:15-18")
    assert events[0]["phase"]["index"] == 1, "no notice for a reference the user typed"


async def test_run_carries_audience_and_speaker_forward(fake_llm):
    events = await _collect("1TH 4:15-18")
    phases = {e["phase"]["index"]: e["phase"] for e in events if e["kind"] == "phase"}
    assert phases[1]["audience"] == "church"
    assert phases[3]["speaker"] == "prophet"


async def test_a_phase_without_its_marker_carries_none(monkeypatch, fake_llm):
    async def unmarked(system_prompt, user_prompt, *, max_tokens=2048):
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Prose with no marker line."

    monkeypatch.setattr(hermeneutics, "simple_completion", unmarked)
    events = await _collect("1TH 4:15-18")
    phase1 = next(e["phase"] for e in events if e["kind"] == "phase" and e["phase"]["index"] == 1)
    assert phase1["audience"] is None
    assert phase1["status"] == "done", "a missing marker degrades to prose, it does not fail"


async def test_run_attaches_verified_citations_to_phase_four(fake_llm):
    events = await _collect("1TH 4:15-18")
    phase4 = next(e["phase"] for e in events if e["kind"] == "phase" and e["phase"]["index"] == 4)
    assert [c["reference"] for c in phase4["citations"]] == ["1CO 15:51-52", "JHN 14:2-3"]


async def test_run_notes_when_fewer_than_two_witnesses_verify(monkeypatch, fake_llm):
    async def one_witness(system_prompt, user_prompt, *, max_tokens=2048):
        if "PHASE 4" in system_prompt:
            return "Only one.\nWITNESSES: 1CO 15:51-52"
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Phase findings."

    monkeypatch.setattr(hermeneutics, "simple_completion", one_witness)
    events = await _collect("1TH 4:15-18")
    phase4 = next(e["phase"] for e in events if e["kind"] == "phase" and e["phase"]["index"] == 4)
    assert "fewer than two" in phase4["markdown"].lower()


async def test_run_attaches_verdicts_to_phase_eight(fake_llm):
    events = await _collect("1TH 4:15-18")
    phase8 = next(e["phase"] for e in events if e["kind"] == "phase" and e["phase"]["index"] == 8)
    assert [v["test"] for v in phase8["verdicts"]] == ["heart", "cross", "grace"]


async def test_a_failed_verdict_is_disclosed_and_never_retried(monkeypatch, fake_llm):
    async def failing(system_prompt, user_prompt, *, max_tokens=2048):
        if "PHASE 8" in system_prompt:
            return (
                "VERDICT: heart=pass — fine\n"
                "VERDICT: cross=fail — reintroduces sin-consciousness\n"
                "VERDICT: grace=pass — fine"
            )
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Phase findings."

    monkeypatch.setattr(hermeneutics, "simple_completion", failing)
    events = await _collect("1TH 4:15-18")
    phase8s = [e for e in events if e["kind"] == "phase" and e["phase"]["index"] == 8]
    assert len(phase8s) == 1, "Phase 8 must run exactly once — no retry on failure"
    assert events[-1]["kind"] == "final", "a failed test must not suppress the report"
    assert events[-1]["result"]["data"]["hasFailedVerdict"] is True


async def test_an_erroring_phase_does_not_abort_the_run(monkeypatch, fake_llm):
    async def phase7_explodes(system_prompt, user_prompt, *, max_tokens=2048):
        if "PHASE 7" in system_prompt:
            raise RuntimeError("provider timeout")
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Phase findings."

    monkeypatch.setattr(hermeneutics, "simple_completion", phase7_explodes)
    events = await _collect("1TH 4:15-18")
    phases = {e["phase"]["index"]: e["phase"] for e in events if e["kind"] == "phase"}
    assert phases[7]["status"] == "error"
    assert phases[8]["status"] == "done", "phase 8 must still run after phase 7 failed"
    assert events[-1]["kind"] == "final"


async def test_a_claim_is_redirected_not_analysed(monkeypatch, fake_llm):
    """The failure this guards against: "verify this claim ..." silently
    becoming an eight-phase report about one verse the user never named."""
    async def classify(text):
        return hermeneutics.Resolution("1TH 4:13-18", "claim")

    monkeypatch.setattr(hermeneutics, "resolve_description", classify)
    events = await _collect(None, message="Verify this claim - the patriarchs rise with the Church")
    assert len(events) == 1, "no phases run for a claim"
    result = events[0]["result"]
    assert "claim to test rather than a passage" in result["message"]
    assert "1TH 4:13-18" in result["message"]
    assert result["follow_up_questions"] == ["Run 1TH 4:13-18"]


async def test_a_claim_with_no_bearing_passage_asks_for_one(monkeypatch, fake_llm):
    async def classify(text):
        return hermeneutics.Resolution(None, "claim")

    monkeypatch.setattr(hermeneutics, "resolve_description", classify)
    events = await _collect(None, message="Is the rapture pre-tribulation?")
    assert len(events) == 1
    assert "Which passage" in events[0]["result"]["message"]
    assert events[0]["result"]["follow_up_questions"] == []


async def test_a_claim_citing_a_passage_runs_it(fake_llm):
    events = await _collect(
        None, message="Verify this claim from 1 Thess 4:16 — the patriarchs rise with the Church"
    )
    phases = [e for e in events if e["kind"] == "phase"]
    assert len(phases) == 8, "an explicit reference wins; the run proceeds"


async def test_run_refuses_a_passage_with_no_text(monkeypatch, fake_llm):
    """An LLM-resolved description, or a typo'd reference, can name a
    passage Complete.db has no text for. Running the phases on an empty
    string would yield a confident report about nothing."""
    async def empty_passage(usfm, chapter, start, end):
        return ""

    monkeypatch.setattr(hermeneutics, "passage_text_for", empty_passage)
    events = await _collect("MAT 14:900-905")
    assert len(events) == 1
    assert events[0]["kind"] == "final"
    assert "couldn't find any text" in events[0]["result"]["message"]


async def test_an_empty_passage_is_caught_before_the_echo_back(monkeypatch, fake_llm):
    async def empty_passage(usfm, chapter, start, end):
        return ""

    async def from_llm(text):
        return hermeneutics.Resolution("MAT 14:900-905", "description")

    monkeypatch.setattr(hermeneutics, "passage_text_for", empty_passage)
    monkeypatch.setattr(hermeneutics, "resolve_description", from_llm)
    events = await _collect(None, message="jesus feeding the 5000")
    assert len(events) == 1, "no 'running it now' notice for a passage that cannot run"
    assert "read your description wrong" in events[0]["result"]["message"]


async def test_a_whitespace_only_passage_counts_as_empty(monkeypatch, fake_llm):
    async def blank(usfm, chapter, start, end):
        return "   \n  "

    monkeypatch.setattr(hermeneutics, "passage_text_for", blank)
    events = await _collect("ROM 8:1")
    assert len(events) == 1
    assert events[0]["result"]["route"].endswith("no text")


async def test_run_refuses_a_chapter_with_a_narrowing_reply(fake_llm):
    events = await _collect("GEN 1")
    assert len(events) == 1
    assert events[0]["kind"] == "final"
    assert "which part" in events[0]["result"]["message"].lower()


async def test_run_fails_fast_when_the_llm_is_unconfigured(monkeypatch, fake_llm):
    monkeypatch.setattr(hermeneutics, "llm_unconfigured_error", lambda: "no key")
    events = await _collect("1TH 4:15-18")
    assert len(events) == 1
    assert events[0]["result"]["type"] == "error"


async def test_run_asks_for_a_passage_when_none_is_known(fake_llm):
    events = await _collect(None, message="hello", history=[])
    assert len(events) == 1
    assert "passage" in events[0]["result"]["message"].lower()
