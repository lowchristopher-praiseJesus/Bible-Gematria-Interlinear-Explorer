import pytest

from chatbot.router import build_mode_primer


@pytest.mark.asyncio
async def test_reading_plan_primer_day_zero_chronological():
    result = await build_mode_primer("reading_plan", {"plan": "chronological", "day_index": 0})
    assert result["type"] == "chat"
    assert "Job" in result["message"] or "JOB" in result["message"]
    assert result["data"]["plan"] == "chronological"
    assert result["data"]["day_index"] == 0
    assert len(result["artifacts"]) >= 1


@pytest.mark.asyncio
async def test_reading_plan_primer_defaults_day_zero():
    result = await build_mode_primer("reading_plan", {"plan": "canonical"})
    assert result["data"]["day_index"] == 0


@pytest.mark.asyncio
async def test_parable_primer_known():
    result = await build_mode_primer("parable", {"parable_id": "prodigal_son"})
    assert "Prodigal Son" in result["message"]
    assert result["data"]["parable"]["reference"] == "Luke 15:11-32"
    assert result["artifacts"][0]["params"]["reference"] == "Luke 15:11-32"


@pytest.mark.asyncio
async def test_parable_primer_unknown():
    result = await build_mode_primer("parable", {"parable_id": "not_real"})
    assert result["type"] == "error"


@pytest.mark.asyncio
async def test_topic_primer_known():
    result = await build_mode_primer("topic", {"topic_id": "holiness"})
    assert "Holiness" in result["message"]
    assert len(result["artifacts"]) == len(result["data"]["topic"]["seed_references"])


@pytest.mark.asyncio
async def test_verse_primer_specified_reference(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng": "For God so loved the world..."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)
    result = await build_mode_primer("verse", {"reference": "JHN 3:16"})
    assert result["type"] == "verse"
    assert result["data"]["reference"] == "JHN 3:16"
    artifact_types = [a["type"] for a in result["artifacts"]]
    assert "interlinear" in artifact_types
    assert result["artifacts"][0]["params"]["reference"] == "JHN 3:16"
    # John has book_context data, so a book_context artifact should also be offered
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
    # Genesis has no NT book_context data, so only the interlinear artifact is offered
    assert [a["type"] for a in result["artifacts"]] == ["interlinear"]


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
async def test_freeform_primer():
    result = await build_mode_primer("freeform", {})
    assert result["type"] == "chat"
