import json

import pytest

from chatbot import story_mode


@pytest.fixture
def llm(monkeypatch):
    """Stubs the simple_completion LLM boundary; records what story_mode
    sent it. `state["replies"]` is a queue consumed one per call."""
    calls = []
    state = {"replies": [
        '{"themes": [{"id": "t1", "label": "Trusting God", "description": '
        '"God provides even when we cannot see how."}, {"id": "t2", '
        '"label": "Coming home", "description": "It is never too late to '
        'return."}], "digest": "We talked about the prodigal son and how '
        'God welcomes us back."}'
    ]}

    async def fake_completion(system_prompt, user_prompt, *, max_tokens=2048, timeout=60.0):
        calls.append({
            "system_prompt": system_prompt, "user_prompt": user_prompt,
            "max_tokens": max_tokens, "timeout": timeout,
        })
        return state["replies"].pop(0) if state["replies"] else ""

    monkeypatch.setattr(story_mode, "simple_completion", fake_completion)
    monkeypatch.setattr(story_mode, "llm_unconfigured_error", lambda: None)
    return type("LLM", (), {"calls": calls, "state": state})


async def test_derive_themes_returns_up_to_three_themes_and_a_digest(llm):
    messages = [
        {"role": "user", "text": "Tell me about the prodigal son."},
        {"role": "assistant", "text": "It's a parable about a father's forgiveness."},
    ]
    result = await story_mode.derive_themes(messages)
    assert len(result["themes"]) == 2
    assert result["themes"][0] == {
        "id": "t1", "label": "Trusting God",
        "description": "God provides even when we cannot see how.",
    }
    assert "prodigal son" in result["digest"]


async def test_derive_themes_never_pads_below_three(llm):
    llm.state["replies"] = [
        '{"themes": [{"id": "t1", "label": "One lesson", "description": "..."}], "digest": "short chat"}'
    ]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert len(result["themes"]) == 1


async def test_derive_themes_handles_a_single_message_transcript(llm):
    result = await story_mode.derive_themes([{"role": "user", "text": "What does John 3:16 mean?"}])
    assert len(result["themes"]) >= 1


async def test_derive_themes_caps_long_transcripts(llm):
    long_transcript = [{"role": "user", "text": f"message {i}"} for i in range(200)]
    await story_mode.derive_themes(long_transcript)
    sent = llm.calls[0]["user_prompt"]
    assert "message 199" in sent
    assert "message 0" not in sent


async def test_derive_themes_returns_none_on_unparseable_reply(llm):
    # An unparseable reply means the LLM call didn't do its job — this is
    # a "the call failed" case, not "the model looked and found nothing",
    # so it must be distinguishable from a genuine empty classification
    # (see test_derive_themes_returns_empty_on_a_genuine_no_themes_reply).
    llm.state["replies"] = ["not json at all"]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert result["themes"] is None


async def test_derive_themes_returns_none_on_empty_llm_reply(llm):
    # simple_completion() returns "" on ANY provider error, HTTP failure,
    # or timeout — never raises — so this is the shape a hard failure
    # actually takes on the wire.
    llm.state["replies"] = [""]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert result["themes"] is None


async def test_derive_themes_returns_empty_on_a_genuine_no_themes_reply(llm):
    # A well-formed, successfully-parsed reply that genuinely lists no
    # themes is a real verdict, not a failure — must stay [] so callers
    # don't offer a pointless "try again" for the identical (correct)
    # answer.
    llm.state["replies"] = ['{"themes": [], "digest": "Small talk, nothing to draw a lesson from."}']
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert result["themes"] == []
    assert result["digest"]


async def test_derive_themes_returns_empty_for_no_messages(llm):
    result = await story_mode.derive_themes([])
    assert result["themes"] == []
    assert llm.calls == []


async def test_derive_themes_caps_at_three_even_if_the_model_returns_more(llm):
    llm.state["replies"] = [
        '{"themes": ['
        '{"id": "t1", "label": "A", "description": ""},'
        '{"id": "t2", "label": "B", "description": ""},'
        '{"id": "t3", "label": "C", "description": ""},'
        '{"id": "t4", "label": "D", "description": ""}'
        '], "digest": "d"}'
    ]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert len(result["themes"]) == 3


def _story_reply(
    title="Test", characters="Zara: red hair.", cover_scene="A cover scene.", pages=None,
):
    if pages is None:
        pages = [{"text": "word " * 650, "scene": "A scene."}]
    return json.dumps({
        "title": title, "characters": characters, "cover_scene": cover_scene, "pages": pages,
    })


async def test_generate_story_uses_the_word_band_for_the_age_range(llm):
    llm.state["replies"] = [_story_reply(
        title="The Brave Little Sparrow", pages=[{"text": "word " * 650, "scene": "A scene."}],
    )]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["title"] == "The Brave Little Sparrow"
    assert 600 <= result["word_count"] <= 700
    assert len(llm.calls) == 1


async def test_generate_story_returns_structured_pages_and_cover(llm):
    llm.state["replies"] = [_story_reply(
        title="A Story",
        characters="Zara: red hair, green boots.",
        cover_scene="Zara stands at the garden gate.",
        pages=[
            {"text": "word " * 300, "scene": "Scene one."},
            {"text": "word " * 300, "scene": "Scene two."},
        ],
    )]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["characters"] == "Zara: red hair, green boots."
    assert result["cover_scene"] == "Zara stands at the garden gate."
    assert result["pages"] == [
        {"text": "word " * 300, "scene": "Scene one."},
        {"text": "word " * 300, "scene": "Scene two."},
    ]
    assert result["word_count"] == 600


async def test_generate_story_defaults_missing_optional_fields(llm):
    # A reply missing `characters`/`cover_scene`/a page's `scene` must not
    # crash the parser — those fields degrade to "" (an illustration built
    # from "" just skips that part of the prompt, see story_illustrations
    # tests) rather than blocking story delivery.
    llm.state["replies"] = ['{"title": "T", "pages": [{"text": "word word word"}]}']
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["title"] == "T"
    assert result["characters"] == ""
    assert result["cover_scene"] == ""
    assert result["pages"][0]["scene"] == ""
    assert len(llm.calls) == 2  # 3 words is far outside the band -> retries once


async def test_generate_story_treats_unparseable_reply_as_empty(llm):
    llm.state["replies"] = ["not json at all", "still not json"]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["pages"] == []
    assert len(llm.calls) == 2


async def test_generate_story_treats_a_reply_with_no_pages_as_empty(llm):
    # Well-formed JSON, but genuinely no pages — must be treated the same
    # as an unparseable reply (a failure to retry/report), not delivered
    # as a titled artifact with nothing to read.
    llm.state["replies"] = ['{"title": "T", "pages": []}', '{"title": "T2", "pages": []}']
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["pages"] == []
    assert len(llm.calls) == 2


async def test_generate_story_assigns_two_random_character_names(llm, monkeypatch):
    # Real usage showed the model reliably defaulting to "Pip" for a small
    # animal sidekick across many generated stories, since each call is a
    # fresh, stateless completion with nothing to vary against on its own.
    # The server must pick the names itself rather than trust the model.
    monkeypatch.setattr(story_mode.random, "sample", lambda pool, k: ["Zara", "Kofi"])
    llm.state["replies"] = [_story_reply()]
    await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Sharing", "description": "..."}], "3-6"
    )
    prompt = llm.calls[0]["user_prompt"]
    assert "Zara" in prompt
    assert "Kofi" in prompt
    assert "Pip" in prompt  # named as the example to avoid defaulting to


async def test_generate_story_draws_names_from_the_character_name_pool(llm, monkeypatch):
    seen = {}

    def fake_sample(pool, k):
        seen["pool"] = pool
        seen["k"] = k
        return pool[:k]

    monkeypatch.setattr(story_mode.random, "sample", fake_sample)
    llm.state["replies"] = [_story_reply()]
    await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Sharing", "description": "..."}], "3-6"
    )
    assert seen["pool"] is story_mode.CHARACTER_NAME_POOL
    assert seen["k"] == 2
    assert len(story_mode.CHARACTER_NAME_POOL) >= 20
    assert len(set(story_mode.CHARACTER_NAME_POOL)) == len(story_mode.CHARACTER_NAME_POOL)
    assert "Pip" not in story_mode.CHARACTER_NAME_POOL


async def test_generate_story_prompt_for_ages_3_6_forbids_abstract_endings(llm):
    # Real usage (a "Report an Issue" submission) showed the 3-6 band's
    # stories reliably closing on an abstract simile ("like the wind and
    # the leaves") and a tacked-on "The lesson is..." moral — both lose a
    # 3-6-year-old even when the rest of the story lands. The prompt must
    # tell the model not to do that.
    llm.state["replies"] = [_story_reply()]
    await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Sharing", "description": "..."}], "3-6"
    )
    prompt = llm.calls[0]["user_prompt"].lower()
    assert "abstract" in prompt
    assert "moral" in prompt


async def test_generate_story_weaves_multiple_themes_into_the_prompt(llm):
    llm.state["replies"] = [_story_reply(title="Two Lessons")]
    themes = [
        {"id": "t1", "label": "Trusting God", "description": "..."},
        {"id": "t2", "label": "Coming home", "description": "..."},
    ]
    await story_mode.generate_story("digest", themes, "3-6")
    prompt = llm.calls[0]["user_prompt"]
    assert "Trusting God" in prompt
    assert "Coming home" in prompt


async def test_generate_story_retries_once_when_word_count_is_far_outside_the_band(llm):
    llm.state["replies"] = [
        _story_reply(title="Too Short", pages=[{"text": "Just a few words.", "scene": "A scene."}]),
        _story_reply(title="Just Right", pages=[{"text": "word " * 650, "scene": "A scene."}]),
    ]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert len(llm.calls) == 2
    assert result["title"] == "Just Right"
    assert result["word_count"] > 600


async def test_generate_story_delivers_the_retry_result_even_if_still_out_of_band(llm):
    llm.state["replies"] = [
        _story_reply(title="Too Short", pages=[{"text": "Just a few words.", "scene": "A scene."}]),
        _story_reply(title="Still Short", pages=[{"text": "Still just a few words.", "scene": "A scene."}]),
    ]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert len(llm.calls) == 2
    assert result["title"] == "Still Short"


async def test_generate_story_rejects_an_unknown_age_range(llm):
    with pytest.raises(ValueError):
        await story_mode.generate_story(
            "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "13-18"
        )
    assert llm.calls == []


def test_page_count_bands_are_smaller_for_younger_ages():
    assert story_mode.PAGE_COUNT_BANDS["3-6"] < story_mode.PAGE_COUNT_BANDS["7-8"] < story_mode.PAGE_COUNT_BANDS["9-10"]


@pytest.mark.parametrize("age_range,low,high,page_low,page_high", [
    ("3-6", 500, 800, 5, 6), ("7-8", 800, 1200, 7, 8), ("9-10", 1200, 1800, 9, 10),
])
async def test_generate_story_targets_the_right_band_per_age_range(llm, age_range, low, high, page_low, page_high):
    llm.state["replies"] = [_story_reply(
        title="A Story", pages=[{"text": "word " * ((low + high) // 2), "scene": "A scene."}],
    )]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], age_range
    )
    assert len(llm.calls) == 1  # within band, no retry needed
    prompt = llm.calls[0]["user_prompt"]
    assert f"{low}-{high} words" in prompt
    assert f"{page_low}-{page_high} pages" in prompt


async def test_build_primer_with_no_themes_yet_derives_them(llm):
    result = await story_mode.build_primer(
        {"source_messages": [{"role": "user", "text": "Tell me about the prodigal son."}]}
    )
    assert result["type"] == "chat"
    assert result["data"]["themes"]
    assert "pick" in result["message"].lower()


async def test_build_primer_reports_when_no_themes_can_be_found(llm):
    llm.state["replies"] = ['{"themes": [], "digest": "Small talk, nothing to draw a lesson from."}']
    result = await story_mode.build_primer({"source_messages": [{"role": "user", "text": "hi"}]})
    assert result["type"] == "chat"
    assert "couldn't find a story" in result["message"].lower()
    assert result["data"] == {"themesRetry": True}


async def test_build_primer_reports_a_distinct_message_when_theme_derivation_fails(llm):
    llm.state["replies"] = [""]
    result = await story_mode.build_primer({"source_messages": [{"role": "user", "text": "hi"}]})
    assert result["type"] == "chat"
    assert "trouble right now" in result["message"].lower()
    assert "couldn't find a story" not in result["message"].lower()
    assert result["data"] == {"themesRetry": True}


async def test_build_primer_generates_the_story_once_themes_are_selected(llm):
    llm.state["replies"] = [_story_reply(
        title="The Brave Sparrow", pages=[{"text": "word " * 650, "scene": "A scene."}],
    )]
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes,
        "story_digest": "digest text",
        "story_selected_theme_ids": ["t1"],
        "story_age_range": "3-6",
    })
    assert result["artifacts"][0]["type"] == "story"
    params = result["artifacts"][0]["params"]
    assert params["title"] == "The Brave Sparrow"
    assert params["themes"] == ["Trusting God"]
    assert params["age_range"] == "3-6"
    assert params["cover"] == {"scene": "A cover scene.", "image_url": None}
    assert params["pages"] == [{"text": "word " * 650, "scene": "A scene.", "image_url": None}]


async def test_build_primer_defaults_age_range_when_missing(llm):
    llm.state["replies"] = [_story_reply(title="A Story")]
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes, "story_digest": "d", "story_selected_theme_ids": ["t1"],
    })
    assert result["artifacts"][0]["params"]["age_range"] == "3-6"


async def test_build_primer_with_stale_selected_ids_asks_to_choose_again(llm):
    result = await story_mode.build_primer({
        "story_themes": [{"id": "t1", "label": "Trust", "description": "..."}],
        "story_digest": "d",
        "story_selected_theme_ids": ["not-a-real-id"],
    })
    assert result["type"] == "chat"
    assert "choose again" in result["message"].lower()


async def test_build_primer_is_an_error_when_llm_is_unconfigured(monkeypatch):
    monkeypatch.setattr(story_mode, "llm_unconfigured_error", lambda: "LLM not configured.")
    result = await story_mode.build_primer({"source_messages": [{"role": "user", "text": "hi"}]})
    assert result["type"] == "error"


async def test_build_primer_guards_none_mode_params(monkeypatch):
    monkeypatch.setattr(story_mode, "llm_unconfigured_error", lambda: None)
    result = await story_mode.build_primer(None)
    assert result["type"] == "chat"


async def test_build_primer_returns_an_error_when_the_story_comes_back_empty(llm):
    # generate_story's initial attempt AND its one retry both come back
    # empty/unparseable — simple_completion() returns "" on any provider/
    # network/timeout failure rather than raising, so nothing upstream of
    # _story_turn would otherwise notice this is actually a failure.
    llm.state["replies"] = ["", ""]
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes, "story_digest": "d", "story_selected_theme_ids": ["t1"],
        "story_age_range": "3-6",
    })
    assert result["type"] == "error"
    assert "couldn't write the story" in result["message"].lower()
    assert "artifacts" not in result or not result.get("artifacts")


async def test_build_primer_returns_an_error_for_an_unrecognized_age_range_instead_of_raising(llm):
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes, "story_digest": "d", "story_selected_theme_ids": ["t1"],
        "story_age_range": "not-a-real-range",
    })
    assert result["type"] == "error"
    assert llm.calls == []
