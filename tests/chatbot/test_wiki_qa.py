import pytest

from chatbot import wiki_qa


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
