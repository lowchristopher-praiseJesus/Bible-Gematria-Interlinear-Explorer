import pytest

from chatbot import devotional


def test_build_devotional_prompt_substitutes_the_marker():
    out = devotional.build_devotional_prompt("JHN 14:27", "Peace I leave with you...")
    assert "[INSERT VERSE AND REFERENCE]" not in out
    assert "JHN 14:27 (KJV)" in out
    assert "Peace I leave with you..." in out
    assert "1,200" in out  # length instruction survived


@pytest.mark.asyncio
async def test_resolve_seed_verse_explicit_single_reference(monkeypatch):
    async def fake_fetch(reference, languages=None):
        assert reference == "JHN 14:27"
        return {"eng-KJV": "Peace I leave with you..."}

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, translations = await devotional.resolve_seed_verse("John 14:27", "user")
    assert ref == "JHN 14:27"
    assert translations == {"eng-KJV": "Peace I leave with you..."}


@pytest.mark.asyncio
async def test_resolve_seed_verse_range_joins_verse_text(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"PSA 23:1": {"eng-KJV": "The LORD is my shepherd; I shall not want."},
                "PSA 23:2": {"eng-KJV": "He maketh me to lie down in green pastures:"},
                "PSA 23:3": {"eng-KJV": "He restoreth my soul:"}}[reference]

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, translations = await devotional.resolve_seed_verse("Psalm 23:1-3", "user")
    assert ref == "PSA 23:1-3"
    assert translations["eng-KJV"] == (
        "The LORD is my shepherd; I shall not want. "
        "He maketh me to lie down in green pastures: "
        "He restoreth my soul:"
    )


@pytest.mark.asyncio
async def test_resolve_seed_verse_theme_goes_through_pick(monkeypatch):
    async def fake_pick(theme):
        assert theme == "facing anxiety"
        return "PHP 4:6-7"

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr(devotional, "pick_verse_for_theme", fake_pick)
    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, _ = await devotional.resolve_seed_verse("facing anxiety", "user")
    assert ref == "PHP 4:6-7"


@pytest.mark.asyncio
async def test_resolve_seed_verse_system_source_empty_goes_through_pick(monkeypatch):
    async def fake_pick(theme):
        assert theme is None
        return "ROM 8:28"

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr(devotional, "pick_verse_for_theme", fake_pick)
    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, _ = await devotional.resolve_seed_verse(None, "system")
    assert ref == "ROM 8:28"


@pytest.mark.asyncio
async def test_resolve_seed_verse_raises_when_no_text(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {}

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    with pytest.raises(devotional.DevotionalError):
        await devotional.resolve_seed_verse("John 14:27", "user")


@pytest.mark.asyncio
async def test_pick_verse_for_theme_parses_llm_reference(monkeypatch):
    async def fake_simple(system, user, *, max_tokens=2048):
        return "Try John 14:27 — a good one."

    monkeypatch.setattr(devotional, "simple_completion", fake_simple)
    monkeypatch.setattr(devotional, "llm_unconfigured_error", lambda: None)
    assert await devotional.pick_verse_for_theme("peace") == "JHN 14:27"


@pytest.mark.asyncio
async def test_pick_verse_for_theme_retries_then_falls_back(monkeypatch):
    calls = []

    async def fake_simple(system, user, *, max_tokens=2048):
        calls.append(1)
        return "no reference here"

    monkeypatch.setattr(devotional, "simple_completion", fake_simple)
    monkeypatch.setattr(devotional, "llm_unconfigured_error", lambda: None)
    monkeypatch.setattr(devotional.random, "choice", lambda seq: seq[0])
    out = await devotional.pick_verse_for_theme("peace")
    assert len(calls) == 2                     # one retry
    assert out == devotional.FALLBACK_VERSES[0]


@pytest.mark.asyncio
async def test_pick_verse_for_theme_unconfigured_uses_fallback(monkeypatch):
    monkeypatch.setattr(devotional, "llm_unconfigured_error", lambda: "no key")
    monkeypatch.setattr(devotional.random, "choice", lambda seq: seq[2])
    out = await devotional.pick_verse_for_theme(None)
    assert out == devotional.FALLBACK_VERSES[2]
