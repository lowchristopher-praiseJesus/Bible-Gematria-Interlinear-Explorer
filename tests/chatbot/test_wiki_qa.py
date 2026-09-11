import pytest

from chatbot import wiki_qa


@pytest.fixture(autouse=True)
def _no_llm_follow_ups(monkeypatch):
    """Stub the follow-up-question LLM call to a fast no-op by default, so
    tests that don't care about follow-ups never depend on a real LLM
    provider being reachable (e.g. a local Ollama daemon actually running
    on the dev machine). Tests exercising follow-up behavior override this
    per-test."""
    async def fake(user_message, assistant_message, page_context=None):
        return []

    monkeypatch.setattr(wiki_qa, "generate_llm_follow_ups", fake)


@pytest.mark.asyncio
async def test_answer_unknown_series():
    result = await wiki_qa.answer("not-a-real-series", "what is grace?")
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_answer_no_match_suggests_real_concepts(monkeypatch):
    monkeypatch.setattr(wiki_qa.wiki_loader, "search", lambda series_id, message, top_n=3: [])
    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "list_concepts",
        lambda series_id: [{"slug": "grace", "title": "Grace"}, {"slug": "holiness", "title": "Holiness"}],
    )
    result = await wiki_qa.answer("present-day-ministry-of-jesus", "what is quantum computing?")
    assert result["type"] == "chat"
    assert "Grace" in result["message"]
    assert "Holiness" in result["message"]


@pytest.mark.asyncio
async def test_answer_grounds_ollama_call_with_matched_pages(monkeypatch):
    captured = {}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        captured["message"] = message
        captured["research_data"] = research_data
        return {"type": "chat", "message": "Grace is undeserved favor.", "data": None}

    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "search",
        lambda series_id, message, top_n=3: [
            {"slug": "grace", "title": "Grace", "kind": "concept", "body": "Grace is undeserved favor."}
        ],
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await wiki_qa.answer("present-day-ministry-of-jesus", "what is grace?")

    assert captured["message"] == "what is grace?"
    assert "Grace is undeserved favor." in captured["research_data"]
    assert "Joseph Prince" in captured["research_data"]
    assert "Answer only from the material below" in captured["research_data"]
    assert result["message"] == "Grace is undeserved favor."
    assert result["data"] == {"series_id": "present-day-ministry-of-jesus", "best_match_slug": "grace"}


@pytest.mark.asyncio
async def test_answer_trims_long_matched_page_bodies_in_research_data(monkeypatch):
    # Some real wiki pages run 20KB+; the grounding text sent to the LLM
    # must not include a matched page's body untrimmed.
    captured = {}
    long_body = "x" * 5000

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "ok", "data": None}

    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "search",
        lambda series_id, message, top_n=3: [
            {"slug": "grace", "title": "Grace", "kind": "concept", "body": long_body}
        ],
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    await wiki_qa.answer("present-day-ministry-of-jesus", "what is grace?")

    # The full 5000-char body must not appear verbatim in the grounding
    # text — only a bounded prefix of it should.
    assert long_body not in captured["research_data"]
    assert "x" * wiki_qa._MAX_PAGE_CHARS_IN_GROUNDING in captured["research_data"]
    assert "x" * (wiki_qa._MAX_PAGE_CHARS_IN_GROUNDING + 1) not in captured["research_data"]


@pytest.mark.asyncio
async def test_answer_no_keyword_match_but_open_concept_still_answers(monkeypatch):
    # "summarize this concept" shares no keywords with any wiki page — but
    # the session knows which page is open (concept_slug), so the LLM must
    # still be grounded in that page rather than getting the "couldn't
    # find" fallback.
    captured = {}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        captured["message"] = message
        captured["research_data"] = research_data
        return {"type": "chat", "message": "Grace is God's undeserved favor.", "data": None}

    monkeypatch.setattr(
        wiki_qa.wiki_loader, "search", lambda series_id, message, top_n=3: []
    )
    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "get_page",
        lambda series_id, slug: {
            "kind": "concept",
            "title": "Grace",
            "tags": ["grace"],
            "body": "The soil everything else grows in.",
        },
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await wiki_qa.answer(
        "present-day-ministry-of-jesus", "summarize this concept", concept_slug="grace"
    )

    assert "The soil everything else grows in." in captured["research_data"]
    assert "currently open" in captured["research_data"]
    assert result["message"] == "Grace is God's undeserved favor."
    assert result["data"]["best_match_slug"] == "grace"


@pytest.mark.asyncio
async def test_answer_includes_open_concept_page_alongside_matches(monkeypatch):
    # Even when keyword matches exist, the page the user is reading belongs
    # in the grounding (deduped — never twice) so questions about "this
    # concept" stay answerable.
    captured = {}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "ok", "data": None}

    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "search",
        lambda series_id, message, top_n=3: [
            {"slug": "holiness", "title": "Holiness", "kind": "concept", "body": "Holiness content."}
        ],
    )
    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "get_page",
        lambda series_id, slug: {
            "kind": "concept",
            "title": "Grace",
            "tags": [],
            "body": "Grace page body.",
        },
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    await wiki_qa.answer(
        "present-day-ministry-of-jesus", "how does grace relate to holiness?", concept_slug="grace"
    )

    assert "Grace page body." in captured["research_data"]
    assert "Holiness content." in captured["research_data"]
    assert captured["research_data"].count("=== Grace") == 1


@pytest.mark.asyncio
async def test_answer_no_match_no_open_concept_still_suggests(monkeypatch):
    monkeypatch.setattr(wiki_qa.wiki_loader, "search", lambda series_id, message, top_n=3: [])
    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "list_concepts",
        lambda series_id: [{"slug": "grace", "title": "Grace"}],
    )
    result = await wiki_qa.answer("present-day-ministry-of-jesus", "what is quantum computing?")
    assert "couldn't find anything" in result["message"]


@pytest.mark.asyncio
async def test_answer_links_scripture_references_in_llm_response(monkeypatch):
    # Verse citations the LLM quotes in its answer must come back as
    # markdown links into the Explorer, so the frontend can make them
    # clickable into the original-language view. Unrecognized tokens
    # (transcript citations like "md:71") stay plain text.
    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        return {
            "type": "chat",
            "message": "Grow in grace (2 Pet 3:18), quoted from md:71 of the transcript.",
            "data": None,
        }

    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "search",
        lambda series_id, message, top_n=3: [
            {"slug": "grace", "title": "Grace", "kind": "concept", "body": "Grace body."}
        ],
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await wiki_qa.answer("present-day-ministry-of-jesus", "what verses does it cite?")

    assert "[2 Pet 3:18](/explorer?reference=2PE%203%3A18)" in result["message"]
    assert "md:71" in result["message"]
    assert "](/explorer" not in result["message"].split("md:71")[1]


@pytest.mark.asyncio
async def test_answer_uses_llm_generated_follow_ups(monkeypatch):
    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "Grace is undeserved favor.", "data": None}

    async def fake_llm_follow_ups(user_message, assistant_message, page_context=None):
        return ["Tell me more about holiness."]

    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "search",
        lambda series_id, message, top_n=3: [
            {"slug": "grace", "title": "Grace", "kind": "concept", "body": "Grace body."}
        ],
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)
    monkeypatch.setattr(wiki_qa, "generate_llm_follow_ups", fake_llm_follow_ups)

    result = await wiki_qa.answer("present-day-ministry-of-jesus", "what is grace?")

    assert result["follow_up_questions"] == ["Tell me more about holiness."]


@pytest.mark.asyncio
async def test_answer_leaves_follow_ups_unset_when_llm_gives_none(monkeypatch):
    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "ok", "data": None}

    async def fake_llm_follow_ups(user_message, assistant_message, page_context=None):
        return []

    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "search",
        lambda series_id, message, top_n=3: [
            {"slug": "grace", "title": "Grace", "kind": "concept", "body": "Grace body."}
        ],
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)
    monkeypatch.setattr(wiki_qa, "generate_llm_follow_ups", fake_llm_follow_ups)

    result = await wiki_qa.answer("present-day-ministry-of-jesus", "what is grace?")

    assert "follow_up_questions" not in result


@pytest.mark.asyncio
async def test_answer_concept_unknown_series():
    result = await wiki_qa.answer_concept("not-a-real-series", "grace")
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_answer_concept_unknown_slug(monkeypatch):
    monkeypatch.setattr(wiki_qa.wiki_loader, "get_page", lambda series_id, slug: None)
    result = await wiki_qa.answer_concept("present-day-ministry-of-jesus", "not-a-real-slug")
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_answer_concept_grounds_ollama_call_with_current_and_related_pages(monkeypatch):
    captured = {}
    pages = {
        "grace": {
            "kind": "concept", "title": "Grace", "tags": [],
            "body": "Grace is undeserved favor. See [[holiness]].",
        },
        "holiness": {
            "kind": "concept", "title": "Holiness", "tags": [],
            "body": "Holiness is God's set-apartness.",
        },
    }

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        captured["message"] = message
        captured["research_data"] = research_data
        return {"type": "chat", "message": "Grace and holiness go together.", "data": None}

    monkeypatch.setattr(wiki_qa.wiki_loader, "get_page", lambda series_id, slug: pages.get(slug))
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await wiki_qa.answer_concept("present-day-ministry-of-jesus", "grace")

    assert "Grace is undeserved favor" in captured["research_data"]
    assert "Holiness is God's set-apartness" in captured["research_data"]
    assert "currently open" in captured["research_data"]
    assert "Joseph Prince" in captured["research_data"]
    assert result["message"] == "Grace and holiness go together."
    assert result["data"] == {
        "series_id": "present-day-ministry-of-jesus", "concept_slug": "grace", "title": "Grace",
    }


@pytest.mark.asyncio
async def test_answer_concept_ignores_wikilink_to_unknown_slug(monkeypatch):
    pages = {"grace": {"kind": "concept", "title": "Grace", "tags": [], "body": "See [[ghost-page]]."}}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "ok", "data": None}

    monkeypatch.setattr(wiki_qa.wiki_loader, "get_page", lambda series_id, slug: pages.get(slug))
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    result = await wiki_qa.answer_concept("present-day-ministry-of-jesus", "grace")

    assert result["type"] == "chat"


@pytest.mark.asyncio
async def test_answer_concept_trims_long_related_page_bodies(monkeypatch):
    long_body = "y" * 5000
    pages = {
        "grace": {"kind": "concept", "title": "Grace", "tags": [], "body": "See [[holiness]]."},
        "holiness": {"kind": "concept", "title": "Holiness", "tags": [], "body": long_body},
    }
    captured = {}

    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "ok", "data": None}

    monkeypatch.setattr(wiki_qa.wiki_loader, "get_page", lambda series_id, slug: pages.get(slug))
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)

    await wiki_qa.answer_concept("present-day-ministry-of-jesus", "grace")

    assert long_body not in captured["research_data"]
    assert "y" * wiki_qa._MAX_PAGE_CHARS_IN_GROUNDING in captured["research_data"]


@pytest.mark.asyncio
async def test_answer_concept_uses_llm_generated_follow_ups(monkeypatch):
    async def fake_call_ollama_with_context(message, research_data, conversation_history=None, page_context=None):
        return {"type": "chat", "message": "Grace is undeserved favor.", "data": None}

    async def fake_llm_follow_ups(user_message, assistant_message, page_context=None):
        return ["What does holiness require?", "How is grace received?"]

    monkeypatch.setattr(
        wiki_qa.wiki_loader,
        "get_page",
        lambda series_id, slug: {
            "kind": "concept", "title": "Grace", "tags": [], "body": "Grace is undeserved favor.",
        },
    )
    monkeypatch.setattr(wiki_qa, "call_ollama_with_context", fake_call_ollama_with_context)
    monkeypatch.setattr(wiki_qa, "generate_llm_follow_ups", fake_llm_follow_ups)

    result = await wiki_qa.answer_concept("present-day-ministry-of-jesus", "grace")

    assert result["follow_up_questions"] == ["What does holiness require?", "How is grace received?"]
