# Devotional Audio ("Listen") + Devotional-of-the-Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user listen to a generated devotional (Google Cloud TTS, Neural2, mixed with a background music bed) in a full-screen synced-scroll "Listen" experience, and make "Pick one for me" generate its text (and, transitively, its audio) at most once per GMT+8 day regardless of how many users request it.

**Architecture:** Two independently-shippable slices in the existing FastAPI `chatbot` service and its React frontend. Slice A (devotional-of-the-day) adds a tiny SQLite-backed cache that short-circuits the rotation ("Pick one for me") generation path. Slice B (audio) adds a `chatbot/devotional_audio.py` module (Google Neural2 TTS + ffmpeg mixing, chunked to stay under Google's per-request character cap), a filesystem cache keyed by content hash, a new endpoint, and a Radix Dialog-based full-screen overlay that scrolls the devotional text in sync with `audio.currentTime`.

**Tech Stack:** Python 3.13 / FastAPI (`chatbot/`), `dataset` (SQLite), `google-cloud-texttospeech`, `ffmpeg`/`ffprobe` (subprocess); React / TypeScript / Zustand / `@radix-ui/react-dialog` / Tailwind (`frontend/`); pytest + pytest-asyncio; vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-17-devotional-audio-design.md`

## Global Constraints

- Locked TTS settings (never user-configurable in v1): voice `en-US-Neural2-C`, `speaking_rate=0.90`.
- Locked background-music mix (never user-configurable in v1): one fixed track, `volume=0.168` gain, 2s fade-in, 4s fade-out, trimmed to the narration's exact length (`amix duration=first`).
- Google Cloud TTS's `synthesizeSpeech` caps input at 5,000 characters per request — devotional text must be chunked on paragraph boundaries, never split mid-paragraph.
- Devotional-of-the-day's "today" is a **fixed UTC+8 offset** (`now_utc + 8h`), not a named timezone — GMT+8 has no DST.
- Only the rotation ("Pick one for me") generation path reads or writes the devotional-of-the-day cache. Typed-reference and theme-based devotionals never touch it.
- When a "Pick one for me" response was served from the daily cache, the client's local rotation cursor must **not** advance.
- No active eviction/cron jobs for either the audio cache or the daily-devotional table — both rely on date/hash-based natural irrelevance.
- Audio generation is a **synchronous** blocking call (not SSE) — acceptable per spike latency (single-digit seconds).

---

## Task 1: Devotional-of-the-day store

**Files:**
- Create: `chatbot/devotional_of_day.py`
- Test: `tests/chatbot/test_devotional_of_day.py`

**Interfaces:**
- Produces: `get_db(url: str | None = None) -> dataset.Database`, `init_db(db) -> None`, `get_default_db() -> dataset.Database` (lazy singleton), `today_gmt8() -> str` (`'YYYY-MM-DD'`), `get_for_date(db, date_gmt8: str) -> dict | None`, `get_today(db) -> dict | None`, `capture_if_absent(db, *, reference: str, translations: dict, text: str, date_gmt8: str | None = None) -> bool`. A returned row dict has keys `date_gmt8, reference, translations (dict), text, created_at`.

- [ ] **Step 1: Write the failing test file**

```python
# tests/chatbot/test_devotional_of_day.py
import pytest

from chatbot import devotional_of_day as dod


@pytest.fixture
def db():
    database = dod.get_db("sqlite:///:memory:")
    dod.init_db(database)
    return database


def test_get_for_date_returns_none_when_absent(db):
    assert dod.get_for_date(db, "2026-09-17") is None


def test_capture_then_get_round_trips(db):
    won = dod.capture_if_absent(
        db,
        reference="JHN 14:27",
        translations={"eng-KJV": "Peace I leave with you..."},
        text="Some devotional text.",
        date_gmt8="2026-09-17",
    )
    assert won is True

    row = dod.get_for_date(db, "2026-09-17")
    assert row["reference"] == "JHN 14:27"
    assert row["translations"] == {"eng-KJV": "Peace I leave with you..."}
    assert row["text"] == "Some devotional text."


def test_second_capture_same_day_loses_the_race(db):
    first = dod.capture_if_absent(
        db, reference="JHN 14:27", translations={}, text="First.", date_gmt8="2026-09-17",
    )
    second = dod.capture_if_absent(
        db, reference="PSA 23:1", translations={}, text="Second.", date_gmt8="2026-09-17",
    )
    assert first is True
    assert second is False
    # The canonical row stays the first writer's — the "losing" caller's own
    # generation is simply never persisted, never overwrites it.
    assert dod.get_for_date(db, "2026-09-17")["text"] == "First."


def test_different_dates_are_independent(db):
    dod.capture_if_absent(db, reference="A", translations={}, text="Day one.", date_gmt8="2026-09-17")
    dod.capture_if_absent(db, reference="B", translations={}, text="Day two.", date_gmt8="2026-09-18")
    assert dod.get_for_date(db, "2026-09-17")["text"] == "Day one."
    assert dod.get_for_date(db, "2026-09-18")["text"] == "Day two."


def test_get_today_uses_todays_date(db, monkeypatch):
    monkeypatch.setattr(dod, "today_gmt8", lambda: "2026-09-17")
    dod.capture_if_absent(db, reference="A", translations={}, text="Today's pick.", date_gmt8="2026-09-17")
    assert dod.get_today(db)["text"] == "Today's pick."


def test_today_gmt8_uses_a_fixed_utc_plus_8_offset(monkeypatch):
    import datetime as real_datetime

    class FixedDatetime(real_datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            # 2026-09-17 20:00 UTC -> 2026-09-18 04:00 GMT+8: the date rolls
            # over even though it's still "today" in UTC.
            return real_datetime.datetime(2026, 9, 17, 20, 0, tzinfo=real_datetime.timezone.utc)

    monkeypatch.setattr(dod, "datetime", FixedDatetime)
    assert dod.today_gmt8() == "2026-09-18"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/chatbot/test_devotional_of_day.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'chatbot.devotional_of_day'`

- [ ] **Step 3: Implement `chatbot/devotional_of_day.py`**

```python
"""SQLite-backed store for Devotional mode's shared "devotional of the day".

Only the rotation ("Pick one for me") path reads or writes this table — a
typed reference or theme always generates fresh. The first "Pick one for
me" generation on a given GMT+8 calendar day becomes what every other
"Pick one for me" request returns for the rest of that day, so the LLM
devotional-text call (and, transitively, the audio-cache-keyed TTS call)
happens at most once per day regardless of how many users hit it. See
docs/superpowers/specs/2026-09-17-devotional-audio-design.md.

Separate database from Complete.db, feedback.db, and shares.db. Opened via
the `dataset` library (already used by share_store.py).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import dataset
from sqlalchemy.exc import IntegrityError

DEFAULT_DB_URL = os.environ.get("DEVOTIONAL_OF_DAY_DB_URL", "sqlite:///devotional-of-day.db")

_db = None


def get_db(url: Optional[str] = None) -> "dataset.Database":
    return dataset.connect(url or DEFAULT_DB_URL)


def init_db(db: "dataset.Database") -> None:
    table = db.create_table("daily_devotional", primary_id="date_gmt8", primary_type=db.types.string(10))
    for col in ("reference", "translations_json", "text", "created_at"):
        table.create_column(col, db.types.text)


def get_default_db() -> "dataset.Database":
    """Lazily-connected singleton for the app's own runtime. Tests should
    use get_db()/init_db() on their own throwaway URL instead."""
    global _db
    if _db is None:
        _db = get_db()
        init_db(_db)
    return _db


def today_gmt8() -> str:
    """Today's date in a fixed UTC+8 offset ('YYYY-MM-DD'). GMT+8 (e.g.
    Singapore, Shanghai, Kuala Lumpur) has no DST, so a fixed offset is
    correct and needs no zoneinfo dependency."""
    return (datetime.now(timezone.utc) + timedelta(hours=8)).date().isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def get_for_date(db: "dataset.Database", date_gmt8: str) -> Optional[dict]:
    row = db["daily_devotional"].find_one(date_gmt8=date_gmt8)
    if row is None:
        return None
    row = dict(row)
    row["translations"] = json.loads(row["translations_json"])
    return row


def get_today(db: "dataset.Database") -> Optional[dict]:
    return get_for_date(db, today_gmt8())


def capture_if_absent(
    db: "dataset.Database",
    *,
    reference: str,
    translations: dict,
    text: str,
    date_gmt8: Optional[str] = None,
) -> bool:
    """Persist (reference, translations, text) as the given day's canonical
    devotional if no row exists yet for that day. Returns True if this call
    became canonical, False if another request already won — a benign
    race; the caller's own result is unaffected either way."""
    date_gmt8 = date_gmt8 or today_gmt8()
    try:
        db["daily_devotional"].insert({
            "date_gmt8": date_gmt8,
            "reference": reference,
            "translations_json": json.dumps(translations),
            "text": text,
            "created_at": _now_iso(),
        })
        return True
    except IntegrityError:
        return False
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/chatbot/test_devotional_of_day.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/devotional_of_day.py tests/chatbot/test_devotional_of_day.py
git commit -m "$(cat <<'EOF'
feat(devotional): add devotional-of-the-day SQLite store

New chatbot/devotional_of_day.py — a tiny store keyed by a fixed
GMT+8 calendar date, with race-safe capture-if-absent semantics. Not
yet wired into the devotional generation flow.
EOF
)"
```

---

## Task 2: Wire devotional-of-the-day into `stream_devotional` and surface it through `/chat/stream`

**Files:**
- Modify: `chatbot/devotional.py:266-318`
- Modify: `chatbot/api.py:399-444`
- Test: `tests/chatbot/test_devotional_daily_cache.py` (new)

**Interfaces:**
- Consumes: `devotional_of_day.get_default_db()`, `.get_today(db)`, `.capture_if_absent(db, *, reference, translations, text)` from Task 1.
- Produces: `stream_devotional(...)`'s `"done"` events now always include `"from_daily_cache": bool`. `chatbot/api.py`'s `/chat/stream` `final` event's `result["data"]` now always includes `"from_daily_cache": bool`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_devotional_daily_cache.py
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/chatbot/test_devotional_daily_cache.py -v`
Expected: FAIL — `KeyError: 'from_daily_cache'` (the "done" events don't have this key yet)

- [ ] **Step 3: Modify `chatbot/devotional.py`**

Add the import near the top (alongside the other `chatbot.*` imports, after the existing `from chatbot.devotional_rotation import pick_from_rotation` line):

```python
from chatbot import devotional_of_day
```

Replace lines 266-292 (`resolve_seed_verse`) with a new helper plus a refactored body that uses it — same resolution behavior, just factored so `stream_devotional` can reuse the same "is this a rotation pick" test:

```python
def _is_rotation_pick(raw: Optional[str], source: str, rotation: Optional[Tuple[int, int]]) -> bool:
    """True for "Pick one for me": no typed verse reference, no typed
    theme, and the client supplied a rotation (seed, cursor) slot. Shared
    by resolve_seed_verse (which path to resolve) and stream_devotional
    (whether devotional-of-the-day applies)."""
    if source == "user" and raw and _resolve_verse_reference(raw) is not None:
        return False
    theme = raw.strip() if (raw and raw.strip()) else None
    return theme is None and rotation is not None


async def resolve_seed_verse(
    raw: Optional[str],
    source: str,
    rotation: Optional[Tuple[int, int]] = None,
) -> Tuple[str, Dict[str, str]]:
    """(usfm_reference, translations_dict). For a single verse the dict is the
    real multi-translation payload; for a range it's {"eng-KJV": joined text}.
    Raises DevotionalError when no verse text can be fetched.

    `rotation` is the client's (seed, cursor) for the "Pick one for me"
    path: when there's no user reference and no theme, the seed verse comes
    from pick_from_rotation() instead of a stateless LLM call (which used to
    return Psalm 23:1 almost every time). That path also carries a fetch
    fallback (next card → theme pick → FALLBACK_VERSES) so an unresolvable
    pool entry isn't fatal. Themed and typed-reference picks ignore
    `rotation` and still propagate a DevotionalError unchanged."""
    if _is_rotation_pick(raw, source, rotation):
        return await _resolve_rotation_seed_verse(*rotation)

    ref = _resolve_verse_reference(raw) if (source == "user" and raw) else None
    if ref is None:
        theme = raw.strip() if (raw and raw.strip()) else None
        ref = await pick_verse_for_theme(theme)

    resolved = await _resolve_ref_to_text(ref)
    if resolved is None:
        raise DevotionalError(f"No verse text for {ref}")
    return resolved
```

Replace lines 295-318 (`stream_devotional`) with:

```python
async def stream_devotional(
    raw: Optional[str],
    source: str,
    page_context: Optional[str] = None,
    rotation: Optional[Tuple[int, int]] = None,
) -> AsyncIterator[Dict[str, object]]:
    """Resolve the seed verse, then stream the devotional. Yields
    {"type": "stream", "chunk": str} while generating, then one terminal
    event: {"type": "error", "message": str} on an LLM stream failure, or
    {"type": "done", "text", "reference", "translations", "from_daily_cache"}
    on success. A DevotionalError from seed-verse resolution propagates to
    the caller.

    For a rotation ("Pick one for me") request, the first successful
    generation each GMT+8 day is captured as that day's shared devotional
    (chatbot.devotional_of_day); every later rotation request that same day
    short-circuits straight to that cached text with no verse resolution or
    LLM call, and yields from_daily_cache=True. Typed-reference and theme
    requests never read or write that cache and always generate fresh."""
    is_rotation_pick = _is_rotation_pick(raw, source, rotation)

    if is_rotation_pick:
        cached = devotional_of_day.get_today(devotional_of_day.get_default_db())
        if cached is not None:
            yield {
                "type": "done",
                "text": cached["text"],
                "reference": cached["reference"],
                "translations": cached["translations"],
                "from_daily_cache": True,
            }
            return

    reference, translations = await resolve_seed_verse(raw, source, rotation)
    verse_text = _kjv_text(translations)
    prompt = build_devotional_prompt(reference, verse_text)

    full = ""
    async for ev in stream_devotional_completion(DEVOTIONAL_SYSTEM_PROMPT, prompt, max_tokens=1800):
        if ev["type"] == "stream":
            full += ev["chunk"]
            yield {"type": "stream", "chunk": ev["chunk"]}
        elif ev["type"] == "error":
            yield {"type": "error", "message": ev["message"]}
            return

    if is_rotation_pick:
        devotional_of_day.capture_if_absent(
            devotional_of_day.get_default_db(),
            reference=reference,
            translations=translations,
            text=full,
        )

    yield {
        "type": "done",
        "text": full,
        "reference": reference,
        "translations": translations,
        "from_daily_cache": False,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/chatbot/test_devotional_daily_cache.py tests/chatbot/test_devotional_stream.py tests/chatbot/test_devotional_resolve.py -v`
Expected: PASS — the 3 new tests plus every pre-existing devotional-stream/resolve test (they don't assert exact dict equality on the "done" event, so the added key doesn't break them).

- [ ] **Step 5: Modify `chatbot/api.py` to surface `from_daily_cache`**

In the `/chat/stream` devotional branch, change line 399 from:

```python
            full_text, reference, translations, stream_error = "", None, {}, None
```

to:

```python
            full_text, reference, translations, stream_error = "", None, {}, None
            from_daily_cache = False
```

Change the `"done"` branch (lines 406-409) from:

```python
                    elif ev["type"] == "done":
                        full_text = ev["text"]
                        reference = ev["reference"]
                        translations = ev["translations"]
```

to:

```python
                    elif ev["type"] == "done":
                        full_text = ev["text"]
                        reference = ev["reference"]
                        translations = ev["translations"]
                        from_daily_cache = bool(ev.get("from_daily_cache", False))
```

Change the success `data` dict (lines 433-438) from:

```python
                    "data": {
                        "reference": reference,
                        "translations": translations,
                        "book_context": book_context,
                        "devotional": full_text,
                    },
```

to:

```python
                    "data": {
                        "reference": reference,
                        "translations": translations,
                        "book_context": book_context,
                        "devotional": full_text,
                        "from_daily_cache": from_daily_cache,
                    },
```

- [ ] **Step 6: Add an endpoint-level test**

Add to `tests/chatbot/test_chat_stream_devotional.py` (reusing its existing `_events`/`_patch_stream_devotional` helpers):

```python
def test_devotional_stream_surfaces_from_daily_cache(monkeypatch):
    async def fake_stream(raw, source, page_context=None, rotation=None):
        yield {"type": "done", "text": "Cached text.", "reference": "GEN 8:22",
               "translations": {"eng-KJV": "..."}, "from_daily_cache": True}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "", "mode": "devotional", "mode_params": {"source": "system"},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["data"]["from_daily_cache"] is True
```

This test needs the `client` fixture — check the top of `tests/chatbot/test_chat_stream_devotional.py`; if `client` isn't already a bare-name fixture parameter there (it's provided by `tests/chatbot/conftest.py`), add `client` as a parameter to this new test function, matching how other tests in that file already receive it via pytest fixture injection.

- [ ] **Step 7: Run the full devotional test suite**

Run: `pytest tests/chatbot/test_devotional_daily_cache.py tests/chatbot/test_devotional_stream.py tests/chatbot/test_devotional_resolve.py tests/chatbot/test_chat_stream_devotional.py tests/chatbot/test_devotional_rotation.py -v`
Expected: PASS, all tests including the pinned rotation-sequence test (untouched — rotation.py itself wasn't modified).

- [ ] **Step 8: Commit**

```bash
git add chatbot/devotional.py chatbot/api.py tests/chatbot/test_devotional_daily_cache.py tests/chatbot/test_chat_stream_devotional.py
git commit -m "$(cat <<'EOF'
feat(devotional): serve devotional-of-the-day on the rotation path

"Pick one for me" now checks devotional_of_day before resolving a
verse or calling the LLM; a hit returns the day's already-generated
text with from_daily_cache=True and skips generation entirely. A
miss generates as before and captures the result for the rest of the
GMT+8 day. Typed-reference and theme devotionals are untouched.
EOF
)"
```

---

## Task 3: Frontend — don't advance the rotation cursor on a daily-cache hit

**Files:**
- Modify: `frontend/src/components/shell/ChatPane.tsx:309-314`
- Test: `frontend/src/components/shell/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `ChatApiResponse.data?: Record<string, unknown> | null` (existing type) now may carry `from_daily_cache: boolean`.

- [ ] **Step 1: Write the failing test**

Add this test to `frontend/src/components/shell/ChatPane.test.tsx`, immediately after the existing test named `'a system-source devotional sends rotation seed+cursor and advances the cursor'` (which defines the `devotionalFinal()` helper this reuses):

```tsx
  it('a system-source devotional does not advance the cursor when served from the daily cache', async () => {
    localStorage.clear()
    useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
    const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: 'Let me find a verse for you…',
    })

    vi.spyOn(chatApi, 'postChatStream').mockImplementation(async (_payload, handlers) => {
      handlers?.onChunk?.('')
      const final = devotionalFinal()
      return { ...final, data: { ...final.data, from_daily_cache: true } } as never
    })

    render(<ChatPane sessionId={session.id} />)
    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()

    expect(useDevotionalRotationStore.getState().cursor).toBe(0)
    expect(useSessionsStore.getState().sessions[session.id].modeParams.delivered).toBe(true)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx -t "does not advance the cursor when served from the daily cache"`
Expected: FAIL — cursor is `1`, not `0` (the current code advances unconditionally).

- [ ] **Step 3: Modify `ChatPane.tsx`**

Change lines 309-314 from:

```tsx
        if (response && response.type !== 'error') {
          updateModeParams(sessionId, { delivered: true })
          if (isRotationPick) {
            useDevotionalRotationStore.getState().advance()
          }
        }
```

to:

```tsx
        if (response && response.type !== 'error') {
          updateModeParams(sessionId, { delivered: true })
          const fromDailyCache = response.data?.from_daily_cache === true
          if (isRotationPick && !fromDailyCache) {
            useDevotionalRotationStore.getState().advance()
          }
        }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: PASS — the new test plus every pre-existing test in the file (the added field/branch doesn't change behavior when `from_daily_cache` is absent or `false`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "$(cat <<'EOF'
fix(devotional): don't advance the rotation cursor on a daily-cache hit

A user who receives the shared devotional-of-the-day (rather than
their own deck's next card) shouldn't have their personal rotation
position consumed for it.
EOF
)"
```

This completes the devotional-of-the-day slice end-to-end.

---

## Task 4: Devotional audio pipeline (`chatbot/devotional_audio.py`)

**Files:**
- Create: `chatbot/devotional_audio.py`
- Test: `tests/chatbot/test_devotional_audio.py`

**Interfaces:**
- Produces: `VOICE_NAME`, `SPEAKING_RATE`, `MUSIC_TRACK_PATH`, `MUSIC_GAIN`, `AUDIO_CACHE_DIR: Path` (constants); `DevotionalAudioError(Exception)`; `cache_key(text: str) -> str`; `synthesize_devotional_audio(text: str) -> bytes` (raises `DevotionalAudioError`). Internal, individually monkeypatchable: `_chunk_text(text, max_chars=MAX_CHUNK_CHARS) -> list[str]`, `_run_ffmpeg(args: list[str]) -> None`, `_probe_duration_seconds(path: Path) -> float`.

First, add the dependency so the module is importable while writing this task:

- [ ] **Step 0: Install the TTS client library locally**

Run: `pip install "google-cloud-texttospeech>=2.16.0"`
(This gets pinned into `requirements.txt` properly in Task 10 — installing it now just makes this task's tests runnable.)

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_devotional_audio.py
from pathlib import Path

import pytest

from chatbot import devotional_audio as da


def test_chunk_text_single_short_paragraph_is_one_chunk():
    text = "Just one short paragraph."
    assert da._chunk_text(text) == [text]


def test_chunk_text_packs_short_paragraphs_together():
    paragraphs = ["Paragraph one is short.", "Paragraph two is short too.", "Paragraph three, also short."]
    text = "\n\n".join(paragraphs)
    chunks = da._chunk_text(text, max_chars=100)
    assert len(chunks) < len(paragraphs)
    for p in paragraphs:
        assert any(p in c for c in chunks)


def test_chunk_text_never_exceeds_max_chars_when_paragraphs_allow():
    paragraphs = [f"Paragraph {i} is a moderate length paragraph of prose." for i in range(10)]
    text = "\n\n".join(paragraphs)
    chunks = da._chunk_text(text, max_chars=200)
    assert all(len(c) <= 200 for c in chunks)


def test_chunk_text_keeps_an_oversized_paragraph_whole():
    huge_paragraph = "word " * 2000  # ~10,000 chars, over any max_chars we'd use
    text = f"Short intro.\n\n{huge_paragraph}"
    chunks = da._chunk_text(text, max_chars=4800)
    assert huge_paragraph.strip() in chunks  # never split mid-paragraph


def test_cache_key_changes_with_text():
    assert da.cache_key("Hello") != da.cache_key("Goodbye")


def test_cache_key_is_deterministic():
    assert da.cache_key("Hello") == da.cache_key("Hello")


def test_synthesize_devotional_audio_empty_text_raises():
    with pytest.raises(da.DevotionalAudioError):
        da.synthesize_devotional_audio("   ")


def test_synthesize_devotional_audio_single_chunk_skips_concat(monkeypatch):
    class FakeResponse:
        audio_content = b"fake-narration-bytes"

    class FakeClient:
        def synthesize_speech(self, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(da.texttospeech, "TextToSpeechClient", lambda: FakeClient())

    ffmpeg_calls = []

    def fake_run_ffmpeg(args):
        ffmpeg_calls.append(args)
        Path(args[-1]).write_bytes(b"mixed-audio-bytes")

    monkeypatch.setattr(da, "_run_ffmpeg", fake_run_ffmpeg)
    monkeypatch.setattr(da, "_probe_duration_seconds", lambda path: 12.5)

    result = da.synthesize_devotional_audio("A short devotional with one paragraph.")

    assert result == b"mixed-audio-bytes"
    assert len(ffmpeg_calls) == 1  # only the final mix call, no concat call
    assert "amix" in ffmpeg_calls[0][ffmpeg_calls[0].index("-filter_complex") + 1]


def test_synthesize_devotional_audio_multi_chunk_concatenates(monkeypatch):
    class FakeResponse:
        audio_content = b"fake-chunk-bytes"

    class FakeClient:
        def synthesize_speech(self, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(da.texttospeech, "TextToSpeechClient", lambda: FakeClient())

    ffmpeg_calls = []

    def fake_run_ffmpeg(args):
        ffmpeg_calls.append(args)
        Path(args[-1]).write_bytes(b"mixed-audio-bytes")

    monkeypatch.setattr(da, "_run_ffmpeg", fake_run_ffmpeg)
    monkeypatch.setattr(da, "_probe_duration_seconds", lambda path: 30.0)

    long_text = "\n\n".join(f"Paragraph {i}. " + ("word " * 400) for i in range(4))
    result = da.synthesize_devotional_audio(long_text)

    assert result == b"mixed-audio-bytes"
    assert len(ffmpeg_calls) == 2  # one concat call, then one mix call
    assert "concat" in ffmpeg_calls[0]
    assert "amix" in ffmpeg_calls[1][ffmpeg_calls[1].index("-filter_complex") + 1]


def test_synthesize_devotional_audio_wraps_tts_failure(monkeypatch):
    class FailingClient:
        def synthesize_speech(self, **kwargs):
            raise RuntimeError("quota exceeded")

    monkeypatch.setattr(da.texttospeech, "TextToSpeechClient", lambda: FailingClient())

    with pytest.raises(da.DevotionalAudioError):
        da.synthesize_devotional_audio("Some devotional text.")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/chatbot/test_devotional_audio.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.devotional_audio'`

- [ ] **Step 3: Implement `chatbot/devotional_audio.py`**

```python
"""Google Cloud TTS (Neural2) + ffmpeg mixing for devotional audio.

Turns a devotional's full text into one finished MP3: Neural2 narration,
split on paragraph boundaries to stay under Google's 5,000-character
per-request cap, concatenated back together, then mixed under a fixed
background music bed at the settings validated by a throwaway spike. See
docs/superpowers/specs/2026-09-17-devotional-audio-design.md. Voice, rate,
and music settings are fixed constants, not user-configurable, for v1.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
from pathlib import Path
from typing import List

from google.cloud import texttospeech

VOICE_NAME = "en-US-Neural2-C"
SPEAKING_RATE = 0.90
MUSIC_TRACK_PATH = Path(__file__).resolve().parent / "data" / "devotional_stillness.mp3"
MUSIC_GAIN = 0.168
MUSIC_FADE_IN_SECONDS = 2
MUSIC_FADE_OUT_SECONDS = 4

# Google's synthesizeSpeech caps input at 5,000 characters; this leaves
# headroom so a chunk never lands right at the limit.
MAX_CHUNK_CHARS = 4800

AUDIO_CACHE_DIR = Path(os.environ.get("AUDIO_CACHE_DIR", "AUDIO_CACHE"))
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)


class DevotionalAudioError(Exception):
    """Raised when TTS synthesis or ffmpeg processing fails."""


def cache_key(text: str) -> str:
    """SHA-256 of (text, voice, rate, music track, music gain) — changing
    any of the locked settings later auto-invalidates old cache entries."""
    payload = "\x1f".join([
        text,
        VOICE_NAME,
        f"{SPEAKING_RATE:.2f}",
        MUSIC_TRACK_PATH.name,
        f"{MUSIC_GAIN:.3f}",
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _chunk_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> List[str]:
    """Split on blank-line paragraph boundaries, packing consecutive
    paragraphs into chunks up to max_chars without ever splitting a
    paragraph. A single paragraph longer than max_chars is kept whole
    (devotional prose paragraphs never run that long in practice; TTS
    simply raises for that pathological input rather than silently
    cutting a sentence)."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return [text]

    chunks: List[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) > max_chars and current:
            chunks.append(current)
            current = paragraph
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _synthesize_chunk(client: "texttospeech.TextToSpeechClient", text: str) -> bytes:
    try:
        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(language_code="en-US", name=VOICE_NAME),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=SPEAKING_RATE,
            ),
        )
    except Exception as exc:  # noqa: BLE001 — any TTS failure becomes a clean app error
        raise DevotionalAudioError(f"TTS synthesis failed: {exc}") from exc
    return response.audio_content


def _run_ffmpeg(args: List[str]) -> None:
    try:
        subprocess.run(args, check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise DevotionalAudioError(f"ffmpeg failed: {exc}") from exc


def _probe_duration_seconds(path: Path) -> float:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            ],
            check=True, capture_output=True, text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise DevotionalAudioError(f"ffprobe failed: {exc}") from exc
    return float(result.stdout.strip())


def synthesize_devotional_audio(text: str) -> bytes:
    """Full devotional text -> final mixed MP3 bytes (Neural2 narration +
    background bed). Raises DevotionalAudioError on any TTS/ffmpeg
    failure."""
    if not text.strip():
        raise DevotionalAudioError("Cannot synthesize audio for empty text")

    client = texttospeech.TextToSpeechClient()
    chunks = _chunk_text(text)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        chunk_paths = []
        for i, chunk in enumerate(chunks):
            audio_bytes = _synthesize_chunk(client, chunk)
            chunk_path = tmp_path / f"chunk_{i}.mp3"
            chunk_path.write_bytes(audio_bytes)
            chunk_paths.append(chunk_path)

        if len(chunk_paths) == 1:
            narration_path = chunk_paths[0]
        else:
            narration_path = tmp_path / "narration.mp3"
            concat_list = tmp_path / "concat.txt"
            concat_list.write_text("\n".join(f"file '{p.name}'" for p in chunk_paths))
            _run_ffmpeg([
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", str(concat_list), "-c", "copy", str(narration_path),
            ])

        narration_duration = _probe_duration_seconds(narration_path)
        fade_out_start = max(0.0, narration_duration - MUSIC_FADE_OUT_SECONDS)

        out_path = tmp_path / "mixed.mp3"
        _run_ffmpeg([
            "ffmpeg", "-y",
            "-i", str(narration_path),
            "-i", str(MUSIC_TRACK_PATH),
            "-filter_complex",
            (
                f"[1:a]atrim=0:{narration_duration},"
                f"afade=t=in:st=0:d={MUSIC_FADE_IN_SECONDS},"
                f"afade=t=out:st={fade_out_start}:d={MUSIC_FADE_OUT_SECONDS},"
                f"volume={MUSIC_GAIN}[music];"
                "[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[out]"
            ),
            "-map", "[out]", "-ac", "2", "-b:a", "192k", str(out_path),
        ])
        return out_path.read_bytes()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/chatbot/test_devotional_audio.py -v`
Expected: PASS (10 tests). Note: this creates an `AUDIO_CACHE/` directory in the repo root as an import side effect (harmless, and it'll be gitignored in Task 10).

- [ ] **Step 5: Commit**

```bash
git add chatbot/devotional_audio.py tests/chatbot/test_devotional_audio.py
git commit -m "$(cat <<'EOF'
feat(devotional): add Google Neural2 TTS + ffmpeg mixing pipeline

chatbot/devotional_audio.py: chunks devotional text on paragraph
boundaries to respect Google's 5,000-char synthesizeSpeech cap,
synthesizes each chunk with the locked en-US-Neural2-C voice at
0.90x speed, concatenates via ffmpeg, and mixes under the fixed
background bed at the spike-validated settings (0.168 gain, 2s/4s
fades). Not yet wired to an endpoint or the real music asset.
EOF
)"
```

---

## Task 5: Commit the background music asset

**Files:**
- Create (binary): `chatbot/data/devotional_stillness.mp3`

**Interfaces:**
- Produces: the file `chatbot/devotional_audio.py`'s `MUSIC_TRACK_PATH` constant points at (Task 4 already references this exact path).

- [ ] **Step 1: Copy the validated track into the repo**

```bash
cp "/Volumes/HomeX/Chris/Downloads/Devotional Stillness.mp3" chatbot/data/devotional_stillness.mp3
```

- [ ] **Step 2: Verify it's a valid audio file at the expected path**

Run: `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 chatbot/data/devotional_stillness.mp3`
Expected: a numeric duration printed (e.g. `189.600000`), no errors.

- [ ] **Step 3: Commit**

```bash
git add chatbot/data/devotional_stillness.mp3
git commit -m "$(cat <<'EOF'
feat(devotional): add the fixed devotional-audio background track

The one background bed chatbot/devotional_audio.py mixes under
every devotional's narration (voice/rate/music settings locked via
a throwaway TTS spike, see the 2026-09-17 design doc).
EOF
)"
```

---

## Task 6: `POST /devotional/audio` endpoint + static serving

**Files:**
- Modify: `chatbot/schemas.py`
- Modify: `chatbot/api.py`
- Modify: `chatbot/__init__.py`
- Test: `tests/chatbot/test_devotional_audio_endpoint.py`

**Interfaces:**
- Consumes: `chatbot.devotional_audio.{synthesize_devotional_audio, cache_key, DevotionalAudioError, AUDIO_CACHE_DIR}` (Task 4).
- Produces: `POST /devotional/audio` → `{"audio_url": "/devotional-audio/<hash>.mp3"}`; static files served at `GET /devotional-audio/<hash>.mp3`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_devotional_audio_endpoint.py
import pytest

from chatbot import api as api_module
from chatbot.devotional_audio import DevotionalAudioError, cache_key


@pytest.fixture
def isolated_audio_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "AUDIO_CACHE_DIR", tmp_path)
    return tmp_path


def test_generates_and_caches_audio(client, monkeypatch, isolated_audio_cache):
    calls = []

    def fake_synthesize(text):
        calls.append(text)
        return b"fake-mp3-bytes"

    monkeypatch.setattr(api_module, "synthesize_devotional_audio", fake_synthesize)

    resp = client.post("/devotional/audio", json={"reference": "JHN 14:27", "text": "Peace be with you."})
    assert resp.status_code == 200
    key = resp.json()["audio_url"].removeprefix("/devotional-audio/").removesuffix(".mp3")
    assert (isolated_audio_cache / f"{key}.mp3").read_bytes() == b"fake-mp3-bytes"
    assert calls == ["Peace be with you."]


def test_cache_hit_skips_regeneration(client, monkeypatch, isolated_audio_cache):
    key = cache_key("Already generated.")
    (isolated_audio_cache / f"{key}.mp3").write_bytes(b"already-cached")

    def fail_synthesize(text):
        raise AssertionError("synthesize_devotional_audio must not be called on a cache hit")

    monkeypatch.setattr(api_module, "synthesize_devotional_audio", fail_synthesize)

    resp = client.post("/devotional/audio", json={"reference": "JHN 14:27", "text": "Already generated."})
    assert resp.status_code == 200
    assert resp.json()["audio_url"] == f"/devotional-audio/{key}.mp3"


def test_tts_failure_returns_502(client, monkeypatch, isolated_audio_cache):
    def fake_synthesize(text):
        raise DevotionalAudioError("TTS synthesis failed: boom")

    monkeypatch.setattr(api_module, "synthesize_devotional_audio", fake_synthesize)

    resp = client.post("/devotional/audio", json={"reference": "JHN 14:27", "text": "Some text."})
    assert resp.status_code == 502


def test_empty_text_returns_422(client, isolated_audio_cache):
    resp = client.post("/devotional/audio", json={"reference": "JHN 14:27", "text": "   "})
    assert resp.status_code == 422
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/chatbot/test_devotional_audio_endpoint.py -v`
Expected: FAIL — `404 Not Found` (route doesn't exist yet) / `AttributeError` on `api_module.AUDIO_CACHE_DIR`.

- [ ] **Step 3: Add schemas to `chatbot/schemas.py`**

Append at the end of the file:

```python
class DevotionalAudioRequest(BaseModel):
    reference: str = Field(..., description="Verse reference the devotional is for (cache/debug only — the audio cache key is derived from text alone)")
    text: str = Field(..., description="The devotional's full text to synthesize")


class DevotionalAudioResponse(BaseModel):
    audio_url: str = Field(..., description="Path to the generated/cached MP3, relative to the chatbot service root (e.g. '/devotional-audio/<hash>.mp3')")
```

- [ ] **Step 4: Add the endpoint to `chatbot/api.py`**

Add `DevotionalAudioRequest, DevotionalAudioResponse` to the existing `from chatbot.schemas import (...)` block (alphabetical, matching the existing ordering — insert after `ChatResponse`, before `PassageResponse`).

Add a new top-level import, right after the existing `from chatbot.book_context import get_book_context` line:

```python
from chatbot.devotional_audio import (
    AUDIO_CACHE_DIR,
    DevotionalAudioError,
    cache_key,
    synthesize_devotional_audio,
)
```

Add the endpoint itself, placed right after `list_study_wikis` (after line 213, before the `# ---... Chat endpoints` section starting at line 215):

```python
@router.post("/devotional/audio", response_model=DevotionalAudioResponse)
async def post_devotional_audio(request: DevotionalAudioRequest):
    """Generate (or reuse a cached) Neural2 MP3 for a devotional's full
    text. Synchronous — spike latency for a devotional-length text is a
    few seconds, acceptable for a blocking call with a client-side
    spinner. See chatbot/devotional_audio.py."""
    if not request.text.strip():
        raise HTTPException(status_code=422, detail="text must not be empty")

    key = cache_key(request.text)
    cache_path = AUDIO_CACHE_DIR / f"{key}.mp3"
    if not cache_path.exists():
        try:
            audio_bytes = await asyncio.to_thread(synthesize_devotional_audio, request.text)
        except DevotionalAudioError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        cache_path.write_bytes(audio_bytes)

    return DevotionalAudioResponse(audio_url=f"/devotional-audio/{key}.mp3")
```

Note: `api.py` imports these names at module level (unlike the lazily-imported `stream_devotional`/`DevotionalError`), so tests patch `chatbot.api.<name>` directly — matching Step 1's tests above.

- [ ] **Step 5: Mount `AUDIO_CACHE_DIR` as static files in `chatbot/__init__.py`**

Add the import near the top, alongside the existing `from fastapi.middleware.cors import CORSMiddleware` line:

```python
from fastapi.staticfiles import StaticFiles
```

In `create_chatbot_app()`, after `app.include_router(router, prefix="")` and before `return app`:

```python
    from chatbot.devotional_audio import AUDIO_CACHE_DIR
    app.mount("/devotional-audio", StaticFiles(directory=str(AUDIO_CACHE_DIR)), name="devotional-audio")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pytest tests/chatbot/test_devotional_audio_endpoint.py -v`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the full chatbot test suite to check for regressions**

Run: `pytest tests/chatbot/ -v`
Expected: PASS, all tests.

- [ ] **Step 8: Commit**

```bash
git add chatbot/schemas.py chatbot/api.py chatbot/__init__.py tests/chatbot/test_devotional_audio_endpoint.py
git commit -m "$(cat <<'EOF'
feat(devotional): add POST /devotional/audio + static serving

Content-hash-cached: a cache hit skips TTS/ffmpeg entirely. Mounted
at /devotional-audio, reachable through the existing generic
/api/bible-chat/* proxy in myproject.py with no proxy changes needed.
EOF
)"
```

---

## Task 7: Frontend — `postDevotionalAudio` API client

**Files:**
- Modify: `frontend/src/lib/chatApi.ts`
- Test: `frontend/src/lib/chatApi.test.ts`

**Interfaces:**
- Produces: `postDevotionalAudio(reference: string, text: string): Promise<{ audio_url: string }>` — resolves the backend's relative `audio_url` against `CHAT_API` so callers get a directly-fetchable URL.

- [ ] **Step 1: Write the failing test**

Add `postDevotionalAudio` to the existing import list at the top of `frontend/src/lib/chatApi.test.ts` (alongside `postChat`, `postChatStream`, etc.), then add:

```ts
describe('postDevotionalAudio', () => {
  it('posts reference+text and resolves audio_url against CHAT_API', async () => {
    mockFetchOnce({ audio_url: '/devotional-audio/abc123.mp3' })
    const result = await postDevotionalAudio('JHN 14:27', 'Peace be with you.')
    expect(postedBody()).toEqual({ reference: 'JHN 14:27', text: 'Peace be with you.' })
    expect(result.audio_url).toBe('/api/bible-chat/devotional-audio/abc123.mp3')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/chatApi.test.ts -t postDevotionalAudio`
Expected: FAIL — `postDevotionalAudio is not a function` (not exported yet).

- [ ] **Step 3: Implement in `chatApi.ts`**

Add near the other simple GET/POST helpers (e.g. right after `fetchBookContext`):

```ts
export interface DevotionalAudioResponse {
  audio_url: string
}

/**
 * Generate (or reuse a cached) Neural2 MP3 for a devotional's full text.
 * The backend's `audio_url` is relative to the chatbot service root (e.g.
 * '/devotional-audio/<hash>.mp3'); this resolves it against CHAT_API so
 * the result is directly usable as an <audio src>.
 */
export async function postDevotionalAudio(reference: string, text: string): Promise<DevotionalAudioResponse> {
  const res = await fetch(`${CHAT_API}/devotional/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference, text }),
  })
  const json = await parseJsonResponse<DevotionalAudioResponse>(res)
  return { audio_url: `${CHAT_API}${json.audio_url}` }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/chatApi.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/chatApi.ts frontend/src/lib/chatApi.test.ts
git commit -m "$(cat <<'EOF'
feat(devotional): add postDevotionalAudio API client function
EOF
)"
```

---

## Task 8: `DevotionalListenOverlay` component

**Files:**
- Create: `frontend/src/components/artifacts/DevotionalListenOverlay.tsx`
- Modify: `frontend/src/index.css`
- Test: `frontend/src/components/artifacts/DevotionalListenOverlay.test.tsx`

**Interfaces:**
- Consumes: `postDevotionalAudio(reference, text)` from Task 7.
- Produces: `DevotionalListenOverlay({ reference: string, text: string, open: boolean, onClose: () => void })` — a full-viewport Radix Dialog overlay (matches the existing `VerseFullscreen.tsx` pattern: `Dialog.Root` / `Dialog.Portal` / `Dialog.Overlay` / `Dialog.Content`, all `fixed inset-0 z-50`).

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/artifacts/DevotionalListenOverlay.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DevotionalListenOverlay } from './DevotionalListenOverlay'
import * as chatApi from '@/lib/chatApi'

describe('DevotionalListenOverlay', () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('shows a loading state, then the play control once audio is ready', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockResolvedValue({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={() => {}} />)

    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /play/i })).toBeInTheDocument()
    expect(chatApi.postDevotionalAudio).toHaveBeenCalledWith('JHN 14:27', 'Peace be with you.')
  })

  it('shows an error state when audio generation fails', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockRejectedValue(new Error('boom'))
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={() => {}} />)
    expect(await screen.findByText(/audio unavailable/i)).toBeInTheDocument()
  })

  it('toggles play/pause on the audio element', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockResolvedValue({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={() => {}} />)

    const playButton = await screen.findByRole('button', { name: /play/i })
    await userEvent.click(playButton)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /play/i })).toBeInTheDocument()
  })

  it('Done pauses the audio and calls onClose', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockResolvedValue({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
    const onClose = vi.fn()
    render(<DevotionalListenOverlay reference="JHN 14:27" text="Peace be with you." open onClose={onClose} />)
    await screen.findByRole('button', { name: /play/i })

    await userEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/artifacts/DevotionalListenOverlay.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Add the gradient keyframes to `frontend/src/index.css`**

Add near the other overlay keyframes (right after the `settings-*` keyframes/rules block):

```css
@keyframes devotional-listen-gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.devotional-listen-bg {
  background: linear-gradient(
    120deg,
    var(--color-surface),
    var(--color-accent-dark),
    var(--color-surface-alt),
    var(--color-accent)
  );
  background-size: 300% 300%;
  animation: devotional-listen-gradient 20s ease-in-out infinite;
}
```

- [ ] **Step 4: Implement `DevotionalListenOverlay.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Pause, Play } from 'lucide-react'
import { postDevotionalAudio } from '@/lib/chatApi'

export interface DevotionalListenOverlayProps {
  reference: string
  text: string
  open: boolean
  onClose: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

export function DevotionalListenOverlay({ reference, text, open, onClose }: DevotionalListenOverlayProps) {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus('loading')
    setAudioUrl(null)
    setIsPlaying(false)
    postDevotionalAudio(reference, text)
      .then((res) => {
        if (cancelled) return
        setAudioUrl(res.audio_url)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, reference, text])

  function stopScrollSync() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  function tick() {
    const audio = audioRef.current
    const container = textRef.current
    if (audio && container && audio.duration > 0) {
      const ratio = audio.currentTime / audio.duration
      const maxScroll = container.scrollHeight - container.clientHeight
      container.scrollTop = ratio * maxScroll
    }
    if (audio && !audio.paused) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  // React state (isPlaying) is the source of truth for which action to
  // take, not audio.paused — keeps this correct even where the DOM
  // property lags (or, in tests, isn't really implemented).
  function handleTogglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      stopScrollSync()
    } else {
      audio.play()
      setIsPlaying(true)
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  function handleDone() {
    audioRef.current?.pause()
    setIsPlaying(false)
    stopScrollSync()
    onClose()
  }

  useEffect(() => stopScrollSync, [])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) handleDone() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 devotional-listen-bg" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col items-center gap-4 p-8 focus:outline-none devotional-listen-bg"
        >
          <Dialog.Title className="text-sm font-semibold tracking-tight text-white/90">
            {reference}
          </Dialog.Title>

          {status === 'loading' && (
            <div className="flex-1 flex items-center justify-center text-white/80 text-sm">
              Preparing audio…
            </div>
          )}

          {status === 'error' && (
            <div className="flex-1 flex items-center justify-center text-white/90 text-sm">
              Audio unavailable — try again later.
            </div>
          )}

          {status === 'ready' && audioUrl && (
            <>
              <audio ref={audioRef} src={audioUrl} preload="auto" />
              <div
                ref={textRef}
                className="flex-1 w-full max-w-2xl overflow-y-auto text-white text-lg leading-relaxed whitespace-pre-wrap px-4"
              >
                {text}
              </div>
              <button
                type="button"
                onClick={handleTogglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Play className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            </>
          )}

          <Dialog.Close asChild>
            <button
              type="button"
              onClick={handleDone}
              aria-label="Done"
              className="text-xs px-3 py-1.5 rounded border border-white/30 text-white/90 hover:bg-white/10"
            >
              Done
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/artifacts/DevotionalListenOverlay.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/artifacts/DevotionalListenOverlay.tsx frontend/src/index.css frontend/src/components/artifacts/DevotionalListenOverlay.test.tsx
git commit -m "$(cat <<'EOF'
feat(devotional): add full-screen Listen overlay component

Radix Dialog (matching VerseFullscreen's fixed inset-0 pattern), an
animated theme-token gradient background, and scroll position driven
directly by audio.currentTime/duration each animation frame — so
pause/resume stay exactly in sync with playback. Not yet wired into
DevotionalArtifact.
EOF
)"
```

---

## Task 9: Wire the "Listen" button into `DevotionalArtifact`

**Files:**
- Modify: `frontend/src/components/artifacts/DevotionalArtifact.tsx`
- Test: `frontend/src/components/artifacts/DevotionalArtifact.test.tsx`

**Interfaces:**
- Consumes: `DevotionalListenOverlay` from Task 8.

- [ ] **Step 1: Write the failing test**

Add `import * as chatApi from '@/lib/chatApi'` to the top of `frontend/src/components/artifacts/DevotionalArtifact.test.tsx`, then add:

```tsx
  it('opens the listen overlay when the Listen button is clicked', async () => {
    vi.spyOn(chatApi, 'postDevotionalAudio').mockResolvedValue({ audio_url: '/api/bible-chat/devotional-audio/abc.mp3' })
    render(<DevotionalArtifact reference="JHN 14:27" text="Peace be with you." />)

    expect(screen.queryByText(/preparing audio/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /listen/i }))
    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/artifacts/DevotionalArtifact.test.tsx -t "opens the listen overlay"`
Expected: FAIL — no button with accessible name matching `/listen/i`.

- [ ] **Step 3: Modify `DevotionalArtifact.tsx`**

Replace the full file contents with:

```tsx
import { useState } from 'react'
import { Check, Copy, Headphones } from 'lucide-react'
import { renderMarkdown } from '@/lib/renderMarkdown'
import { DevotionalListenOverlay } from './DevotionalListenOverlay'
import type { DevotionalArtifactParams } from '@/types/session'

export function DevotionalArtifact({ reference, text }: DevotionalArtifactParams) {
  const [copied, setCopied] = useState(false)
  const [listenOpen, setListenOpen] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied by the browser; nothing useful to
      // do beyond leaving the copy affordance unconfirmed.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{reference}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setListenOpen(true)}
            aria-label="Listen to devotional"
            title="Listen"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
          >
            <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={copy}
            aria-label="Copy devotional"
            title="Copy"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-green)]" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <div className="text-sm leading-relaxed max-w-prose">{renderMarkdown(text)}</div>
      <DevotionalListenOverlay
        reference={reference}
        text={text}
        open={listenOpen}
        onClose={() => setListenOpen(false)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/artifacts/DevotionalArtifact.test.tsx`
Expected: PASS, all tests in the file (the pre-existing "copy" test still passes unchanged — the Copy button's role/label/behavior are untouched).

- [ ] **Step 5: Run the full frontend test suite to check for regressions**

Run: `cd frontend && npx vitest run`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/artifacts/DevotionalArtifact.tsx frontend/src/components/artifacts/DevotionalArtifact.test.tsx
git commit -m "$(cat <<'EOF'
feat(devotional): add Listen button to the devotional artifact

Opens the full-screen synced-scroll audio overlay next to the
existing copy button.
EOF
)"
```

This completes the audio slice end-to-end (usable in local dev with real GCP credentials on the chatbot process's environment).

---

## Task 10: Deployment wiring

**Files:**
- Modify: `requirements.txt`
- Modify: `Dockerfile.chatbot:16-18`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `.gitignore` (if `AUDIO_CACHE/` isn't already covered)

- [ ] **Step 1: Add the TTS dependency to `requirements.txt`**

In the "Chatbot dependencies" section (after the existing `python-dotenv>=1.0.0` line), add:

```
google-cloud-texttospeech>=2.16.0   # chatbot/devotional_audio.py: Neural2 TTS
```

- [ ] **Step 2: Install ffmpeg in `Dockerfile.chatbot`**

Insert right after `WORKDIR /app` (line 16), before `COPY requirements.txt .`:

```dockerfile
# ffmpeg/ffprobe: chatbot/devotional_audio.py concatenates and mixes
# devotional audio. Not present in python:3.13-slim.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 3: Add named volumes and env vars to `docker-compose.yml`**

In the top-level `volumes:` block (after the existing `shares-db:` entry), add:

```yaml
  # Filesystem cache of generated devotional-audio MP3s, keyed by content
  # hash. Mounted into `chatbot` at /app/AUDIO_CACHE. No active eviction —
  # see the design doc.
  audio-cache:

  # Persistent store for the devotional-of-the-day cache
  # (devotional-of-day.db), mounted into `chatbot` at
  # /app/devotional-of-day-db. Survives container recreation.
  devotional-of-day-db:
```

In the `chatbot:` service's `environment:` block (after the existing `MYBIBLETOOLBOX_PATH` line), add:

```yaml
      # Filesystem cache dir for generated devotional audio (see the
      # `audio-cache` volume below).
      AUDIO_CACHE_DIR: /app/AUDIO_CACHE
      # Directory-scoped named volume, same pattern as flask-api's
      # FEEDBACK_DB_URL / SHARE_DB_URL.
      DEVOTIONAL_OF_DAY_DB_URL: sqlite:////app/devotional-of-day-db/devotional-of-day.db
      # Fixed in-container path the GCP service-account key is bind-mounted
      # to below. The HOST path that key lives at is
      # GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH in .env — never commit the
      # key itself.
      GOOGLE_APPLICATION_CREDENTIALS: /run/secrets/gcp-tts.json
```

In the `chatbot:` service's `volumes:` block (after the existing `./Complete.db:/app/Complete.db` line), add:

```yaml
      - audio-cache:/app/AUDIO_CACHE
      - devotional-of-day-db:/app/devotional-of-day-db
      - ${GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH}:/run/secrets/gcp-tts.json:ro
```

- [ ] **Step 4: Document the new env vars in `.env.example`**

Add a new section (after the existing "Chatbot LLM provider" section):

```
# ─── Devotional audio (Google Cloud Text-to-Speech, Neural2) ──────────────
# Read by chatbot/devotional_audio.py. Absolute path on the HOST machine to
# a Google Cloud service-account JSON key with the "Cloud Text-to-Speech
# User" role. docker-compose bind-mounts this file read-only into the
# chatbot container at /run/secrets/gcp-tts.json — GOOGLE_APPLICATION_CREDENTIALS
# is set to that fixed in-container path directly in docker-compose.yml, not
# here. Never commit the key itself — path only.
GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH=
```

- [ ] **Step 5: Gitignore the local dev cache directory**

Check whether `AUDIO_CACHE/` (the default relative path `devotional_audio.py` creates when `AUDIO_CACHE_DIR` is unset, e.g. running `pytest`/`uvicorn` directly outside Docker) is already covered by an existing `CACHED_PAGES`-style ignore rule:

Run: `grep -n "CACHED_PAGES" .gitignore`

If `CACHED_PAGES/` has its own line, add `AUDIO_CACHE/` as a sibling line right after it. If there's a broader pattern already covering it, no change needed.

- [ ] **Step 6: Verify the compose file is syntactically valid**

Run: `docker compose config --quiet`
Expected: no output, exit code 0 (an empty `GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH` in a local `.env` is fine at this stage — it only needs a real value at `docker compose up`).

- [ ] **Step 7: Commit**

```bash
git add requirements.txt Dockerfile.chatbot docker-compose.yml .env.example .gitignore
git commit -m "$(cat <<'EOF'
chore(devotional): wire audio deployment (ffmpeg, TTS dep, volumes, env)

Installs ffmpeg in the chatbot image, adds google-cloud-texttospeech
to requirements.txt, and adds the audio-cache + devotional-of-day-db
named volumes plus the GCP credentials bind-mount to docker-compose.yml.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** voice/rate/music lock-in (Task 4), 5,000-char chunking (Task 4), audio content-hash caching (Task 4/6), synchronous endpoint (Task 6), static serving reachable through the existing generic proxy (Task 6, verified no proxy changes needed), full-screen Listen overlay with `currentTime`-driven scroll sync and pause/resume (Task 8), Listen button placement (Task 9), devotional-of-the-day store/serve/capture hooks and GMT+8 fixed-offset boundary (Tasks 1-2), rotation-only scope — typed/theme untouched (Task 2, explicitly tested), cursor non-advancement on a cache hit (Task 3), deployment (ffmpeg, dependency, volumes, credentials path, `.env.example`) (Task 10), background track committed as a repo asset (Task 5). No spec section is without a task.
- **Placeholder scan:** no TBD/TODO; every code step has real, complete code; no "similar to Task N" references — each task's code blocks are self-contained.
- **Type consistency:** `DevotionalAudioResponse.audio_url` (backend, relative path) vs. the frontend's `postDevotionalAudio` return (same field name, but resolved to an absolute-from-proxy-root URL) — deliberately different values at the same field name, called out explicitly in Task 7's docstring/comment so a later reader isn't confused. `from_daily_cache` is spelled identically end-to-end: `chatbot/devotional.py` (event dict) → `chatbot/api.py` (`result["data"]`) → frontend `ChatApiResponse.data` (Task 2/3). `cache_key`, `synthesize_devotional_audio`, `DevotionalAudioError`, `AUDIO_CACHE_DIR` are the exact names Task 4 produces and Task 6 consumes.
