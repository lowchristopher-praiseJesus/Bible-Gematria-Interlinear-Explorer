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
async def test_topic_primer_known():
    result = await build_mode_primer("topic", {"topic_id": "holiness"})
    assert "Holiness" in result["message"]
    # "Leviticus 19:2" is a single verse; "1 Peter 1:15-16" is a range and
    # should read as a full multi-verse passage instead of being truncated
    # to just 1 Peter 1:15. Each reference with curated book context also
    # gets a "book_context" artifact right alongside it (Leviticus has
    # none, so it gets no extra artifact).
    by_ref = {a["params"]["reference"]: a["type"] for a in result["artifacts"] if a["type"] != "book_context"}
    assert by_ref["Leviticus 19:2"] == "interlinear"
    assert by_ref["1 Peter 1:15-16"] == "chapter"
    assert by_ref["Hebrews 12:14"] == "interlinear"
    book_context_books = {a["params"]["book"] for a in result["artifacts"] if a["type"] == "book_context"}
    assert book_context_books == {"1PE", "HEB"}


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
async def test_freeform_primer():
    result = await build_mode_primer("freeform", {})
    assert result["type"] == "chat"
