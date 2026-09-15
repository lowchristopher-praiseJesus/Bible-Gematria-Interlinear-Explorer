import pytest

from chatbot.router import build_mode_primer, _reading_artifacts


@pytest.mark.asyncio
async def test_reading_plan_primer_day_zero_chronological():
    result = await build_mode_primer("reading_plan", {"plan": "chronological", "day_index": 0})
    assert result["type"] == "chat"
    assert "Job" in result["message"] or "JOB" in result["message"]
    assert result["data"]["plan"] == "chronological"
    assert result["data"]["day_index"] == 0
    assert len(result["artifacts"]) >= 1
    assert result["artifacts"][0]["type"] == "chapter"
    assert result["artifacts"][0]["params"]["reference"] == "JOB 1"


@pytest.mark.asyncio
async def test_reading_plan_primer_defaults_day_zero():
    result = await build_mode_primer("reading_plan", {"plan": "canonical"})
    assert result["data"]["day_index"] == 0


@pytest.mark.asyncio
async def test_parable_primer_known():
    result = await build_mode_primer("parable", {"parable_id": "prodigal_son"})
    assert "Prodigal Son" in result["message"]
    assert result["data"]["parable"]["reference"] == "Luke 15:11-32"
    assert result["artifacts"][0]["type"] == "chapter"
    assert result["artifacts"][0]["params"]["reference"] == "Luke 15:11-32"
    # Luke has curated book context, so it's offered right alongside the
    # reading — the same "wherever a passage is displayed" rule every
    # other mode follows.
    assert result["artifacts"][1] == {
        "type": "book_context", "label": "Luke — Book Context ▸", "params": {"book": "LUK"}
    }


def test_reading_artifacts_bare_chapter_reference_is_a_chapter_not_interlinear():
    # "JOB 1" has no verse component at all — it's a whole chapter, so it
    # must use the multi-verse reading view, not the single-verse one.
    artifacts = _reading_artifacts("JOB 1")
    assert artifacts[0]["type"] == "chapter"


def test_reading_artifacts_dedupes_book_context_across_a_shared_seen_books_set():
    seen: set = set()
    first = _reading_artifacts("JHN 1:1", seen_books=seen)
    second = _reading_artifacts("JHN 3:16", seen_books=seen)
    assert any(a["type"] == "book_context" for a in first)
    assert not any(a["type"] == "book_context" for a in second)


def test_reading_artifacts_resolves_book_context_from_a_full_multiword_book_name():
    # Topic/parable data stores full names, not USFM codes — including
    # multi-word ones like "1 Peter", which a naive first-token split would
    # mangle.
    artifacts = _reading_artifacts("1 Peter 1:15-16")
    book_context = next(a for a in artifacts if a["type"] == "book_context")
    assert book_context["params"]["book"] == "1PE"


@pytest.mark.asyncio
async def test_parable_primer_unknown():
    result = await build_mode_primer("parable", {"parable_id": "not_real"})
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_topic_primer_no_series_registered(monkeypatch):
    import chatbot.router as router_module

    monkeypatch.setattr(router_module.wiki_loader, "list_series", lambda: [])
    result = await router_module.build_mode_primer("topic", {})
    assert result["type"] == "chat"
    assert "no study series available" in result["message"].lower()


@pytest.mark.asyncio
async def test_topic_primer_no_series_id_auto_resolves_when_exactly_one_registered(monkeypatch):
    import chatbot.router as router_module

    # Use the real registered series's manifest so get_manifest/list_concepts
    # (left un-mocked) resolve it consistently — only list_series is faked,
    # to simulate "exactly one series registered" regardless of how many are
    # really registered.
    real_manifest = router_module.wiki_loader.get_manifest("present-day-ministry-of-jesus")
    monkeypatch.setattr(router_module.wiki_loader, "list_series", lambda: [real_manifest])

    result = await router_module.build_mode_primer("topic", {})
    assert result["type"] == "chat"
    assert result["data"]["series_id"] == "present-day-ministry-of-jesus"
    concepts = result["data"]["concepts"]
    assert len(concepts) > 50
    slugs = {c["slug"] for c in concepts}
    assert "grace" in slugs


@pytest.mark.asyncio
async def test_topic_primer_series_only_lists_concepts():
    result = await build_mode_primer("topic", {"series_id": "present-day-ministry-of-jesus"})
    assert result["type"] == "chat"
    assert result["data"]["series_id"] == "present-day-ministry-of-jesus"
    concepts = result["data"]["concepts"]
    assert len(concepts) > 50
    slugs = {c["slug"] for c in concepts}
    assert "grace" in slugs


@pytest.mark.asyncio
async def test_topic_primer_series_message_includes_description_above_concepts_line():
    result = await build_mode_primer("topic", {"series_id": "present-day-ministry-of-jesus"})
    description = result["message"]
    # The curated one-line description from the registered manifest appears...
    assert "10-part series on what Jesus is doing now" in description
    # ...in its own paragraph, above the concepts prompt.
    assert description.index("mostly from Hebrews") < description.index("Here are the concepts covered")


@pytest.mark.asyncio
async def test_topic_primer_unknown_series():
    result = await build_mode_primer("topic", {"series_id": "not-a-real-series"})
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_topic_primer_concept_page(monkeypatch):
    # The concept page's raw markdown is never handed to the user directly
    # — the primer delegates to wiki_qa.answer_concept(), which synthesizes
    # one LLM answer from the page (and its related pages) instead.
    import chatbot.wiki_qa as wiki_qa_module

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "Grace is God's undeserved favor toward us in Christ.", "data": None}

    async def fake_llm_follow_ups(user_message, assistant_message, page_context=None):
        return []

    monkeypatch.setattr(wiki_qa_module, "call_ollama_with_context", fake_call_ollama_with_context)
    monkeypatch.setattr(wiki_qa_module, "generate_llm_follow_ups", fake_llm_follow_ups)

    result = await build_mode_primer(
        "topic", {"series_id": "present-day-ministry-of-jesus", "concept_slug": "grace"}
    )
    assert result["type"] == "chat"
    assert result["message"] == "Grace is God's undeserved favor toward us in Christ."
    assert result["data"]["series_id"] == "present-day-ministry-of-jesus"
    assert result["data"]["concept_slug"] == "grace"
    assert result["data"]["title"] == "Grace"


@pytest.mark.asyncio
async def test_topic_primer_unknown_concept():
    result = await build_mode_primer(
        "topic", {"series_id": "present-day-ministry-of-jesus", "concept_slug": "not-a-real-slug"}
    )
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_verse_primer_specified_reference(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng": "For God so loved the world..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("verse", {"reference": "JHN 3:16"})
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "JHN 3:16"
    # No standalone "interlinear" artifact — VerseBubble's own clickable
    # verse number already opens the same original-language view.
    artifact_types = [a["type"] for a in result["artifacts"]]
    assert "interlinear" not in artifact_types
    # John has book_context data, so a book_context artifact is offered.
    assert "book_context" in artifact_types


@pytest.mark.asyncio
async def test_verse_primer_random(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng": "In the beginning..."}

    async def fake_random_verse():
        return ("Genesis", 1, 1)

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    monkeypatch.setattr("chatbot.router.random_verse", fake_random_verse)
    result = await build_mode_primer("verse", {})
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "GEN 1:1"
    # Genesis has no curated book_context, and there's no standalone
    # interlinear artifact anymore — so no artifacts are offered at all.
    assert result["artifacts"] == []


@pytest.mark.asyncio
async def test_verse_primer_full_name_reference_normalized(monkeypatch):
    calls = []

    async def fake_fetch(reference, languages=None):
        calls.append(reference)
        return {"eng": "For God so loved the world..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("verse", {"reference": "John 3:16"})
    assert calls == ["JHN 3:16"]
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "JHN 3:16"


@pytest.mark.asyncio
async def test_verse_primer_unparsable_reference_passthrough(monkeypatch):
    calls = []

    async def fake_fetch(reference, languages=None):
        calls.append(reference)
        return {"eng": "..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("verse", {"reference": "not a real reference"})
    assert calls == ["not a real reference"]
    assert result["type"] == "verse"


@pytest.mark.asyncio
async def test_verse_primer_abbreviated_reference_normalized(monkeypatch):
    calls = []

    async def fake_fetch(reference, languages=None):
        calls.append(reference)
        return {"eng-KJV": "For yourselves know perfectly..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("verse", {"reference": "1 Th 4:16"})
    assert calls == ["1TH 4:16"]
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "1TH 4:16"


@pytest.mark.asyncio
async def test_verse_primer_verse_range_reads_as_a_passage(monkeypatch):
    fetch_calls = []

    async def fake_fetch(reference, languages=None):
        fetch_calls.append(reference)
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("verse", {"reference": "1 Thessalonians 4:13-18"})

    # A range can't go through the single-verse fetch path at all.
    assert fetch_calls == []
    assert result["type"] == "chat"
    assert result["data"]["reference"] == "1TH 4:13-18"
    assert result["artifacts"][0] == {
        "type": "chapter",
        "label": "Read 1TH 4:13-18 ▸",
        "params": {"reference": "1TH 4:13-18"},
    }


@pytest.mark.asyncio
async def test_verse_primer_abbreviated_verse_range(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("verse", {"reference": "1 Thess 4:13-18"})
    assert result["data"]["reference"] == "1TH 4:13-18"


@pytest.mark.asyncio
async def test_socratic_primer_random_reference_when_none_given(monkeypatch):
    # "Surprise me" is the only way the frontend calls this primer with no
    # reference (a freeform-typed passage never hits the primer at all — it
    # goes straight to socratic.answer(), which has its own "ask the user"
    # fallback) — so an empty reference here means pick one at random, the
    # same as "verse" mode's "Surprise me".
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "In the beginning..."}

    async def fake_random_verse():
        return ("Genesis", 1, 1)

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    monkeypatch.setattr("chatbot.router.random_verse", fake_random_verse)
    result = await build_mode_primer("socratic", {})
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "GEN 1:1"
    assert result["data"]["translations"] == {"eng-KJV": "In the beginning..."}
    assert "In the beginning..." in result["message"]


@pytest.mark.asyncio
async def test_socratic_primer_with_reference(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "For God so loved the world..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("socratic", {"reference": "JHN 3:16"})
    assert result["type"] == "verse"
    assert "JHN 3:16" in result["message"]
    assert "For God so loved the world..." in result["message"]
    assert result["data"]["reference"] == "JHN 3:16"
    assert result["data"]["translations"] == {"eng-KJV": "For God so loved the world..."}
    # John has curated book context, so it's offered alongside the passage.
    artifact_types = [a["type"] for a in result["artifacts"]]
    assert "book_context" in artifact_types
    assert "interlinear" in artifact_types


@pytest.mark.asyncio
async def test_socratic_primer_full_name_reference_normalized(monkeypatch):
    calls = []

    async def fake_fetch(reference, languages=None):
        calls.append(reference)
        return {"eng-KJV": "For God so loved the world..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("socratic", {"reference": "John 3:16"})
    assert calls == ["JHN 3:16"]
    assert result["data"]["reference"] == "JHN 3:16"


@pytest.mark.asyncio
async def test_socratic_primer_verse_range_skips_single_verse_fetch(monkeypatch):
    async def fake_fetch(reference, languages=None):
        raise AssertionError("a range can't go through the single-verse fetch path")

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("socratic", {"reference": "1 Thessalonians 4:13-18"})
    assert result["data"]["reference"] == "1TH 4:13-18"
    assert result["artifacts"][0]["type"] == "chapter"


@pytest.mark.asyncio
async def test_devotional_primer_user_source_asks_for_a_verse_or_theme():
    result = await build_mode_primer("devotional", {"source": "user"})
    assert result["type"] == "chat"
    assert "verse reference" in result["message"].lower()
    assert "theme" in result["message"].lower()
    assert result["follow_up_questions"] == []


@pytest.mark.asyncio
async def test_devotional_primer_system_source_is_a_short_ack():
    result = await build_mode_primer("devotional", {"source": "system"})
    assert result["type"] == "chat"
    assert "find a verse" in result["message"].lower()


@pytest.mark.asyncio
async def test_devotional_primer_defaults_to_user_source():
    result = await build_mode_primer("devotional", {})
    assert result["type"] == "chat"
    assert "verse reference" in result["message"].lower()


@pytest.mark.asyncio
async def test_freeform_primer():
    result = await build_mode_primer("freeform", {})
    assert result["type"] == "chat"
