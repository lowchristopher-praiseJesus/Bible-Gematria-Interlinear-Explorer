from chatbot.hermeneutics_phases import PHASES, SYNTHESIS_PROMPT


def test_there_are_eight_phases_in_order():
    assert [p.index for p in PHASES] == [1, 2, 3, 4, 5, 6, 7, 8]


def test_phase_titles_match_the_methodology():
    titles = " | ".join(p.title.lower() for p in PHASES)
    for expected in ("context", "semantic", "record", "witness", "priority",
                     "covenant", "typolog", "validation"):
        assert expected in titles


def test_grounded_phases_are_two_four_and_seven():
    grounded = {p.index: p.grounding for p in PHASES}
    assert grounded[1] == "book_context"
    assert grounded[2] == "lexical"
    assert grounded[4] == "witnesses"
    assert grounded[7] == "roots"
    assert grounded[3] == grounded[5] == grounded[6] == grounded[8] == "none"


def test_phase_one_asks_for_the_eight_point_scan_and_audience():
    prompt = PHASES[0].system_prompt.lower()
    assert "by whom" in prompt and "to whom" in prompt
    assert "audience:" in prompt


def test_phase_three_distinguishes_record_from_truth():
    prompt = PHASES[2].system_prompt.lower()
    assert "records lies" in prompt or "faithfully records" in prompt
    assert "speaker:" in prompt


def test_phase_four_requires_two_or_three_witnesses():
    prompt = PHASES[3].system_prompt.lower()
    assert "two or three" in prompt
    assert "witnesses:" in prompt


def test_phase_eight_names_all_three_tests_and_forbids_rewriting():
    prompt = PHASES[7].system_prompt.lower()
    assert "heart" in prompt and "cross test" in prompt and "grace test" in prompt
    assert "verdict:" in prompt


def test_every_phase_has_a_token_budget():
    assert all(p.max_tokens > 0 for p in PHASES)


def test_synthesis_prompt_asks_for_the_final_interpretation():
    assert "final verified interpretation" in SYNTHESIS_PROMPT.lower()
