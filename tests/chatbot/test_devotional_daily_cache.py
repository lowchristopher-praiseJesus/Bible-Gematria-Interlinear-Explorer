import pytest

from chatbot import devotional, devotional_of_day


@pytest.mark.asyncio
async def test_rotation_pick_hits_daily_cache_and_skips_generation(monkeypatch):
    async def fail_resolve(*args, **kwargs):
        raise AssertionError("resolve_seed_verse must not be called on a daily-cache hit")

    async def fail_completion(*args, **kwargs):
        raise AssertionError("stream_devotional_completion must not be called on a daily-cache hit")

    monkeypatch.setattr(devotional, "resolve_seed_verse", fail_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fail_completion)
    monkeypatch.setattr(devotional_of_day, "get_default_db", lambda: "fake-db")
    monkeypatch.setattr(
        devotional_of_day,
        "get_today",
        lambda db: {"reference": "GEN 8:22", "translations": {"eng-KJV": "..."}, "text": "Cached devotional."},
    )

    events = [e async for e in devotional.stream_devotional("", "system", None, (42, 3))]
    assert events == [{
        "type": "done",
        "text": "Cached devotional.",
        "reference": "GEN 8:22",
        "translations": {"eng-KJV": "..."},
        "from_daily_cache": True,
    }]


@pytest.mark.asyncio
async def test_rotation_pick_miss_generates_and_captures(monkeypatch):
    async def fake_resolve(raw, source, rotation=None):
        return "PRO 3:12", {"eng-KJV": "For whom the LORD loveth..."}

    async def fake_completion(system, user, *, max_tokens=1800):
        yield {"type": "stream", "chunk": "A generated devotional."}
        yield {"type": "done"}

    captured = {}

    def fake_capture_if_absent(db, *, reference, translations, text, date_gmt8=None):
        captured.update(reference=reference, translations=translations, text=text)
        return True

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)
    monkeypatch.setattr(devotional_of_day, "get_default_db", lambda: "fake-db")
    monkeypatch.setattr(devotional_of_day, "get_today", lambda db: None)
    monkeypatch.setattr(devotional_of_day, "capture_if_absent", fake_capture_if_absent)

    events = [e async for e in devotional.stream_devotional("", "system", None, (42, 3))]
    done = events[-1]
    assert done == {
        "type": "done",
        "text": "A generated devotional.",
        "reference": "PRO 3:12",
        "translations": {"eng-KJV": "For whom the LORD loveth..."},
        "from_daily_cache": False,
    }
    assert captured == {
        "reference": "PRO 3:12",
        "translations": {"eng-KJV": "For whom the LORD loveth..."},
        "text": "A generated devotional.",
    }


@pytest.mark.asyncio
async def test_get_today_failure_falls_open_to_fresh_generation(monkeypatch):
    """A daily-cache read failure (e.g. sqlite locked) must not block "Pick
    one for me" — it should fall through to normal generation, same as a
    cache miss, with from_daily_cache: False."""

    async def fake_resolve(raw, source, rotation=None):
        return "PRO 3:12", {"eng-KJV": "For whom the LORD loveth..."}

    async def fake_completion(system, user, *, max_tokens=1800):
        yield {"type": "stream", "chunk": "A generated devotional."}
        yield {"type": "done"}

    def fail_get_today(db):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)
    monkeypatch.setattr(devotional_of_day, "get_default_db", lambda: "fake-db")
    monkeypatch.setattr(devotional_of_day, "get_today", fail_get_today)
    monkeypatch.setattr(devotional_of_day, "capture_if_absent", lambda *a, **k: True)

    events = [e async for e in devotional.stream_devotional("", "system", None, (42, 3))]
    done = events[-1]
    assert done["from_daily_cache"] is False
    assert done["text"] == "A generated devotional."


@pytest.mark.asyncio
async def test_capture_failure_still_yields_done(monkeypatch):
    """A capture_if_absent failure must not prevent the stream from
    completing normally for the user — the "done" event still fires."""

    async def fake_resolve(raw, source, rotation=None):
        return "PRO 3:12", {"eng-KJV": "For whom the LORD loveth..."}

    async def fake_completion(system, user, *, max_tokens=1800):
        yield {"type": "stream", "chunk": "A generated devotional."}
        yield {"type": "done"}

    def fail_capture(db, *, reference, translations, text, date_gmt8=None):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)
    monkeypatch.setattr(devotional_of_day, "get_default_db", lambda: "fake-db")
    monkeypatch.setattr(devotional_of_day, "get_today", lambda db: None)
    monkeypatch.setattr(devotional_of_day, "capture_if_absent", fail_capture)

    events = [e async for e in devotional.stream_devotional("", "system", None, (42, 3))]
    done = events[-1]
    assert done["type"] == "done"
    assert done["text"] == "A generated devotional."
    assert done["from_daily_cache"] is False


@pytest.mark.asyncio
async def test_empty_generated_text_skips_capture(monkeypatch):
    """A stream that yields no chunks (e.g. an upstream connection drop with
    no explicit error event) must not be captured as the day's canonical
    devotional."""

    async def fake_resolve(raw, source, rotation=None):
        return "PRO 3:12", {"eng-KJV": "For whom the LORD loveth..."}

    async def fake_completion(system, user, *, max_tokens=1800):
        yield {"type": "done"}
        return
        yield  # pragma: no cover - makes this an async generator

    def fail_capture(*args, **kwargs):
        raise AssertionError("capture_if_absent must not be called for empty generated text")

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)
    monkeypatch.setattr(devotional_of_day, "get_default_db", lambda: "fake-db")
    monkeypatch.setattr(devotional_of_day, "get_today", lambda db: None)
    monkeypatch.setattr(devotional_of_day, "capture_if_absent", fail_capture)

    events = [e async for e in devotional.stream_devotional("", "system", None, (42, 3))]
    done = events[-1]
    assert done["type"] == "done"
    assert done["text"] == ""


@pytest.mark.asyncio
async def test_typed_reference_never_touches_daily_cache(monkeypatch):
    async def fake_resolve(raw, source, rotation=None):
        return "JHN 14:27", {"eng-KJV": "Peace I leave with you..."}

    async def fake_completion(system, user, *, max_tokens=1800):
        yield {"type": "stream", "chunk": "Some words."}
        yield {"type": "done"}

    def fail(*args, **kwargs):
        raise AssertionError("typed-reference devotionals must not touch devotional_of_day")

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)
    monkeypatch.setattr(devotional_of_day, "get_today", fail)
    monkeypatch.setattr(devotional_of_day, "capture_if_absent", fail)

    events = [e async for e in devotional.stream_devotional("John 14:27", "user", None, None)]
    assert events[-1]["from_daily_cache"] is False
