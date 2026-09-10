# Devotional Annual Seeded-Shuffle Rotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Devotional mode's "Pick one for me" deal a different verse every day for at least a year, by replacing its single stateless LLM call with a deterministic draw from a curated ≥366-verse pool dealt as a seeded shuffled deck.

**Architecture:** A new static pool module (`chatbot/data/devotional_verses.py`) holds ≥366 USFM references. A new pure function `pick_from_rotation(seed, cursor)` (`chatbot/devotional_rotation.py`) returns `shuffled(pool, seed, epoch)[offset]` where `epoch, offset = divmod(cursor, len(pool))`. `resolve_seed_verse` takes an optional `rotation=(seed, cursor)` and uses it *only* on the no-reference/no-theme path; the themed and typed-reference paths are untouched. The client (no accounts — `localStorage` only) keeps a per-browser random `seed` and a monotonic `cursor` in a new Zustand store, injects them into the devotional request's `mode_params`, and advances the cursor once per delivered rotation devotional.

**Tech Stack:** Python 3 / FastAPI (`chatbot/`), pytest. React + TypeScript + Zustand `persist` (`frontend/`), vitest. `dataset` over `Complete.db` (SQLite, not in repo).

**Spec:** `docs/superpowers/specs/2026-09-10-devotional-annual-rotation-design.md`

## Global Constraints

- **Pool size:** `len(DEVOTIONAL_POOL) >= 366`. Every entry is a USFM reference matching `chatbot.devotional._USFM_REF_RE` (`^([1-3]?[A-Z]{2,3})\s+(\d+):(\d+)(?:-(\d+))?$`), e.g. `"PSA 23:1"`, `"1CO 13:4-7"`. No duplicate entries.
- **`Complete.db` is not in the repo.** Any test that reads it must `pytest.skip` when `chatbot/../Complete.db` is absent, so CI stays green. Full DB validation is a local script.
- **Determinism:** `pick_from_rotation` must be a pure function of `(seed, cursor)` — no clock, no `random` module global state, no network, no LLM. Seed the RNG with a string (`random.Random(f"{seed}:{epoch}")`); the str-seed path is stable across Python versions, `hash()` is not.
- **No regression for older clients / other paths:** a devotional request without `rotation_seed`/`rotation_cursor` in `mode_params`, a themed pick, and a typed reference must all behave exactly as they do today (`rotation=None`).
- **Follow existing patterns:** static data as a Python module like `chatbot/data/reading_plans.py`; new store mirrors `frontend/src/store/useReadingPlanStore.ts` (persist + `sanitizePersistedState` + `migrate` + `merge`).
- **Commit** after each task's tests pass. Conventional-commit style, matching recent history (`feat(devotional): …`).
- **Attribution** on every commit message:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa
  ```

---

## File Structure

**Create**
- `chatbot/data/devotional_verses.py` — `DEVOTIONAL_POOL: tuple[str, ...]`. Static data only, no logic. Contents in **Appendix A**.
- `chatbot/devotional_rotation.py` — `pick_from_rotation(seed, cursor) -> str` and its private `_shuffled_pool(seed, epoch) -> list[str]` helper. Imports the pool; no other project imports.
- `scripts/validate_devotional_pool.py` — local-only. Connects to `Complete.db`, asserts every pool entry resolves to a real verse with non-empty KJV text, prints a report. Not imported by anything; not run in CI.
- `frontend/src/store/useDevotionalRotationStore.ts` — Zustand `persist` store `{ seed: number | null, cursor: number }` with `ensureSeed()`, `advance()`, `reset()`.
- `tests/chatbot/test_devotional_pool.py`
- `tests/chatbot/test_devotional_rotation.py`
- `frontend/src/store/useDevotionalRotationStore.test.ts`

**Modify**
- `chatbot/devotional.py` — `resolve_seed_verse` and `stream_devotional` gain an optional `rotation` parameter (`tuple[int, int] | None`). ~4 changed lines in `resolve_seed_verse` (`devotional.py:188-195`), one changed signature + one forwarded arg in `stream_devotional` (`devotional.py:230-238`).
- `chatbot/api.py` — the `/chat/stream` devotional branch (`api.py:336-345`) reads `rotation_seed`/`rotation_cursor` from `md` and passes `rotation=` into `stream_devotional`.
- `frontend/src/types/session.ts` — `ModeParams` gains `rotationSeed?: number` and `rotationCursor?: number`.
- `frontend/src/components/shell/ChatPane.tsx` — `runDevotionalTurn` (`ChatPane.tsx:162-181`): inject `rotationSeed`/`rotationCursor` for the system-source empty-message pick, persist them, and call `advance()` on a non-error response.
- `tests/chatbot/test_devotional_resolve.py`, `tests/chatbot/test_chat_stream_devotional.py`, `frontend/src/components/shell/ChatPane.test.tsx` — add cases.
- `docs/superpowers/specs/2026-09-07-devotional-mode-design.md` — one-line cross-reference to the new spec.
- `CLAUDE.md` — one line under "Routes" / mode notes about the rotation pool.

---

## Task 1: Devotional verse pool data module

**Files:**
- Create: `chatbot/data/devotional_verses.py`
- Create: `tests/chatbot/test_devotional_pool.py`
- Create: `scripts/validate_devotional_pool.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `chatbot.data.devotional_verses.DEVOTIONAL_POOL: tuple[str, ...]` — an ordered, duplicate-free tuple of ≥366 USFM references. Task 2 imports it.

- [ ] **Step 1: Write the failing structural test**

Create `tests/chatbot/test_devotional_pool.py`:

```python
import re
from pathlib import Path

import pytest

from chatbot.data.devotional_verses import DEVOTIONAL_POOL
from chatbot.devotional import _USFM_REF_RE

_DB_PATH = Path(__file__).resolve().parents[2] / "Complete.db"

# Invert the router's name->USFM map so a DB check can go USFM->book name.
from chatbot.router import _usfm_from_name  # noqa: E402

_USFM_TO_NAME = {}
for _name in [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
    "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
    "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
    "Psalm", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
    "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
    "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
    "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
    "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
]:
    _USFM_TO_NAME[_usfm_from_name(_name)] = _name


def test_pool_has_at_least_a_year_of_verses():
    assert len(DEVOTIONAL_POOL) >= 366


def test_pool_entries_are_wellformed_usfm_refs():
    bad = [r for r in DEVOTIONAL_POOL if not _USFM_REF_RE.match(r)]
    assert bad == [], f"malformed refs: {bad}"


def test_pool_has_no_duplicates():
    seen, dupes = set(), []
    for r in DEVOTIONAL_POOL:
        (dupes if r in seen else seen).append(r) if r in seen else seen.add(r)
    assert dupes == [], f"duplicate refs: {dupes}"


@pytest.mark.skipif(not _DB_PATH.exists(), reason="Complete.db not present")
def test_every_pool_ref_resolves_in_complete_db():
    import dataset

    db = dataset.connect(f"sqlite:///{_DB_PATH}")
    missing = []
    for ref in DEVOTIONAL_POOL:
        m = _USFM_REF_RE.match(ref)
        usfm, chapter, verse = m.group(1), int(m.group(2)), int(m.group(3))
        book = _USFM_TO_NAME.get(usfm)
        row = db["Complete"].find_one(book=book, cnum=chapter, vnum=verse)
        if row is None or not (row.get("text_1769") or "").strip():
            missing.append(ref)
    assert missing == [], f"refs with no KJV verse in Complete.db: {missing}"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pytest tests/chatbot/test_devotional_pool.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.data.devotional_verses'`.

- [ ] **Step 3: Create the pool module**

Create `chatbot/data/devotional_verses.py` with the exact docstring and tuple below, pasting the full reference list from **Appendix A** as the tuple body:

```python
"""Curated seed verses for Devotional mode's "Pick one for me" rotation.

`pick_from_rotation` (chatbot/devotional_rotation.py) deals this pool as a
per-browser seeded shuffled deck: every reference is delivered once before
any repeat, giving well over a year of distinct daily devotionals before
the deck reshuffles for a new "epoch".

Each entry is a USFM reference (book code, chapter:verse, optional -end)
matching chatbot.devotional._USFM_REF_RE. Keep the list duplicate-free and
>= 366 entries; tests/chatbot/test_devotional_pool.py enforces both, and
scripts/validate_devotional_pool.py checks every entry against Complete.db.
"""

DEVOTIONAL_POOL: tuple[str, ...] = (
    # --- Appendix A contents go here, verbatim ---
)
```

- [ ] **Step 4: Run the structural tests**

Run: `pytest tests/chatbot/test_devotional_pool.py -q -k "not resolves_in_complete_db"`
Expected: PASS (3 tests). The DB test is skipped unless `Complete.db` is present.

- [ ] **Step 5: Create the local DB-validation script**

Create `scripts/validate_devotional_pool.py`:

```python
"""Local check that every DEVOTIONAL_POOL entry is a real verse with KJV
text in Complete.db. Run from the repo root:  python scripts/validate_devotional_pool.py
Exits non-zero and lists offenders if any entry doesn't resolve."""

import sys
from pathlib import Path

import dataset

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chatbot.data.devotional_verses import DEVOTIONAL_POOL
from chatbot.devotional import _USFM_REF_RE
from chatbot.router import _usfm_from_name

_NAMES = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
    "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
    "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
    "Psalm", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
    "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
    "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
    "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
    "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
]
USFM_TO_NAME = {_usfm_from_name(n): n for n in _NAMES}

db_path = Path(__file__).resolve().parents[1] / "Complete.db"
if not db_path.exists():
    sys.exit(f"Complete.db not found at {db_path}")

db = dataset.connect(f"sqlite:///{db_path}")
bad = []
for ref in DEVOTIONAL_POOL:
    m = _USFM_REF_RE.match(ref)
    if not m:
        bad.append((ref, "malformed"))
        continue
    usfm, chapter, verse = m.group(1), int(m.group(2)), int(m.group(3))
    book = USFM_TO_NAME.get(usfm)
    row = db["Complete"].find_one(book=book, cnum=chapter, vnum=verse)
    if row is None:
        bad.append((ref, f"no row for {book} {chapter}:{verse}"))
    elif not (row.get("text_1769") or "").strip():
        bad.append((ref, "empty KJV text"))

print(f"checked {len(DEVOTIONAL_POOL)} refs, {len(bad)} problem(s)")
for ref, why in bad:
    print(f"  {ref}: {why}")
sys.exit(1 if bad else 0)
```

- [ ] **Step 6: Run the local validation (developer machine with `Complete.db`)**

Run: `python scripts/validate_devotional_pool.py`
Expected: `checked NNN refs, 0 problem(s)` and exit 0.
If any entry is flagged, delete that entry from `DEVOTIONAL_POOL` (the pool has generous headroom above 366) or correct its chapter:verse, then re-run until clean. Re-run `pytest tests/chatbot/test_devotional_pool.py -q` afterwards to confirm the count is still ≥ 366.

- [ ] **Step 7: Commit**

```bash
git add chatbot/data/devotional_verses.py tests/chatbot/test_devotional_pool.py scripts/validate_devotional_pool.py
git commit -m "feat(devotional): add curated seed-verse pool for the pick rotation"
```

---

## Task 2: Deterministic rotation pick

**Files:**
- Create: `chatbot/devotional_rotation.py`
- Create: `tests/chatbot/test_devotional_rotation.py`

**Interfaces:**
- Consumes: `chatbot.data.devotional_verses.DEVOTIONAL_POOL` (Task 1).
- Produces: `chatbot.devotional_rotation.pick_from_rotation(seed: int, cursor: int) -> str` — returns one USFM reference from the pool. Pure. For `cursor` in `0 .. len(pool)-1` the results are a permutation of the pool (each ref once). `cursor >= len(pool)` starts a fresh permutation ("epoch"). `cursor < 0` is treated as `0`. Task 3 calls this.

- [ ] **Step 1: Write the failing tests**

Create `tests/chatbot/test_devotional_rotation.py`:

```python
from chatbot.data.devotional_verses import DEVOTIONAL_POOL
from chatbot.devotional_rotation import pick_from_rotation

N = len(DEVOTIONAL_POOL)


def test_same_seed_and_cursor_is_deterministic():
    a = pick_from_rotation(42, 7)
    b = pick_from_rotation(42, 7)
    assert a == b
    assert a in DEVOTIONAL_POOL


def test_one_epoch_covers_every_verse_exactly_once():
    picks = [pick_from_rotation(1234, c) for c in range(N)]
    assert sorted(picks) == sorted(DEVOTIONAL_POOL)
    assert len(set(picks)) == N


def test_different_seeds_give_a_different_order():
    order_a = [pick_from_rotation(1, c) for c in range(N)]
    order_b = [pick_from_rotation(2, c) for c in range(N)]
    assert order_a != order_b


def test_cursor_past_the_pool_starts_a_new_epoch_without_raising():
    first_epoch = [pick_from_rotation(9, c) for c in range(N)]
    second_epoch = [pick_from_rotation(9, c) for c in range(N, 2 * N)]
    assert sorted(second_epoch) == sorted(DEVOTIONAL_POOL)  # still a permutation
    assert first_epoch != second_epoch                      # reshuffled
    assert pick_from_rotation(9, N * 5 + 3) in DEVOTIONAL_POOL


def test_negative_cursor_clamps_to_zero():
    assert pick_from_rotation(77, -5) == pick_from_rotation(77, 0)
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pytest tests/chatbot/test_devotional_rotation.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.devotional_rotation'`.

- [ ] **Step 3: Implement the module**

Create `chatbot/devotional_rotation.py`:

```python
"""Deterministic seed-verse picker for Devotional mode's "Pick one for me".

The client holds a per-browser random `seed` and a monotonic `cursor`
(count of rotation devotionals delivered). This deals DEVOTIONAL_POOL as a
shuffled deck: `divmod(cursor, len(pool))` splits into an epoch (how many
full passes through the deck) and an offset within the current pass. Each
epoch is its own permutation, seeded by `f"{seed}:{epoch}"`, so a full
year is repeat-free and year two is a fresh order rather than a replay.

Pure: no clock, no module-global RNG, no network, no LLM. The string seed
path of random.Random is stable across Python versions (hash() is not).
"""

import random
from typing import List

from chatbot.data.devotional_verses import DEVOTIONAL_POOL


def _shuffled_pool(seed: int, epoch: int) -> List[str]:
    rng = random.Random(f"{seed}:{epoch}")
    pool = list(DEVOTIONAL_POOL)
    rng.shuffle(pool)
    return pool


def pick_from_rotation(seed: int, cursor: int) -> str:
    """One USFM reference from DEVOTIONAL_POOL for this (seed, cursor)."""
    if cursor < 0:
        cursor = 0
    epoch, offset = divmod(cursor, len(DEVOTIONAL_POOL))
    return _shuffled_pool(seed, epoch)[offset]
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/chatbot/test_devotional_rotation.py -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add chatbot/devotional_rotation.py tests/chatbot/test_devotional_rotation.py
git commit -m "feat(devotional): deterministic seeded-shuffle rotation picker"
```

---

## Task 3: Thread `rotation` through `resolve_seed_verse` and `stream_devotional`

**Files:**
- Modify: `chatbot/devotional.py` (`resolve_seed_verse` at `devotional.py:188`, `stream_devotional` at `devotional.py:230`)
- Modify: `tests/chatbot/test_devotional_resolve.py`

**Interfaces:**
- Consumes: `chatbot.devotional_rotation.pick_from_rotation` (Task 2).
- Produces:
  - `resolve_seed_verse(raw: Optional[str], source: str, rotation: Optional[Tuple[int, int]] = None) -> Tuple[str, Dict[str, str]]` — when `rotation` is a `(seed, cursor)` tuple **and** there is no user-supplied reference **and** no theme text, the seed reference is `pick_from_rotation(seed, cursor)`; every other case is unchanged.
  - `stream_devotional(raw, source, page_context=None, rotation: Optional[Tuple[int, int]] = None)` — forwards `rotation` to `resolve_seed_verse`. Task 4 calls this.

- [ ] **Step 1: Write the failing tests**

Add to `tests/chatbot/test_devotional_resolve.py` (match the file's existing async-test + monkeypatch style; these assume `fetch_verse_translations` is already stubbed there — reuse that fixture/monkeypatch, or add the same `monkeypatch.setattr` the other tests in the file use):

```python
import chatbot.devotional as devotional_mod


@pytest.mark.asyncio
async def test_rotation_pick_used_when_no_ref_and_no_theme(monkeypatch):
    # A stub so we don't hit the network for the resolved ref.
    async def fake_fetch(ref, languages=None):
        return {"eng-KJV": f"text for {ref}"}
    monkeypatch.setattr(devotional_mod, "fetch_verse_translations", fake_fetch)

    called = False

    async def boom(_theme):
        nonlocal called
        called = True
        return "JHN 3:16"
    monkeypatch.setattr(devotional_mod, "pick_verse_for_theme", boom)

    from chatbot.devotional_rotation import pick_from_rotation
    expected = pick_from_rotation(555, 4)

    ref, translations = await devotional_mod.resolve_seed_verse("", "system", rotation=(555, 4))

    assert ref == expected
    assert called is False  # the LLM theme-pick path was not used
    assert translations["eng-KJV"] == f"text for {expected}"


@pytest.mark.asyncio
async def test_rotation_ignored_when_a_theme_is_given(monkeypatch):
    async def fake_fetch(ref, languages=None):
        return {"eng-KJV": f"text for {ref}"}
    monkeypatch.setattr(devotional_mod, "fetch_verse_translations", fake_fetch)

    async def theme_pick(theme):
        assert theme == "facing anxiety"
        return "ISA 41:10"
    monkeypatch.setattr(devotional_mod, "pick_verse_for_theme", theme_pick)

    ref, _ = await devotional_mod.resolve_seed_verse("facing anxiety", "user", rotation=(555, 4))
    assert ref == "ISA 41:10"


@pytest.mark.asyncio
async def test_no_rotation_keeps_the_old_theme_pick_path(monkeypatch):
    async def fake_fetch(ref, languages=None):
        return {"eng-KJV": f"text for {ref}"}
    monkeypatch.setattr(devotional_mod, "fetch_verse_translations", fake_fetch)

    async def theme_pick(theme):
        assert theme is None
        return "PSA 23:1"
    monkeypatch.setattr(devotional_mod, "pick_verse_for_theme", theme_pick)

    ref, _ = await devotional_mod.resolve_seed_verse("", "system", rotation=None)
    assert ref == "PSA 23:1"
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pytest tests/chatbot/test_devotional_resolve.py -q -k rotation or "old_theme_pick"`
Expected: FAIL — `resolve_seed_verse() got an unexpected keyword argument 'rotation'`.

- [ ] **Step 3: Add the `rotation` parameter to `resolve_seed_verse`**

In `chatbot/devotional.py`, add the import near the top (after the `chatbot.ollama_client` import block):

```python
from chatbot.devotional_rotation import pick_from_rotation
```

Change the signature and the seed-selection block (`devotional.py:188-195`) from:

```python
async def resolve_seed_verse(raw: Optional[str], source: str) -> Tuple[str, Dict[str, str]]:
    """(usfm_reference, translations_dict). For a single verse the dict is the
    real multi-translation payload; for a range it's {"eng-KJV": joined text}.
    Raises DevotionalError when no verse text can be fetched."""
    ref = _resolve_verse_reference(raw) if (source == "user" and raw) else None
    if ref is None:
        theme = raw.strip() if (raw and raw.strip()) else None
        ref = await pick_verse_for_theme(theme)
```

to:

```python
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
    return Psalm 23:1 almost every time). Themed and typed-reference picks
    ignore `rotation`."""
    ref = _resolve_verse_reference(raw) if (source == "user" and raw) else None
    if ref is None:
        theme = raw.strip() if (raw and raw.strip()) else None
        if theme is None and rotation is not None:
            ref = pick_from_rotation(*rotation)
        else:
            ref = await pick_verse_for_theme(theme)
```

- [ ] **Step 4: Forward `rotation` from `stream_devotional`**

Change `stream_devotional`'s signature and its `resolve_seed_verse` call (`devotional.py:230-238`) from:

```python
async def stream_devotional(
    raw: Optional[str], source: str, page_context: Optional[str] = None
) -> AsyncIterator[Dict[str, object]]:
```
```python
    reference, translations = await resolve_seed_verse(raw, source)
```

to:

```python
async def stream_devotional(
    raw: Optional[str],
    source: str,
    page_context: Optional[str] = None,
    rotation: Optional[Tuple[int, int]] = None,
) -> AsyncIterator[Dict[str, object]]:
```
```python
    reference, translations = await resolve_seed_verse(raw, source, rotation)
```

- [ ] **Step 5: Run the devotional test files**

Run: `pytest tests/chatbot/test_devotional_resolve.py tests/chatbot/test_devotional_stream.py -q`
Expected: PASS (existing tests unchanged + 3 new).

- [ ] **Step 6: Commit**

```bash
git add chatbot/devotional.py tests/chatbot/test_devotional_resolve.py
git commit -m "feat(devotional): accept a rotation (seed,cursor) on the no-theme seed path"
```

---

## Task 4: Wire the `/chat/stream` devotional branch to the rotation params

**Files:**
- Modify: `chatbot/api.py` (`api.py:336-345`)
- Modify: `tests/chatbot/test_chat_stream_devotional.py`

**Interfaces:**
- Consumes: `stream_devotional(..., rotation=...)` (Task 3).
- Produces: for a `mode == "devotional"` streaming request, when `mode_params` carries integer `rotation_seed` and `rotation_cursor`, they are passed to `stream_devotional` as `rotation=(seed, cursor)`; otherwise `rotation=None`.

**Wire-format note (resolved):** `frontend/src/lib/chatApi.ts::toWireModeParams` maps known camelCase `ModeParams` keys to snake_case and passes unknown keys through unchanged. Task 6 Step 2 adds explicit `rotationSeed -> rotation_seed` / `rotationCursor -> rotation_cursor` mappings there, so this task's backend reads **`rotation_seed`** / **`rotation_cursor`**, matching every other mode param (`day_index`, `concept_slug`, …).

- [ ] **Step 1: Write the failing test**

Add to `tests/chatbot/test_chat_stream_devotional.py` (match the file's existing style for driving `/chat/stream` and stubbing `stream_devotional`; the key assertion is on the `rotation` argument `stream_devotional` receives):

```python
@pytest.mark.asyncio
async def test_rotation_params_reach_stream_devotional(monkeypatch, client):
    seen = {}

    async def fake_stream(raw, source, page_context=None, rotation=None):
        seen["raw"] = raw
        seen["source"] = source
        seen["rotation"] = rotation
        yield {"type": "done", "text": "d", "reference": "PSA 100:4",
               "translations": {"eng-KJV": "Enter into his gates"}}

    monkeypatch.setattr("chatbot.api.stream_devotional", fake_stream, raising=False)
    # If the import in api.py is module-local (`from chatbot.devotional import
    # stream_devotional` inside the handler), patch there instead:
    monkeypatch.setattr("chatbot.devotional.stream_devotional", fake_stream, raising=False)

    resp = client.post("/chat/stream", json={
        "message": "",
        "mode": "devotional",
        "mode_params": {"source": "system", "rotation_seed": 555, "rotation_cursor": 4},
    })
    assert resp.status_code == 200
    assert seen["rotation"] == (555, 4)


@pytest.mark.asyncio
async def test_missing_rotation_params_pass_none(monkeypatch, client):
    seen = {}

    async def fake_stream(raw, source, page_context=None, rotation=None):
        seen["rotation"] = rotation
        yield {"type": "done", "text": "d", "reference": "PSA 100:4",
               "translations": {"eng-KJV": "Enter into his gates"}}

    monkeypatch.setattr("chatbot.api.stream_devotional", fake_stream, raising=False)
    monkeypatch.setattr("chatbot.devotional.stream_devotional", fake_stream, raising=False)

    resp = client.post("/chat/stream", json={
        "message": "", "mode": "devotional", "mode_params": {"source": "system"},
    })
    assert resp.status_code == 200
    assert seen["rotation"] is None
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pytest tests/chatbot/test_chat_stream_devotional.py -q -k rotation`
Expected: FAIL — `seen["rotation"]` is `None` in the first test (params ignored) / `KeyError`.

- [ ] **Step 3: Read the rotation params in the handler**

In `chatbot/api.py`, in the devotional branch (just after `source = md.get("source", "user")` at `api.py:342`), add:

```python
            _rs, _rc = md.get("rotation_seed"), md.get("rotation_cursor")
            try:
                rotation = (int(_rs), int(_rc)) if _rs is not None and _rc is not None else None
            except (TypeError, ValueError):
                rotation = None
```

Then change the `stream_devotional` call at `api.py:345` from:

```python
                async for ev in stream_devotional(raw or None, source, request.page_context):
```

to:

```python
                async for ev in stream_devotional(raw or None, source, request.page_context, rotation):
```

Note: `md.get("rotation_seed")` is correct given Task 6 Step 2's `toWireModeParams` mapping. Do not also read `rotationSeed` — keep the wire contract snake_case-only, like the other mode params.

- [ ] **Step 4: Check for a second (non-stream) devotional generation path**

Run: `grep -n "stream_devotional\|resolve_seed_verse\|mode == .devotional." chatbot/api.py`
Expected: the only generation call site is the one in `/chat/stream` just edited (the buffered `/chat` path builds a primer, it does not generate — see `api.py:331-335` comment). If `grep` shows another call to `stream_devotional`/`resolve_seed_verse` that generates, apply the same `rotation` plumbing there and add an analogous test; otherwise no further change.

- [ ] **Step 5: Run the devotional stream + endpoint tests**

Run: `pytest tests/chatbot/test_chat_stream_devotional.py tests/chatbot/test_chat_endpoint_trace.py -q`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add chatbot/api.py tests/chatbot/test_chat_stream_devotional.py
git commit -m "feat(devotional): pass client rotation seed/cursor into the generate turn"
```

---

## Task 5: `useDevotionalRotationStore`

**Files:**
- Create: `frontend/src/store/useDevotionalRotationStore.ts`
- Create: `frontend/src/store/useDevotionalRotationStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useDevotionalRotationStore` (Zustand). State `{ seed: number | null; cursor: number }`. Methods:
  - `ensureSeed(): number` — if `seed` is `null`, set it to a fresh random integer in `[0, 2**31)` and return it; otherwise return the existing `seed`.
  - `advance(): void` — `cursor += 1`.
  - `reset(): void` — back to `{ seed: null, cursor: 0 }`.
  Persist key `bible-explorer-devotional-rotation`, version `1`. Task 6 reads `ensureSeed()`, `cursor`, `advance()`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/store/useDevotionalRotationStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useDevotionalRotationStore } from './useDevotionalRotationStore'

describe('useDevotionalRotationStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
  })

  it('starts with no seed and a zero cursor', () => {
    expect(useDevotionalRotationStore.getState().seed).toBeNull()
    expect(useDevotionalRotationStore.getState().cursor).toBe(0)
  })

  it('ensureSeed sets a non-negative integer seed and returns it', () => {
    const seed = useDevotionalRotationStore.getState().ensureSeed()
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThan(2 ** 31)
    expect(useDevotionalRotationStore.getState().seed).toBe(seed)
  })

  it('ensureSeed is idempotent once a seed exists', () => {
    const first = useDevotionalRotationStore.getState().ensureSeed()
    const second = useDevotionalRotationStore.getState().ensureSeed()
    expect(second).toBe(first)
  })

  it('advance increments the cursor', () => {
    useDevotionalRotationStore.getState().advance()
    useDevotionalRotationStore.getState().advance()
    expect(useDevotionalRotationStore.getState().cursor).toBe(2)
  })

  it('reset clears the seed and cursor', () => {
    useDevotionalRotationStore.getState().ensureSeed()
    useDevotionalRotationStore.getState().advance()
    useDevotionalRotationStore.getState().reset()
    expect(useDevotionalRotationStore.getState()).toMatchObject({ seed: null, cursor: 0 })
  })

  it('sanitises a corrupt persisted blob to defaults', () => {
    localStorage.setItem(
      'bible-explorer-devotional-rotation',
      JSON.stringify({ state: { seed: 'nope', cursor: -4 }, version: 1 })
    )
    // Re-import via a fresh hydrate: simulate by calling the persist merge.
    const merged = useDevotionalRotationStore.persist.getOptions().merge?.(
      { seed: 'nope', cursor: -4 } as unknown,
      useDevotionalRotationStore.getState()
    )
    expect(merged).toMatchObject({ seed: null, cursor: 0 })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd frontend && npx vitest run src/store/useDevotionalRotationStore.test.ts`
Expected: FAIL — cannot resolve `./useDevotionalRotationStore`.

- [ ] **Step 3: Implement the store**

Create `frontend/src/store/useDevotionalRotationStore.ts` (mirrors `useReadingPlanStore.ts`):

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Per-browser state for Devotional mode's "Pick one for me" rotation.
 *
 * The backend picker (chatbot/devotional_rotation.py) is a pure function of
 * (seed, cursor): it deals a curated verse pool as a seeded shuffled deck.
 * We keep one random `seed` per browser (so two browsers get independent
 * orders) and a monotonic `cursor` incremented once per delivered rotation
 * devotional. No accounts, no server state — this and the seed are all the
 * "which verses have I seen" memory the feature needs.
 */
interface DevotionalRotationState {
  seed: number | null
  cursor: number
  /** Lazily assign a random seed on first use; return the current seed. */
  ensureSeed: () => number
  /** Advance one step after a rotation devotional is delivered. */
  advance: () => void
  reset: () => void
}

function sanitize(persistedState: unknown): { seed: number | null; cursor: number } {
  const s = (persistedState ?? {}) as Record<string, unknown>
  const seed =
    typeof s.seed === 'number' && Number.isFinite(s.seed) && s.seed >= 0 ? Math.floor(s.seed) : null
  const cursor =
    typeof s.cursor === 'number' && Number.isFinite(s.cursor) && s.cursor >= 0 ? Math.floor(s.cursor) : 0
  return { seed, cursor }
}

export const useDevotionalRotationStore = create<DevotionalRotationState>()(
  persist(
    (set, get) => ({
      seed: null,
      cursor: 0,
      ensureSeed: () => {
        const existing = get().seed
        if (existing != null) return existing
        const seed = Math.floor(Math.random() * 2 ** 31)
        set({ seed })
        return seed
      },
      advance: () => set((state) => ({ cursor: state.cursor + 1 })),
      reset: () => set({ seed: null, cursor: 0 }),
    }),
    {
      name: 'bible-explorer-devotional-rotation',
      version: 1,
      migrate: (persistedState) => sanitize(persistedState) as DevotionalRotationState,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitize(persistedState),
      }),
    }
  )
)
```

- [ ] **Step 4: Run the store tests**

Run: `cd frontend && npx vitest run src/store/useDevotionalRotationStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useDevotionalRotationStore.ts frontend/src/store/useDevotionalRotationStore.test.ts
git commit -m "feat(devotional): per-browser rotation seed/cursor store"
```

---

## Task 6: `ChatPane` — inject the rotation params and advance the cursor

**Files:**
- Modify: `frontend/src/types/session.ts` (`ModeParams`)
- Modify: `frontend/src/lib/chatApi.ts` (`toWireModeParams`, `chatApi.ts:31-56`)
- Modify: `frontend/src/components/shell/ChatPane.tsx` (`runDevotionalTurn`, `ChatPane.tsx:162-181`)
- Modify: `frontend/src/components/shell/ChatPane.test.tsx`
- Modify: `frontend/src/lib/chatApi.test.ts` (if present; else add a `toWireModeParams` case wherever it is unit-tested)

**Interfaces:**
- Consumes: `useDevotionalRotationStore` (Task 5); the backend rotation plumbing (Tasks 3–4).
- Produces: for a devotional session with `modeParams.source === 'system'` whose generating turn has an empty message, the `/chat/stream` request's `mode_params` carries `rotationSeed: number` and `rotationCursor: number`; those are also persisted onto the session via `updateModeParams`; on a non-error response the store `cursor` advances by exactly 1. A `source: 'user'` session sends no `rotation*` keys.

- [ ] **Step 1: Add the `ModeParams` fields**

In `frontend/src/types/session.ts`, add to the `ModeParams` interface (next to the existing `source?` / `delivered?` fields):

```ts
  /** Devotional "Pick one for me": the (seed, cursor) slot this session's
   *  rotation pick used. Persisted so a retry after an errored turn reuses
   *  the same slot instead of skipping a verse. */
  rotationSeed?: number
  rotationCursor?: number
```

- [ ] **Step 2: Map the new keys to snake_case in `toWireModeParams`**

In `frontend/src/lib/chatApi.ts`, add two cases to the `switch` in `toWireModeParams` (`chatApi.ts:35-53`), before `default`:

```ts
      case 'rotationSeed':
        out.rotation_seed = value
        break
      case 'rotationCursor':
        out.rotation_cursor = value
        break
```

Also extend the function's doc comment key list to mention
`rotationSeed -> rotation_seed, rotationCursor -> rotation_cursor`.

If `toWireModeParams` has a unit test (grep: `rg "toWireModeParams" frontend/src`), add an assertion that `toWireModeParams({ rotationSeed: 7, rotationCursor: 2 })` yields `{ rotation_seed: 7, rotation_cursor: 2 }`, and run that test file.

- [ ] **Step 3: Write the failing tests**

Add to `frontend/src/components/shell/ChatPane.test.tsx`, inside the same `describe` block as the existing devotional tests. Mirror the setup of "auto-fires the devotional generation for a system-source session" (`ChatPane.test.tsx:561`) exactly — `render(<ChatPane sessionId={session.id} />)`, a `📖 Devotional` user message, then a plain assistant ack message so the auto-fire effect's `last.role === 'assistant' && !last.choicesStatus` guard passes. Add the import near the other store imports at the top of the file:

```ts
import { useDevotionalRotationStore } from '../../store/useDevotionalRotationStore'
```

```ts
it('a system-source devotional sends rotation seed+cursor and advances the cursor', async () => {
  localStorage.clear()
  useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
  const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
  useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
  useSessionsStore.getState().appendMessage(session.id, {
    id: 'a1', role: 'assistant', text: 'Let me find a verse for you…',
  })

  const spy = vi.spyOn(chatApi, 'postChatStream').mockImplementation(async (_payload, handlers) => {
    handlers?.onChunk?.('')
    return devotionalFinal() as never
  })

  render(<ChatPane sessionId={session.id} />)
  expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()

  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({
      message: '',
      mode: 'devotional',
      mode_params: expect.objectContaining({
        source: 'system',
        rotationSeed: expect.any(Number),
        rotationCursor: 0,
      }),
    }),
    expect.anything()
  )
  expect(useDevotionalRotationStore.getState().cursor).toBe(1)
  // the slot is persisted on the session so an errored retry reuses it
  expect(useSessionsStore.getState().sessions[session.id].modeParams.rotationCursor).toBe(0)
})

it('a second system-source devotional uses the advanced cursor', async () => {
  localStorage.clear()
  useDevotionalRotationStore.setState({ seed: 12345, cursor: 1 })
  const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
  useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
  useSessionsStore.getState().appendMessage(session.id, { id: 'a1', role: 'assistant', text: 'Let me find a verse for you…' })
  const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)

  render(<ChatPane sessionId={session.id} />)
  expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()

  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({
      mode_params: expect.objectContaining({ rotationSeed: 12345, rotationCursor: 1 }),
    }),
    expect.anything()
  )
  expect(useDevotionalRotationStore.getState().cursor).toBe(2)
})

it('a user-source devotional sends no rotation params', async () => {
  localStorage.clear()
  useDevotionalRotationStore.setState({ seed: null, cursor: 0 })
  const session = useSessionsStore.getState().createSession('devotional', { source: 'user' })
  useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
  useSessionsStore.getState().appendMessage(session.id, {
    id: 'p', role: 'assistant',
    text: "Tell me a verse reference (e.g. John 3:16) or a theme (e.g. 'facing anxiety'), and I'll write you a devotional.",
  })
  const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)

  render(<ChatPane sessionId={session.id} />)
  const input = screen.getByPlaceholderText(/verse|theme|Ask/i)
  fireEvent.change(input, { target: { value: 'Psalm 23' } })
  fireEvent.submit(input.closest('form')!)

  expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()
  const payload = spy.mock.calls[0][0] as { mode_params?: Record<string, unknown> }
  expect(payload.mode_params).not.toHaveProperty('rotationSeed')
  expect(payload.mode_params).not.toHaveProperty('rotationCursor')
  expect(useDevotionalRotationStore.getState().cursor).toBe(0)
})
```

If `fireEvent` / `screen.getByPlaceholderText` aren't already imported in this file, use whatever the file's other input-submitting tests use (e.g. `userEvent.type` + submit) — match the file, don't introduce a new interaction style.

- [ ] **Step 4: Run to confirm they fail**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx -t "devotional"`
Expected: the three new cases FAIL — `mode_params` has no `rotationSeed`; `useDevotionalRotationStore` cursor stays `0`. Existing devotional tests still pass.

- [ ] **Step 5: Implement the wiring in `runDevotionalTurn`**

In `frontend/src/components/shell/ChatPane.tsx`, add the import:

```ts
import { useDevotionalRotationStore } from '../../store/useDevotionalRotationStore'
```

Replace `runDevotionalTurn` (`ChatPane.tsx:162-181`) with:

```ts
  const runDevotionalTurn = useCallback(
    async (message: string) => {
      if (!session) return
      const history = session.messages.slice(-6).map((m) => ({ role: m.role, text: m.text }))

      // "Pick one for me" = system source + no typed verse/theme. Deal the
      // next verse from the per-browser rotation deck. Inject the (seed,
      // cursor) slot here (covers both the choice-prompt flow and a
      // sidebar-opened session), persist it so an errored retry reuses the
      // same slot, and only advance the cursor once the turn succeeds.
      const isRotationPick = session.modeParams.source === 'system' && message.trim() === ''
      let modeParams = { ...session.modeParams }
      if (isRotationPick && modeParams.rotationSeed == null) {
        const rotationSeed = useDevotionalRotationStore.getState().ensureSeed()
        const rotationCursor = useDevotionalRotationStore.getState().cursor
        modeParams = { ...modeParams, rotationSeed, rotationCursor }
        updateModeParams(sessionId, { rotationSeed, rotationCursor })
      }

      setLoading(true)
      try {
        const response = await streamAssistantReply(
          genId(),
          { message, history, mode: 'devotional', mode_params: modeParams },
          { devotional: true }
        )
        if (response && response.type !== 'error') {
          updateModeParams(sessionId, { delivered: true })
          if (isRotationPick) {
            useDevotionalRotationStore.getState().advance()
          }
        }
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, streamAssistantReply, updateModeParams]
  )
```

- [ ] **Step 6: Run the ChatPane devotional suite**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: PASS (existing devotional tests + 2 new). If the existing "auto-fires … system-source" test at ~line 561 asserted `mode_params` with an exact object, loosen it to `expect.objectContaining({ source: 'system' })` — the payload now also carries `rotationSeed`/`rotationCursor`.

- [ ] **Step 7: Full frontend test run**

Run: `cd frontend && npx vitest run`
Expected: PASS. Fix any snapshot/exact-match assertions elsewhere that broke on the new `ModeParams` fields (search: `rg "rotationSeed|rotation_seed|modeParams:" src/components/shell/ChatPane.test.tsx src/App.test.tsx src/lib`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/lib/chatApi.ts frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "feat(devotional): client deals the rotation deck for \"Pick one for me\""
```

---

## Task 7: Docs + full-suite verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-devotional-mode-design.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code — documentation + a green full test run.

- [ ] **Step 1: Cross-reference the old devotional spec**

In `docs/superpowers/specs/2026-09-07-devotional-mode-design.md`, under the `**Out of scope:**` bullet that begins "A curated devotional-verse data file. The system-picked verse comes from a single LLM call…", append:

```markdown
  *(Superseded 2026-09-10 — see
  `2026-09-10-devotional-annual-rotation-design.md`. The system pick is now
  a seeded shuffled deck over a curated ≥366-verse pool; the single LLM
  call remains only for themed picks.)*
```

- [ ] **Step 2: Note the rotation in `CLAUDE.md`**

In `CLAUDE.md`, add under the section describing the chatbot / devotional mode (near the "Conversation sharing" or routes notes — wherever devotional behaviour is summarised; if there's no such spot, add a short subsection after "## Conversation sharing"):

```markdown
## Devotional "Pick one for me"

The system-picked seed verse is a deterministic draw from
`chatbot/data/devotional_verses.py` (`DEVOTIONAL_POOL`, ≥366 USFM refs),
dealt as a per-browser seeded shuffled deck by
`chatbot/devotional_rotation.py::pick_from_rotation(seed, cursor)`. The
client (`useDevotionalRotationStore`) holds the random per-browser `seed`
and a monotonic `cursor` and passes them in `mode_params`
(`rotation_seed` / `rotation_cursor`). Themed and typed-reference picks
still go through `pick_verse_for_theme` / `_resolve_verse_reference`.
Regenerate/extend the pool with `scripts/validate_devotional_pool.py`
against `Complete.db`.
```

- [ ] **Step 3: Full backend suite**

Run: `pytest tests/chatbot -q`
Expected: PASS, no skips other than the `Complete.db`-gated pool test (and any pre-existing skips).

- [ ] **Step 4: Full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Local pool validation (developer machine)**

Run: `python scripts/validate_devotional_pool.py`
Expected: `0 problem(s)`, exit 0.

- [ ] **Step 6: Manual smoke (optional, developer machine)**

`python myproject.py`, open the chat, start Devotional → "Pick one for me" several times (new session each time). Confirm the seed verse differs each run and is not always Psalm 23:1. Inspect `localStorage['bible-explorer-devotional-rotation']` — `cursor` increments by 1 per delivered devotional.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-07-devotional-mode-design.md CLAUDE.md
git commit -m "docs(devotional): document the annual seeded-shuffle rotation"
```

---

## Self-Review

**Spec coverage**

| Spec item | Task |
| --- | --- |
| `DEVOTIONAL_POOL` ≥ 366, USFM, unique, DB-resolvable | Task 1 |
| `pick_from_rotation(seed, cursor)` — divmod epoch/offset, str-seeded shuffle, clamp negative | Task 2 |
| `resolve_seed_verse(..., rotation=)` — used only when no ref and no theme | Task 3 |
| `stream_devotional(..., rotation=)` forwarding | Task 3 |
| `api.py` reads `rotation_seed`/`rotation_cursor`, coerces to `(int,int)` or `None` | Task 4 |
| Second non-stream generation path check | Task 4 Step 4 |
| `useDevotionalRotationStore` — `ensureSeed`/`advance`/`reset`, persist, sanitise | Task 5 |
| `ModeParams.rotationSeed` / `rotationCursor` | Task 6 Step 1 |
| `toWireModeParams` maps them to `rotation_seed` / `rotation_cursor` | Task 6 Step 2 |
| ChatPane injects + persists slot, advances cursor on success only, user-source sends nothing | Task 6 Step 5 |
| Retry-after-error reuses the slot (no cursor gap) | Task 6 Step 5 (guard `modeParams.rotationSeed == null`) + persisted via `updateModeParams` |
| `Complete.db` absent → structural tests still run | Task 1 Step 1 (`pytest.mark.skipif`) |
| Old spec cross-reference; `CLAUDE.md` note | Task 7 |
| Backend tests (pool, rotation, resolve, stream) | Tasks 1–4 |
| Frontend tests (store, ChatPane) | Tasks 5–6 |

**Type consistency**

- `pick_from_rotation(seed: int, cursor: int) -> str` — same name/signature in Task 2 (def), Task 3 (import + call `pick_from_rotation(*rotation)`), Task 3 tests.
- `rotation: Optional[Tuple[int, int]]` — `resolve_seed_verse` and `stream_devotional` (Task 3), `api.py` builds exactly this shape (Task 4).
- `mode_params` keys (resolved): frontend `ModeParams` stores **`rotationSeed`** / **`rotationCursor`** (camelCase); `toWireModeParams` (`chatApi.ts:31`) converts them to **`rotation_seed`** / **`rotation_cursor`** on the wire, exactly as it already does for `dayIndex -> day_index`, `conceptSlug -> concept_slug`, etc. Task 6 Step 2 adds the two mappings; Task 4 backend reads the snake_case keys. The Task 6 ChatPane tests spy on `postChatStream` (which runs *before* `toWireModeParams`) so they assert the camelCase keys; the Task 4 backend tests POST a raw JSON body so they use the snake_case keys. Consistent and verified against `chatApi.ts`.
- `useDevotionalRotationStore` state `{ seed, cursor }` and methods `ensureSeed`/`advance`/`reset` — identical in Task 5 (def + tests) and Task 6 (calls).

**Placeholder scan** — none. Every code step has literal content; the pool list is in Appendix A; the one genuinely conditional decision (camelCase vs snake_case `mode_params` keys) is called out explicitly with the grep that resolves it.

---

## Appendix A: `DEVOTIONAL_POOL` contents

Paste this as the tuple body in `chatbot/data/devotional_verses.py` (Task 1
Step 3). Grouped by book for review only — order within the tuple does not
matter (the picker shuffles). ~640 entries; the floor is 366, so entries
that fail `scripts/validate_devotional_pool.py` against a specific
`Complete.db` edition can simply be deleted.

```python
    # Genesis–Job
    "GEN 1:1", "GEN 1:27", "GEN 2:24", "GEN 8:22", "GEN 9:13", "GEN 12:2",
    "GEN 15:6", "GEN 22:14", "GEN 28:15", "GEN 50:20",
    "EXO 3:14", "EXO 14:14", "EXO 15:2", "EXO 20:12", "EXO 33:14", "EXO 34:6",
    "LEV 19:2", "LEV 19:18", "LEV 26:12",
    "NUM 6:24", "NUM 6:25", "NUM 6:26", "NUM 23:19",
    "DEU 4:29", "DEU 6:5", "DEU 6:6", "DEU 7:9", "DEU 8:3", "DEU 10:12",
    "DEU 30:19", "DEU 31:6", "DEU 31:8", "DEU 33:27",
    "JOS 1:8", "JOS 1:9", "JOS 24:15",
    "JDG 6:12",
    "RUT 1:16",
    "1SA 2:2", "1SA 12:24", "1SA 15:22", "1SA 16:7", "1SA 17:47",
    "2SA 22:2", "2SA 22:31", "2SA 22:33",
    "1KI 8:23", "1KI 19:11", "1KI 19:12",
    "2KI 6:16", "2KI 20:5",
    "1CH 16:11", "1CH 16:34", "1CH 28:9", "1CH 29:11",
    "2CH 7:14", "2CH 15:7", "2CH 16:9", "2CH 20:15", "2CH 20:17",
    "NEH 1:5", "NEH 8:10", "NEH 9:6",
    "EST 4:14",
    "JOB 1:21", "JOB 5:17", "JOB 11:18", "JOB 19:25", "JOB 23:10", "JOB 37:5",
    "JOB 42:2",
    # Psalms
    "PSA 1:1", "PSA 1:2", "PSA 1:3", "PSA 3:3", "PSA 4:8", "PSA 5:3",
    "PSA 8:1", "PSA 8:4", "PSA 9:9", "PSA 9:10", "PSA 16:8", "PSA 16:11",
    "PSA 18:1", "PSA 18:2", "PSA 18:30", "PSA 19:1", "PSA 19:7", "PSA 19:14",
    "PSA 20:7", "PSA 23:1", "PSA 23:2", "PSA 23:3", "PSA 23:4", "PSA 23:6",
    "PSA 25:4", "PSA 25:5", "PSA 27:1", "PSA 27:4", "PSA 27:13", "PSA 27:14",
    "PSA 28:7", "PSA 30:5", "PSA 31:24", "PSA 32:7", "PSA 32:8", "PSA 33:4",
    "PSA 34:1", "PSA 34:4", "PSA 34:8", "PSA 34:18", "PSA 34:19", "PSA 37:3",
    "PSA 37:4", "PSA 37:5", "PSA 37:7", "PSA 37:23", "PSA 37:24", "PSA 40:1",
    "PSA 40:2", "PSA 42:1", "PSA 42:2", "PSA 42:5", "PSA 42:11", "PSA 46:1",
    "PSA 46:2", "PSA 46:10", "PSA 51:10", "PSA 51:12", "PSA 55:22", "PSA 56:3",
    "PSA 59:16", "PSA 62:1", "PSA 62:2", "PSA 62:5", "PSA 62:8", "PSA 63:1",
    "PSA 63:3", "PSA 66:16", "PSA 68:19", "PSA 71:14", "PSA 73:26", "PSA 84:10",
    "PSA 84:11", "PSA 86:15", "PSA 89:1", "PSA 90:2", "PSA 90:12", "PSA 90:14",
    "PSA 91:1", "PSA 91:2", "PSA 91:4", "PSA 91:11", "PSA 92:1", "PSA 94:19",
    "PSA 95:1", "PSA 95:6", "PSA 96:1", "PSA 100:3", "PSA 100:4", "PSA 100:5",
    "PSA 103:1", "PSA 103:2", "PSA 103:8", "PSA 103:11", "PSA 103:12",
    "PSA 105:4", "PSA 107:1", "PSA 116:1", "PSA 118:6", "PSA 118:8",
    "PSA 118:24", "PSA 119:11", "PSA 119:105", "PSA 119:114", "PSA 121:1",
    "PSA 121:2", "PSA 121:7", "PSA 121:8", "PSA 126:5", "PSA 127:1",
    "PSA 130:5", "PSA 133:1", "PSA 138:8", "PSA 139:1", "PSA 139:7",
    "PSA 139:14", "PSA 139:23", "PSA 139:24", "PSA 143:8", "PSA 145:8",
    "PSA 145:9", "PSA 145:18", "PSA 146:5", "PSA 147:3", "PSA 150:6",
    # Proverbs–Song
    "PRO 3:5", "PRO 3:6", "PRO 3:7", "PRO 3:11", "PRO 3:12", "PRO 4:23",
    "PRO 8:17", "PRO 9:10", "PRO 10:12", "PRO 11:2", "PRO 12:25", "PRO 13:12",
    "PRO 15:1", "PRO 15:3", "PRO 15:13", "PRO 16:3", "PRO 16:9", "PRO 16:18",
    "PRO 17:17", "PRO 18:10", "PRO 18:24", "PRO 19:21", "PRO 21:2", "PRO 22:6",
    "PRO 24:16", "PRO 27:17", "PRO 28:13", "PRO 29:25", "PRO 30:5", "PRO 31:25",
    "PRO 31:30",
    "ECC 3:1", "ECC 3:11", "ECC 4:9", "ECC 4:12", "ECC 12:13",
    "SNG 2:4", "SNG 8:6", "SNG 8:7",
    # Isaiah
    "ISA 6:8", "ISA 7:14", "ISA 9:6", "ISA 12:2", "ISA 25:1", "ISA 26:3",
    "ISA 26:4", "ISA 30:15", "ISA 30:21", "ISA 40:8", "ISA 40:11", "ISA 40:28",
    "ISA 40:29", "ISA 40:30", "ISA 40:31", "ISA 41:10", "ISA 41:13",
    "ISA 42:16", "ISA 43:1", "ISA 43:2", "ISA 43:18", "ISA 43:19", "ISA 43:25",
    "ISA 46:4", "ISA 48:17", "ISA 49:15", "ISA 49:16", "ISA 53:3", "ISA 53:5",
    "ISA 53:6", "ISA 54:10", "ISA 54:17", "ISA 55:6", "ISA 55:8", "ISA 55:9",
    "ISA 55:11", "ISA 55:12", "ISA 58:11", "ISA 61:1", "ISA 61:3", "ISA 64:8",
    "ISA 66:13",
    # Jeremiah–Malachi
    "JER 1:5", "JER 15:16", "JER 17:7", "JER 17:8", "JER 29:11", "JER 29:12",
    "JER 29:13", "JER 31:3", "JER 32:17", "JER 32:27", "JER 33:3",
    "LAM 3:22", "LAM 3:23", "LAM 3:24", "LAM 3:25", "LAM 3:26",
    "EZK 34:15", "EZK 36:26", "EZK 37:5",
    "DAN 3:17", "DAN 3:18", "DAN 6:23", "DAN 11:32",
    "HOS 6:3", "HOS 6:6", "HOS 10:12",
    "JOL 2:13", "JOL 2:25", "JOL 2:28",
    "AMO 5:24",
    "MIC 6:8", "MIC 7:7", "MIC 7:8", "MIC 7:18", "MIC 7:19",
    "NAM 1:7",
    "HAB 2:4", "HAB 3:17", "HAB 3:18", "HAB 3:19",
    "ZEP 3:17",
    "HAG 2:9",
    "ZEC 4:6", "ZEC 9:9",
    "MAL 3:6", "MAL 3:10",
    # Matthew–Luke
    "MAT 4:4", "MAT 5:3", "MAT 5:4", "MAT 5:5", "MAT 5:6", "MAT 5:7",
    "MAT 5:8", "MAT 5:9", "MAT 5:14", "MAT 5:16", "MAT 5:44", "MAT 6:6",
    "MAT 6:14", "MAT 6:19", "MAT 6:20", "MAT 6:21", "MAT 6:24", "MAT 6:25",
    "MAT 6:26", "MAT 6:33", "MAT 6:34", "MAT 7:7", "MAT 7:8", "MAT 7:12",
    "MAT 7:24", "MAT 10:29", "MAT 10:30", "MAT 10:31", "MAT 11:28",
    "MAT 11:29", "MAT 11:30", "MAT 16:24", "MAT 16:26", "MAT 17:20",
    "MAT 18:20", "MAT 19:26", "MAT 22:37", "MAT 22:39", "MAT 25:21",
    "MAT 25:40", "MAT 28:19", "MAT 28:20",
    "MRK 9:23", "MRK 10:27", "MRK 10:45", "MRK 11:24", "MRK 12:30",
    "MRK 12:31", "MRK 16:15",
    "LUK 1:37", "LUK 6:31", "LUK 6:37", "LUK 6:38", "LUK 9:23", "LUK 10:27",
    "LUK 11:9", "LUK 12:7", "LUK 12:15", "LUK 12:32", "LUK 18:27", "LUK 21:33",
    # John–Acts
    "JHN 1:1", "JHN 1:12", "JHN 1:14", "JHN 3:16", "JHN 3:17", "JHN 4:14",
    "JHN 4:24", "JHN 6:35", "JHN 8:12", "JHN 8:31", "JHN 8:32", "JHN 8:36",
    "JHN 10:10", "JHN 10:11", "JHN 10:27", "JHN 10:28", "JHN 11:25",
    "JHN 13:34", "JHN 13:35", "JHN 14:1", "JHN 14:2", "JHN 14:3", "JHN 14:6",
    "JHN 14:15", "JHN 14:16", "JHN 14:18", "JHN 14:27", "JHN 15:4", "JHN 15:5",
    "JHN 15:7", "JHN 15:9", "JHN 15:13", "JHN 16:33", "JHN 17:3", "JHN 20:29",
    "JHN 21:15",
    "ACT 1:8", "ACT 2:21", "ACT 3:19", "ACT 4:12", "ACT 16:31", "ACT 17:28",
    "ACT 20:24", "ACT 20:35",
    # Romans
    "ROM 1:16", "ROM 3:23", "ROM 5:1", "ROM 5:2", "ROM 5:3", "ROM 5:4",
    "ROM 5:5", "ROM 5:8", "ROM 6:23", "ROM 8:1", "ROM 8:6", "ROM 8:11",
    "ROM 8:14", "ROM 8:15", "ROM 8:16", "ROM 8:18", "ROM 8:26", "ROM 8:28",
    "ROM 8:31", "ROM 8:32", "ROM 8:35", "ROM 8:37", "ROM 8:38", "ROM 8:39",
    "ROM 10:9", "ROM 10:13", "ROM 10:17", "ROM 12:1", "ROM 12:2", "ROM 12:9",
    "ROM 12:10", "ROM 12:12", "ROM 12:18", "ROM 12:21", "ROM 15:4",
    "ROM 15:13",
    # 1 Corinthians–Colossians
    "1CO 1:9", "1CO 2:9", "1CO 6:19", "1CO 6:20", "1CO 10:13", "1CO 12:27",
    "1CO 13:4", "1CO 13:5", "1CO 13:6", "1CO 13:7", "1CO 13:13", "1CO 15:57",
    "1CO 15:58", "1CO 16:13", "1CO 16:14",
    "2CO 1:3", "2CO 1:4", "2CO 3:17", "2CO 4:7", "2CO 4:16", "2CO 4:17",
    "2CO 4:18", "2CO 5:7", "2CO 5:17", "2CO 5:21", "2CO 9:7", "2CO 9:8",
    "2CO 12:9", "2CO 12:10",
    "GAL 2:20", "GAL 5:1", "GAL 5:13", "GAL 5:14", "GAL 5:22", "GAL 5:23",
    "GAL 6:2", "GAL 6:9",
    "EPH 1:7", "EPH 2:8", "EPH 2:9", "EPH 2:10", "EPH 3:16", "EPH 3:17",
    "EPH 3:18", "EPH 3:19", "EPH 3:20", "EPH 4:2", "EPH 4:29", "EPH 4:32",
    "EPH 5:1", "EPH 5:2", "EPH 6:10", "EPH 6:11",
    "PHP 1:6", "PHP 2:3", "PHP 2:4", "PHP 2:13", "PHP 3:13", "PHP 3:14",
    "PHP 4:4", "PHP 4:5", "PHP 4:6", "PHP 4:7", "PHP 4:8", "PHP 4:11",
    "PHP 4:13", "PHP 4:19",
    "COL 1:16", "COL 1:17", "COL 2:6", "COL 2:7", "COL 3:1", "COL 3:2",
    "COL 3:12", "COL 3:13", "COL 3:15", "COL 3:16", "COL 3:17", "COL 3:23",
    # 1 Thessalonians–Revelation
    "1TH 5:11", "1TH 5:16", "1TH 5:17", "1TH 5:18", "1TH 5:23", "1TH 5:24",
    "2TH 3:3", "2TH 3:16",
    "1TI 4:12", "1TI 6:6", "1TI 6:11", "1TI 6:12",
    "2TI 1:7", "2TI 1:9", "2TI 2:15", "2TI 3:16", "2TI 3:17", "2TI 4:7",
    "TIT 2:11", "TIT 2:12", "TIT 3:5",
    "HEB 4:12", "HEB 4:16", "HEB 6:19", "HEB 10:23", "HEB 10:24", "HEB 10:25",
    "HEB 11:1", "HEB 11:6", "HEB 12:1", "HEB 12:2", "HEB 12:11", "HEB 13:5",
    "HEB 13:6", "HEB 13:8",
    "JAS 1:2", "JAS 1:3", "JAS 1:5", "JAS 1:12", "JAS 1:17", "JAS 1:19",
    "JAS 1:22", "JAS 3:17", "JAS 4:7", "JAS 4:8", "JAS 4:10", "JAS 5:16",
    "1PE 1:3", "1PE 1:6", "1PE 1:7", "1PE 2:9", "1PE 3:15", "1PE 4:8",
    "1PE 4:10", "1PE 5:6", "1PE 5:7", "1PE 5:8", "1PE 5:10",
    "2PE 1:3", "2PE 3:9", "2PE 3:18",
    "1JN 1:9", "1JN 3:1", "1JN 3:16", "1JN 3:18", "1JN 4:4", "1JN 4:7",
    "1JN 4:8", "1JN 4:9", "1JN 4:10", "1JN 4:16", "1JN 4:18", "1JN 4:19",
    "1JN 5:4", "1JN 5:14", "1JN 5:15",
    "JUD 1:24", "JUD 1:25",
    "REV 3:20", "REV 21:4", "REV 21:5", "REV 22:13",
```

### Growing the pool later

To add more, query `Complete.db` for candidates and hand-filter — e.g. all
verses in a devotional-rich chapter not already in the pool:

```python
import dataset
db = dataset.connect("sqlite:///Complete.db")
for row in db["Complete"].find(book="Psalm", cnum=37, order_by="vnum"):
    print(row["ref"], "-", (row["text_1769"] or "")[:80])
```

Add the keepers as `"PSA 37:N"` entries, keep the tuple duplicate-free, and
re-run `scripts/validate_devotional_pool.py` and
`pytest tests/chatbot/test_devotional_pool.py -q`.
