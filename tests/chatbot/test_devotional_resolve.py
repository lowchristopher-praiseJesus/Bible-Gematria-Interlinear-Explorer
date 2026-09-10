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
async def test_resolve_seed_verse_raises_when_fetch_raises(monkeypatch):
    # The biblehub fetcher raises (timeout / HTTP error / no translations for
    # a slightly-wrong LLM-cited reference) rather than returning {} — that
    # exception must become DevotionalError, not escape to the API layer.
    async def fake_fetch(reference, languages=None):
        raise RuntimeError("VerseFetchError: no translations for JHN 14:27")

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    with pytest.raises(devotional.DevotionalError):
        await devotional.resolve_seed_verse("John 14:27", "user")


@pytest.mark.asyncio
async def test_resolve_seed_verse_raises_when_kjv_text_is_blank(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": ""}

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    with pytest.raises(devotional.DevotionalError):
        await devotional.resolve_seed_verse("John 14:27", "user")


@pytest.mark.asyncio
async def test_resolve_seed_verse_range_survives_one_bad_verse(monkeypatch):
    async def fake_fetch(reference, languages=None):
        if reference == "PSA 23:2":
            raise RuntimeError("VerseFetchError: transient biblehub failure")
        return {
            "PSA 23:1": {"eng-KJV": "The LORD is my shepherd; I shall not want."},
            "PSA 23:3": {"eng-KJV": "He restoreth my soul:"},
        }[reference]

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, translations = await devotional.resolve_seed_verse("Psalm 23:1-3", "user")
    assert ref == "PSA 23:1-3"
    assert translations["eng-KJV"] == (
        "The LORD is my shepherd; I shall not want. He restoreth my soul:"
    )


@pytest.mark.asyncio
async def test_resolve_seed_verse_range_clamps_reference_to_fetched_span(monkeypatch):
    fetched = []

    async def fake_fetch(reference, languages=None):
        fetched.append(reference)
        return {"eng-KJV": "verse text"}

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, translations = await devotional.resolve_seed_verse("Psalm 23:1-999", "user")
    # Only start..start+_MAX_RANGE_SPAN were fetched, so the returned
    # reference must name that span, not "PSA 23:1-999".
    cap = devotional._MAX_RANGE_SPAN
    assert ref == f"PSA 23:1-{1 + cap}"
    assert len(fetched) == cap + 1


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


@pytest.mark.asyncio
async def test_rotation_pick_used_when_no_ref_and_no_theme(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"text for {reference}"}

    called = False

    async def boom(_theme):
        nonlocal called
        called = True
        return "JHN 3:16"

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    monkeypatch.setattr(devotional, "pick_verse_for_theme", boom)

    from chatbot.devotional_rotation import pick_from_rotation

    expected = pick_from_rotation(555, 4)

    ref, translations = await devotional.resolve_seed_verse("", "system", rotation=(555, 4))

    assert ref == expected
    assert called is False  # the LLM theme-pick path was not used
    assert translations["eng-KJV"] == f"text for {expected}"


@pytest.mark.asyncio
async def test_rotation_ignored_when_a_theme_is_given(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"text for {reference}"}

    async def theme_pick(theme):
        assert theme == "facing anxiety"
        return "ISA 41:10"

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    monkeypatch.setattr(devotional, "pick_verse_for_theme", theme_pick)

    ref, _ = await devotional.resolve_seed_verse("facing anxiety", "user", rotation=(555, 4))
    assert ref == "ISA 41:10"


@pytest.mark.asyncio
async def test_no_rotation_keeps_the_old_theme_pick_path(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"text for {reference}"}

    async def theme_pick(theme):
        assert theme is None
        return "PSA 23:1"

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    monkeypatch.setattr(devotional, "pick_verse_for_theme", theme_pick)

    ref, _ = await devotional.resolve_seed_verse("", "system", rotation=None)
    assert ref == "PSA 23:1"


# ── FIX 1: the rotation path recovers when a pool ref can't be fetched ──
# The pool is validated against Complete.db, but the runtime fetches from a
# different corpus, so an unresolvable pool entry must fall through rather
# than hard-error (the rotation path deliberately bypasses FALLBACK_VERSES).


@pytest.mark.asyncio
async def test_rotation_first_card_unresolvable_falls_through_to_next_card(monkeypatch):
    def fake_pick_from_rotation(seed, cursor):
        return {0: "GEN 1:1", 1: "JHN 3:16"}[cursor]

    async def fake_fetch(reference, languages=None):
        if reference == "GEN 1:1":
            return {}  # first card: no text in the runtime corpus
        return {"eng-KJV": f"text for {reference}"}

    theme_pick_called = False

    async def theme_pick(theme):
        nonlocal theme_pick_called
        theme_pick_called = True
        return "PSA 23:1"

    monkeypatch.setattr(devotional, "pick_from_rotation", fake_pick_from_rotation)
    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    monkeypatch.setattr(devotional, "pick_verse_for_theme", theme_pick)

    ref, translations = await devotional.resolve_seed_verse("", "system", rotation=(42, 0))
    assert ref == "JHN 3:16"  # cursor + 1
    assert translations["eng-KJV"] == "text for JHN 3:16"
    assert theme_pick_called is False


@pytest.mark.asyncio
async def test_rotation_both_cards_unresolvable_falls_back_to_theme_pick(monkeypatch):
    def fake_pick_from_rotation(seed, cursor):
        return {0: "GEN 1:1", 1: "JHN 3:16"}[cursor]

    async def fake_fetch(reference, languages=None):
        if reference in ("GEN 1:1", "JHN 3:16"):
            return {}
        return {"eng-KJV": f"text for {reference}"}

    seen_theme = "unset"

    async def theme_pick(theme):
        nonlocal seen_theme
        seen_theme = theme
        return "ROM 8:28"

    monkeypatch.setattr(devotional, "pick_from_rotation", fake_pick_from_rotation)
    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    monkeypatch.setattr(devotional, "pick_verse_for_theme", theme_pick)

    ref, translations = await devotional.resolve_seed_verse("", "system", rotation=(42, 0))
    assert ref == "ROM 8:28"
    assert seen_theme is None  # pick_verse_for_theme(None) — the FALLBACK_VERSES net
    assert translations["eng-KJV"] == "text for ROM 8:28"


@pytest.mark.asyncio
async def test_typed_reference_failure_still_raises_with_no_fallback(monkeypatch):
    # The non-rotation path is unchanged: a DevotionalError propagates and
    # pick_verse_for_theme is never used as a safety net.
    theme_pick_called = False

    async def fake_fetch(reference, languages=None):
        return {}

    async def theme_pick(theme):
        nonlocal theme_pick_called
        theme_pick_called = True
        return "PSA 23:1"

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    monkeypatch.setattr(devotional, "pick_verse_for_theme", theme_pick)

    with pytest.raises(devotional.DevotionalError):
        await devotional.resolve_seed_verse("John 14:27", "user")
    assert theme_pick_called is False
