# Chat-Centric Redesign — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the FastAPI chatbot backend (`chatbot/`) with mode-aware chat (reading plan / parable / topic / verse primers), gematria and English full-text search as REST tools, and the static reading-plan/parable/topic data those modes need.

**Architecture:** `ChatRequest` gains `mode`/`mode_params`; `ChatResponse` gains an `artifacts` field carrying link metadata for the frontend's artifact panel. A new `chatbot/router.build_mode_primer()` seeds the first assistant turn of a mode session. Gematria/English search are ported directly from `myproject.py`'s existing `gematria_api_data`/`english_api_data` functions into a new `chatbot/bible_search.py` module that queries `Complete.db` via `dataset`, independent of the external `mybibletoolbox-code` dependency the rest of `chatbot/` relies on.

**Tech Stack:** Python 3.13, FastAPI, Pydantic v2, `dataset` (SQLite), pytest, `fastapi.testclient.TestClient`.

**Spec:** `docs/superpowers/specs/2026-08-24-chat-centric-redesign-design.md`

## Global Constraints

- `ROW_RESULT_LIMIT = 20000` caps English search results (from `myproject.py`, carried over verbatim).
- Gematria value range is 1–40000 (from `myproject.py`'s existing `/gematria` route validation).
- Reading plans cover exactly 365 days, at chapter granularity (no verse-level splitting).
- New backend code must not add a hard dependency on the external `mybibletoolbox-code` repo — only the pre-existing `/verse`, `/study`, `/strongs` endpoints and the `verse`-mode primer touch it; all other new functionality (gematria, English search, reading-plan/parable/topic primers) must work with only this repo's `Complete.db`.
- Tests must not require network access or the external `mybibletoolbox-code` repo to pass; any code path that does depend on it (`fetch_verse_translations`, `fetch_strongs`) must be monkeypatched in tests.

---

## Task 1: Test tooling

**Files:**
- Create: `pytest.ini`
- Create: `requirements-dev.txt`
- Create: `tests/__init__.py`
- Create: `tests/chatbot/__init__.py`
- Create: `tests/chatbot/conftest.py`
- Create: `tests/chatbot/test_smoke.py`

**Interfaces:**
- Produces: a `client` pytest fixture (in `tests/chatbot/conftest.py`) yielding `fastapi.testclient.TestClient` wrapping `create_chatbot_app()`, used by every later task's API-level tests.

- [ ] **Step 1: Create `pytest.ini`**

```ini
[pytest]
pythonpath = .
testpaths = tests
```

- [ ] **Step 2: Create `requirements-dev.txt`**

```
pytest>=8.0.0
```

- [ ] **Step 3: Create empty `tests/__init__.py` and `tests/chatbot/__init__.py`**

Both files are empty (zero bytes) — they exist only to make `tests` and `tests.chatbot` importable packages.

- [ ] **Step 4: Create `tests/chatbot/conftest.py`**

```python
import pytest
from fastapi.testclient import TestClient

from chatbot import create_chatbot_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_chatbot_app())
```

- [ ] **Step 5: Create `tests/chatbot/test_smoke.py`**

```python
from chatbot import create_chatbot_app


def test_chat_route_registered():
    app = create_chatbot_app()
    paths = {route.path for route in app.routes}
    assert "/chat" in paths


def test_client_fixture_boots(client):
    paths = {route.path for route in client.app.routes}
    assert "/chat" in paths
```

- [ ] **Step 6: Install dev dependencies and run**

Run: `pip install -r requirements-dev.txt && pytest tests/chatbot/test_smoke.py -v`
Expected: 2 passed

- [ ] **Step 7: Commit**

```bash
git add pytest.ini requirements-dev.txt tests/
git commit -m "test: add pytest tooling for chatbot backend tests"
```

---

## Task 2: Schema extensions — `mode`, `mode_params`, `ArtifactLink`

**Files:**
- Modify: `chatbot/schemas.py`
- Test: `tests/chatbot/test_schemas.py`

**Interfaces:**
- Produces: `ArtifactLink(type: str, label: str, params: Dict[str, Any])`; `ChatRequest.mode: Optional[str]`, `ChatRequest.mode_params: Optional[Dict[str, Any]]`; `ChatResponse.artifacts: Optional[List[ArtifactLink]]`. `ArtifactLink` is a top-level, strongly-typed field (not nested inside the loosely-typed `data` dict) so the frontend gets a typed contract for links — a deliberate refinement of the spec's "`ChatResponse.data` gains an `artifacts` field" wording.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_schemas.py
from chatbot.schemas import ArtifactLink, ChatRequest, ChatResponse


def test_artifact_link_shape():
    link = ArtifactLink(type="strongs", label="Strong's ▸", params={"id": "G2657"})
    assert link.type == "strongs"
    assert link.params == {"id": "G2657"}


def test_chat_request_accepts_mode_fields():
    req = ChatRequest(message="", mode="parable", mode_params={"parable_id": "prodigal_son"})
    assert req.mode == "parable"
    assert req.mode_params == {"parable_id": "prodigal_son"}


def test_chat_request_mode_fields_optional():
    req = ChatRequest(message="hello")
    assert req.mode is None
    assert req.mode_params is None


def test_chat_response_accepts_artifacts():
    resp = ChatResponse(
        type="chat",
        message="hi",
        artifacts=[ArtifactLink(type="strongs", label="Strong's", params={"id": "G26"})],
    )
    assert len(resp.artifacts) == 1
    assert resp.artifacts[0].type == "strongs"


def test_chat_response_artifacts_optional():
    resp = ChatResponse(type="chat", message="hi")
    assert resp.artifacts is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/chatbot/test_schemas.py -v`
Expected: FAIL — `ImportError: cannot import name 'ArtifactLink'` (and `mode`/`artifacts` are unexpected/missing fields)

- [ ] **Step 3: Implement the schema changes**

In `chatbot/schemas.py`, add the `ArtifactLink` model and extend `ChatRequest`/`ChatResponse`:

```python
class ArtifactLink(BaseModel):
    type: str = Field(..., description="interlinear | strongs | book_context | gematria | english_search")
    label: str = Field(..., description="Human-readable link text shown in the chat bubble")
    params: Dict[str, Any] = Field(default_factory=dict, description="Fetch parameters for the artifact panel")


class ChatRequest(BaseModel):
    message: str = Field(..., description="User's biblical question or request")
    conversation_id: Optional[str] = Field(None, description="Optional conversation ID for context")
    history: Optional[List["HistoryMessage"]] = Field(None, description="Recent conversation turns for context")
    page_context: Optional[str] = Field(None, description="Verse reference currently displayed on the Explorer page (e.g. 'John 3:16')")
    mode: Optional[str] = Field(None, description="Study mode: reading_plan, parable, verse, topic, freeform")
    mode_params: Optional[Dict[str, Any]] = Field(None, description="Mode-specific parameters, e.g. {'plan': 'chronological', 'day_index': 0}")


class ChatResponse(BaseModel):
    type: str = Field(..., description="Response type: verse, study, strongs, chat, error")
    message: str = Field(..., description="Natural language response")
    data: Optional[Dict[str, Any]] = Field(None, description="Structured data payload")
    route: Optional[str] = Field(None, description="Human-readable description of the routing path taken")
    follow_up_questions: Optional[List[str]] = Field(None, description="Suggested follow-up questions")
    artifacts: Optional[List[ArtifactLink]] = Field(None, description="Links the frontend can open in the artifact panel")
```

(Leave `VerseResponse`, `StudyResponse`, `StrongsResponse`, `SSEChunk` untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/chatbot/test_schemas.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add chatbot/schemas.py tests/chatbot/test_schemas.py
git commit -m "feat: add mode fields and ArtifactLink to chat schemas"
```

---

## Task 3: `bible_search.py` — gematria and English search against `Complete.db`

**Files:**
- Create: `chatbot/bible_search.py`
- Test: `tests/chatbot/test_bible_search.py`

**Interfaces:**
- Consumes: `Complete.db` at the project root (via `dataset`).
- Produces: `search_gematria_sync(value: int) -> Dict[str, Any]` (keys: `value`, `wordResults`, `verseResults`, `strongsDefinitions`); `search_english_sync(query: str) -> Dict[str, Any]` (keys: `query`, `results`, `truncated`). Both are synchronous — Task 4 wraps them for async use.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_bible_search.py
from chatbot.bible_search import search_english_sync, search_gematria_sync


def test_search_gematria_verse_totals():
    result = search_gematria_sync(2701)
    assert result["value"] == 2701
    refs = {r["ref"] for r in result["verseResults"]}
    assert "Genesis 1:1" in refs


def test_search_gematria_word_matches():
    result = search_gematria_sync(913)
    assert len(result["wordResults"]) > 0
    assert all(r["strongsNumber"] for r in result["wordResults"])


def test_search_gematria_no_results():
    result = search_gematria_sync(39999)
    assert result["wordResults"] == []
    assert result["verseResults"] == []


def test_search_english_finds_known_verse():
    result = search_english_sync("beginning")
    assert result["query"] == "beginning"
    refs = {r["ref"] for r in result["results"]}
    assert "Genesis 1:1" in refs
    first = next(r for r in result["results"] if r["ref"] == "Genesis 1:1")
    assert first["matchPositions"], "expected at least one match position"


def test_search_english_no_results():
    result = search_english_sync("zzzxqnotarealword")
    assert result["results"] == []
    assert result["truncated"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/chatbot/test_bible_search.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.bible_search'`

- [ ] **Step 3: Implement `chatbot/bible_search.py`**

```python
"""Direct SQLite queries against Complete.db for gematria and English
full-text search.

Ported from myproject.py's gematria_api_data() / english_api_data()
(the JSON-shaped API helpers, not the HTML-rendering routes), with the
Flask response-caching decorator dropped. Deliberately independent of
the mybibletoolbox-code dependency the rest of chatbot/ relies on.
"""

import re
from pathlib import Path
from typing import Any, Dict, List

import dataset

DB_PATH = f"sqlite:///{Path(__file__).resolve().parent.parent / 'Complete.db'}"
ROW_RESULT_LIMIT = 20000

_TAG_RE = re.compile(r"</?(?:i|divine|inscription|psalmheader|headingletter|colophon)>")


def _remove_tags(text: str) -> str:
    return _TAG_RE.sub("", text)


def _find_match_positions(text: str, search_term: str) -> List[Dict[str, int]]:
    positions = []
    text_lower = text.lower()
    term_lower = search_term.lower()
    start = 0
    while True:
        idx = text_lower.find(term_lower, start)
        if idx == -1:
            break
        positions.append({"start": idx, "length": len(search_term)})
        start = idx + 1
    return positions


def _strongs_row_to_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "strongsNumber": row["StrongsNumber"],
        "root": row["Root"],
        "value": row["Value"],
        "transliteration1": row["Transliteration1"],
        "transliteration2": row["Transliteration2"],
        "transliteration": row["Transliteration"],
        "partOfSpeech": row["Part_of_Speech"],
        "meaning": row["Meaning"],
        "strongsDefinition": row["Strongs_Definition"],
        "outline": row["Outline"],
        "verseCount": row["VerseCount"],
        "bookCount": row["BookCount"],
        "usageCount": row["UsageCount"],
        "note": row["Note"],
    }


def search_gematria_sync(value: int) -> Dict[str, Any]:
    """Find original-language words and verse totals matching a gematria value."""
    db = dataset.connect(DB_PATH)
    strongs_table = db["Strongs_"]

    word_rows = list(db.query(
        "SELECT * FROM Complete WHERE Original_Words_values LIKE :otv LIMIT " + str(ROW_RESULT_LIMIT),
        otv="%~" + str(value) + "~%",
    ))
    verse_rows = list(db.query("SELECT * FROM Complete WHERE total = :value", value=value))

    word_results: List[Dict[str, Any]] = []
    all_sns: List[str] = []
    for row in word_rows:
        sn_list = row["Original_Words_SN"].strip("{").strip("}").strip("~").split("~")
        ow_list = row["Original_Words"].split("~")
        val_list = row["Original_Words_values"].strip("{").strip("}").strip("~").split("~")
        lang = "G" if row["id"] > 23145 else "H"
        for sn, ow, ov in zip(sn_list, ow_list, val_list):
            if ov == "NONE":
                continue
            try:
                if int(ov) == value:
                    word_results.append({
                        "id": row["id"], "ref": row["ref"], "bnum": row["bnum"],
                        "cnum": row["cnum"], "vnum": row["vnum"],
                        "strongsNumber": sn, "wordHtml": ow, "language": lang,
                    })
                    if sn not in all_sns:
                        all_sns.append(sn)
            except ValueError:
                pass

    verse_results = [
        {
            "id": r["id"], "ref": r["ref"], "bnum": r["bnum"], "cnum": r["cnum"],
            "vnum": r["vnum"], "total": r["total"], "text1769": r["text_1769"],
        }
        for r in verse_rows
    ]

    strongs_defs: Dict[str, Any] = {}
    if all_sns:
        for result in strongs_table.find(StrongsNumber=all_sns):
            if result["Root"] is not None:
                strongs_defs[result["StrongsNumber"]] = _strongs_row_to_dict(result)

    return {
        "value": value,
        "wordResults": word_results,
        "verseResults": verse_results,
        "strongsDefinitions": strongs_defs,
    }


def search_english_sync(query: str) -> Dict[str, Any]:
    """Full-text search of KJV verse text."""
    db = dataset.connect(DB_PATH)
    rows = list(db.query(
        "SELECT * FROM Complete WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("
        "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(text_1769, "
        "'</i>', ''), '<i>', ''), '</divine>', ''), '<divine>', ''), "
        "'</inscription>', ''), '<inscription>', ''), '</psalmheader>', ''), "
        "'<psalmheader>', ''), '</headingletter>', ''), '<headingletter>', ''), "
        "'</colophon>', ''), '<colophon>', '') LIKE :words LIMIT " + str(ROW_RESULT_LIMIT),
        words="%" + query + "%",
    ))

    results = []
    for row in rows:
        plain = _remove_tags(row["text_1769"])
        results.append({
            "id": row["id"], "ref": row["ref"], "bnum": row["bnum"],
            "cnum": row["cnum"], "vnum": row["vnum"], "text": plain,
            "matchPositions": _find_match_positions(plain, query),
        })

    return {
        "query": query,
        "results": results,
        "truncated": len(rows) == ROW_RESULT_LIMIT,
    }


def random_verse_sync() -> tuple:
    """Pick a random canonical (non-Apocrypha) verse. Returns (book, chapter, verse)."""
    import random
    db = dataset.connect(DB_PATH)
    verse_id = random.randint(1, 31102)
    row = db["Complete"].find_one(id=verse_id)
    return row["book"], row["cnum"], row["vnum"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/chatbot/test_bible_search.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add chatbot/bible_search.py tests/chatbot/test_bible_search.py
git commit -m "feat: add gematria and English search against Complete.db"
```

---

## Task 4: Async wrappers for gematria/English search/random-verse

**Note:** Flask already exposes this same gematria/English data at `GET /api/gematria?value=` and `GET /api/english?words=` (see `myproject.py`'s `api_gematria`/`api_english`, which call the very `gematria_api_data`/`english_api_data` functions Task 3 ported from). The Frontend Plan's artifact panel fetches gematria/English-search artifacts from those existing Flask routes directly — no new HTTP surface is needed on the FastAPI side for that. This task only adds **async wrappers** so `chatbot/router.py` (Task 7's mode primers, and future deterministic routing) can call the Task 3 functions in-process without blocking the event loop.

**Files:**
- Modify: `chatbot/tools.py`
- Test: `tests/chatbot/test_tools_search_wrappers.py`

**Interfaces:**
- Consumes: `search_gematria_sync`, `search_english_sync`, `random_verse_sync` from Task 3.
- Produces: `chatbot.tools.search_gematria(value: int) -> Dict`, `chatbot.tools.search_english(query: str) -> Dict`, `chatbot.tools.random_verse() -> tuple` (async), used by Task 7's mode primers.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_tools_search_wrappers.py
import pytest


@pytest.mark.asyncio
async def test_search_gematria_wrapper():
    from chatbot.tools import search_gematria
    result = await search_gematria(2701)
    refs = {r["ref"] for r in result["verseResults"]}
    assert "Genesis 1:1" in refs


@pytest.mark.asyncio
async def test_search_english_wrapper():
    from chatbot.tools import search_english
    result = await search_english("beginning")
    refs = {r["ref"] for r in result["results"]}
    assert "Genesis 1:1" in refs


@pytest.mark.asyncio
async def test_random_verse_wrapper_returns_valid_book():
    from chatbot.tools import random_verse
    book, chapter, verse = await random_verse()
    assert isinstance(book, str) and book
    assert chapter >= 1
    assert verse >= 1
```

This task requires `pytest-asyncio` with `asyncio_mode = auto`; that dependency and config are introduced here rather than in Task 7 since this is the first task with `async def test_...` functions.

- [ ] **Step 2: Add `pytest-asyncio` and enable auto mode**

Add to `requirements-dev.txt`:

```
pytest>=8.0.0
pytest-asyncio>=0.24.0
```

Append to `pytest.ini`:

```ini
asyncio_mode = auto
```

Run: `pip install -r requirements-dev.txt`

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/chatbot/test_tools_search_wrappers.py -v`
Expected: FAIL — `ImportError: cannot import name 'search_gematria' from 'chatbot.tools'`

- [ ] **Step 4: Add async wrappers to `chatbot/tools.py`**

Append to `chatbot/tools.py`:

```python
from chatbot.bible_search import random_verse_sync, search_english_sync, search_gematria_sync


# ---------------------------------------------------------------------------
# Gematria / English search / random verse (Complete.db direct — no
# mybibletoolbox dependency). Used by chatbot.router's mode primers and
# deterministic routing; the frontend artifact panel calls Flask's existing
# /api/gematria and /api/english directly instead of duplicating a route here.
# ---------------------------------------------------------------------------
async def search_gematria(value: int) -> Dict[str, Any]:
    return await _run_in_thread(search_gematria_sync, value)


async def search_english(query: str) -> Dict[str, Any]:
    return await _run_in_thread(search_english_sync, query)


async def random_verse() -> tuple:
    return await _run_in_thread(random_verse_sync)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/chatbot/test_tools_search_wrappers.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add chatbot/tools.py requirements-dev.txt pytest.ini tests/chatbot/test_tools_search_wrappers.py
git commit -m "feat: add async wrappers for gematria/English search and random verse"
```

---

## Task 5: Reading-plan data (`chronological` / `canonical`)

**Files:**
- Create: `chatbot/data/__init__.py`
- Create: `chatbot/data/reading_plans.py`
- Test: `tests/chatbot/test_reading_plans.py`

**Interfaces:**
- Produces: `get_reading_plan(plan: str) -> List[List[Dict[str, Any]]]` (365 entries, each a list of `{"book": str, "chapter": int}`); `get_day_reading(plan: str, day_index: int) -> List[Dict[str, Any]]`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_reading_plans.py
import pytest

from chatbot.data.reading_plans import (
    CANONICAL_ORDER,
    CHAPTER_COUNTS,
    CHRONOLOGICAL_ORDER,
    get_day_reading,
    get_reading_plan,
)


@pytest.mark.parametrize("plan", ["canonical", "chronological"])
def test_plan_has_365_days(plan):
    assert len(get_reading_plan(plan)) == 365


@pytest.mark.parametrize("plan", ["canonical", "chronological"])
def test_plan_covers_every_chapter_exactly_once(plan):
    schedule = get_reading_plan(plan)
    seen = []
    for day in schedule:
        for reading in day:
            seen.append((reading["book"], reading["chapter"]))
    assert len(seen) == len(set(seen)), "no chapter should be assigned twice"
    assert len(seen) == sum(CHAPTER_COUNTS.values())


@pytest.mark.parametrize("plan", ["canonical", "chronological"])
def test_chapters_within_a_book_stay_in_order(plan):
    schedule = get_reading_plan(plan)
    flat = [reading for day in schedule for reading in day]
    last_chapter_seen = {}
    for reading in flat:
        book, chapter = reading["book"], reading["chapter"]
        assert chapter == last_chapter_seen.get(book, 0) + 1
        last_chapter_seen[book] = chapter


def test_orders_are_permutations_of_the_same_66_books():
    assert set(CANONICAL_ORDER) == set(CHRONOLOGICAL_ORDER) == set(CHAPTER_COUNTS)
    assert len(CANONICAL_ORDER) == 66
    assert len(CHRONOLOGICAL_ORDER) == 66


def test_get_day_reading_returns_day_zero():
    first_day = get_day_reading("canonical", 0)
    assert first_day[0] == {"book": "Genesis", "chapter": 1}


def test_get_day_reading_rejects_out_of_range():
    with pytest.raises(ValueError):
        get_day_reading("canonical", 365)
    with pytest.raises(ValueError):
        get_day_reading("canonical", -1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/chatbot/test_reading_plans.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.data'`

- [ ] **Step 3: Create `chatbot/data/__init__.py`** (empty file)

- [ ] **Step 4: Implement `chatbot/data/reading_plans.py`**

```python
"""Static data for the 'Bible in a Year' reading-plan mode.

Both plans read all 66 books at chapter granularity. CHRONOLOGICAL_ORDER
reorders the books per a widely used simplified chronological reading
order (book-level only — full verse-level interleaving, as done by some
published chronological plans, is out of scope for v1).
"""

from typing import Dict, List

CHAPTER_COUNTS: Dict[str, int] = {
    "Genesis": 50, "Exodus": 40, "Leviticus": 27, "Numbers": 36, "Deuteronomy": 34,
    "Joshua": 24, "Judges": 21, "Ruth": 4, "1 Samuel": 31, "2 Samuel": 24,
    "1 Kings": 22, "2 Kings": 25, "1 Chronicles": 29, "2 Chronicles": 36,
    "Ezra": 10, "Nehemiah": 13, "Esther": 10, "Job": 42, "Psalm": 150,
    "Proverbs": 31, "Ecclesiastes": 12, "Song of Solomon": 8, "Isaiah": 66,
    "Jeremiah": 52, "Lamentations": 5, "Ezekiel": 48, "Daniel": 12, "Hosea": 14,
    "Joel": 3, "Amos": 9, "Obadiah": 1, "Jonah": 4, "Micah": 7, "Nahum": 3,
    "Habakkuk": 3, "Zephaniah": 3, "Haggai": 2, "Zechariah": 14, "Malachi": 4,
    "Matthew": 28, "Mark": 16, "Luke": 24, "John": 21, "Acts": 28, "Romans": 16,
    "1 Corinthians": 16, "2 Corinthians": 13, "Galatians": 6, "Ephesians": 6,
    "Philippians": 4, "Colossians": 4, "1 Thessalonians": 5, "2 Thessalonians": 3,
    "1 Timothy": 6, "2 Timothy": 4, "Titus": 3, "Philemon": 1, "Hebrews": 13,
    "James": 5, "1 Peter": 5, "2 Peter": 3, "1 John": 5, "2 John": 1, "3 John": 1,
    "Jude": 1, "Revelation": 22,
}

CANONICAL_ORDER: List[str] = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges",
    "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles",
    "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalm", "Proverbs",
    "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations",
    "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
    "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
    "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
    "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
    "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus",
    "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John",
    "3 John", "Jude", "Revelation",
]

CHRONOLOGICAL_ORDER: List[str] = [
    "Job", "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
    "Judges", "Ruth", "1 Samuel", "2 Samuel", "Psalm", "1 Kings", "1 Chronicles",
    "2 Chronicles", "Proverbs", "Ecclesiastes", "Song of Solomon", "Joel",
    "Obadiah", "Jonah", "Amos", "Hosea", "Isaiah", "Micah", "Nahum", "2 Kings",
    "Zephaniah", "Jeremiah", "Habakkuk", "Lamentations", "Ezekiel", "Daniel",
    "Ezra", "Haggai", "Zechariah", "Esther", "Nehemiah", "Malachi",
    "Matthew", "Mark", "Luke", "John", "Acts", "James", "Galatians",
    "1 Thessalonians", "2 Thessalonians", "1 Corinthians", "2 Corinthians",
    "Romans", "Ephesians", "Philippians", "Colossians", "Philemon", "1 Timothy",
    "Titus", "1 Peter", "2 Timothy", "Hebrews", "2 Peter", "Jude", "1 John",
    "2 John", "3 John", "Revelation",
]

_DAYS = 365
_PLANS_CACHE: Dict[str, List[List[Dict[str, int]]]] = {}


def _build_plan(book_order: List[str], days: int = _DAYS) -> List[List[Dict[str, int]]]:
    """Distribute every chapter in book_order across `days` daily readings,
    never splitting a book's chapters out of order."""
    total_chapters = sum(CHAPTER_COUNTS[b] for b in book_order)
    target_per_day = total_chapters / days
    plan: List[List[Dict[str, int]]] = [[] for _ in range(days)]
    day = 0
    assigned = 0
    for book in book_order:
        for chapter in range(1, CHAPTER_COUNTS[book] + 1):
            plan[day].append({"book": book, "chapter": chapter})
            assigned += 1
            if day < days - 1 and assigned >= round(target_per_day * (day + 1)):
                day += 1
    return plan


def get_reading_plan(plan: str) -> List[List[Dict[str, int]]]:
    if plan not in _PLANS_CACHE:
        order = CANONICAL_ORDER if plan == "canonical" else CHRONOLOGICAL_ORDER
        _PLANS_CACHE[plan] = _build_plan(order)
    return _PLANS_CACHE[plan]


def get_day_reading(plan: str, day_index: int) -> List[Dict[str, int]]:
    schedule = get_reading_plan(plan)
    if day_index < 0 or day_index >= len(schedule):
        raise ValueError(f"day_index must be between 0 and {len(schedule) - 1}, got {day_index}")
    return schedule[day_index]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/chatbot/test_reading_plans.py -v`
Expected: 10 passed (2 parametrized tests × 2 plans + 4 single tests = 4+4+2 = 10)

- [ ] **Step 6: Commit**

```bash
git add chatbot/data/__init__.py chatbot/data/reading_plans.py tests/chatbot/test_reading_plans.py
git commit -m "feat: add chronological and canonical Bible-in-a-year reading plans"
```

---

## Task 6: Parable and topic data

**Files:**
- Create: `chatbot/data/parables.py`
- Create: `chatbot/data/topics.py`
- Test: `tests/chatbot/test_parables_and_topics.py`

**Interfaces:**
- Produces: `PARABLES: List[Dict]` and `get_parable(parable_id: str) -> Optional[Dict]` from `parables.py`; `TOPICS: List[Dict]` and `get_topic(topic_id: str) -> Optional[Dict]` from `topics.py`. Each parable dict has keys `id`, `name`, `reference`. Each topic dict has keys `id`, `name`, `seed_references`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_parables_and_topics.py
from chatbot.data.parables import PARABLES, get_parable
from chatbot.data.topics import TOPICS, get_topic


def test_parables_have_unique_ids():
    ids = [p["id"] for p in PARABLES]
    assert len(ids) == len(set(ids))
    assert len(PARABLES) >= 30


def test_parables_have_required_fields():
    for p in PARABLES:
        assert p["id"] and p["name"] and p["reference"]
        assert ":" in p["reference"]


def test_get_parable_known_id():
    prodigal = get_parable("prodigal_son")
    assert prodigal is not None
    assert prodigal["reference"] == "Luke 15:11-32"


def test_get_parable_unknown_id():
    assert get_parable("not_a_real_parable") is None


def test_topics_have_unique_ids():
    ids = [t["id"] for t in TOPICS]
    assert len(ids) == len(set(ids))
    assert len(TOPICS) >= 5


def test_topics_have_seed_references():
    for t in TOPICS:
        assert t["id"] and t["name"]
        assert len(t["seed_references"]) >= 1
        for ref in t["seed_references"]:
            assert ":" in ref


def test_get_topic_known_and_unknown():
    holiness = get_topic("holiness")
    assert holiness is not None
    assert get_topic("not_a_real_topic") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/chatbot/test_parables_and_topics.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.data.parables'`

- [ ] **Step 3: Implement `chatbot/data/parables.py`**

```python
"""Curated list of Jesus's parables for Parable Study mode."""

from typing import Any, Dict, List, Optional

PARABLES: List[Dict[str, Any]] = [
    {"id": "sower", "name": "The Sower", "reference": "Matthew 13:3-9"},
    {"id": "tares", "name": "The Wheat and the Tares", "reference": "Matthew 13:24-30"},
    {"id": "mustard_seed", "name": "The Mustard Seed", "reference": "Matthew 13:31-32"},
    {"id": "leaven", "name": "The Leaven", "reference": "Matthew 13:33"},
    {"id": "hidden_treasure", "name": "The Hidden Treasure", "reference": "Matthew 13:44"},
    {"id": "pearl", "name": "The Pearl of Great Price", "reference": "Matthew 13:45-46"},
    {"id": "net", "name": "The Net", "reference": "Matthew 13:47-50"},
    {"id": "unforgiving_servant", "name": "The Unforgiving Servant", "reference": "Matthew 18:23-35"},
    {"id": "laborers_vineyard", "name": "The Laborers in the Vineyard", "reference": "Matthew 20:1-16"},
    {"id": "two_sons", "name": "The Two Sons", "reference": "Matthew 21:28-32"},
    {"id": "wicked_tenants", "name": "The Wicked Tenants", "reference": "Matthew 21:33-46"},
    {"id": "wedding_feast", "name": "The Wedding Feast", "reference": "Matthew 22:1-14"},
    {"id": "ten_virgins", "name": "The Ten Virgins", "reference": "Matthew 25:1-13"},
    {"id": "talents", "name": "The Talents", "reference": "Matthew 25:14-30"},
    {"id": "sheep_and_goats", "name": "The Sheep and the Goats", "reference": "Matthew 25:31-46"},
    {"id": "wise_foolish_builders", "name": "The Wise and Foolish Builders", "reference": "Matthew 7:24-27"},
    {"id": "new_wine_old_wineskins", "name": "New Wine in Old Wineskins", "reference": "Matthew 9:16-17"},
    {"id": "growing_seed", "name": "The Growing Seed", "reference": "Mark 4:26-29"},
    {"id": "lamp_under_bushel", "name": "The Lamp Under a Bushel", "reference": "Mark 4:21-25"},
    {"id": "good_samaritan", "name": "The Good Samaritan", "reference": "Luke 10:25-37"},
    {"id": "friend_at_midnight", "name": "The Friend at Midnight", "reference": "Luke 11:5-8"},
    {"id": "rich_fool", "name": "The Rich Fool", "reference": "Luke 12:16-21"},
    {"id": "barren_fig_tree", "name": "The Barren Fig Tree", "reference": "Luke 13:6-9"},
    {"id": "great_banquet", "name": "The Great Banquet", "reference": "Luke 14:15-24"},
    {"id": "tower_builder_warring_king", "name": "The Tower Builder and the Warring King", "reference": "Luke 14:28-33"},
    {"id": "lost_sheep", "name": "The Lost Sheep", "reference": "Luke 15:3-7"},
    {"id": "lost_coin", "name": "The Lost Coin", "reference": "Luke 15:8-10"},
    {"id": "prodigal_son", "name": "The Prodigal Son", "reference": "Luke 15:11-32"},
    {"id": "unjust_steward", "name": "The Unjust Steward", "reference": "Luke 16:1-13"},
    {"id": "rich_man_lazarus", "name": "The Rich Man and Lazarus", "reference": "Luke 16:19-31"},
    {"id": "persistent_widow", "name": "The Persistent Widow", "reference": "Luke 18:1-8"},
    {"id": "pharisee_tax_collector", "name": "The Pharisee and the Tax Collector", "reference": "Luke 18:9-14"},
    {"id": "minas", "name": "The Ten Minas", "reference": "Luke 19:11-27"},
    {"id": "two_debtors", "name": "The Two Debtors", "reference": "Luke 7:41-43"},
    {"id": "faithful_wise_servant", "name": "The Faithful and Wise Servant", "reference": "Matthew 24:45-51"},
]


def get_parable(parable_id: str) -> Optional[Dict[str, Any]]:
    return next((p for p in PARABLES if p["id"] == parable_id), None)
```

- [ ] **Step 4: Implement `chatbot/data/topics.py`**

```python
"""Curated, progressively-growing list of topics for Topical Study mode.

Append new entries here as more topics are added — no other code needs
to change when the list grows.
"""

from typing import Any, Dict, List, Optional

TOPICS: List[Dict[str, Any]] = [
    {
        "id": "holiness",
        "name": "Biblical Holiness",
        "seed_references": ["Leviticus 19:2", "1 Peter 1:15-16", "Hebrews 12:14"],
    },
    {
        "id": "forgiveness",
        "name": "Forgiveness",
        "seed_references": ["Matthew 6:14-15", "Ephesians 4:32", "Colossians 3:13"],
    },
    {
        "id": "faith",
        "name": "Faith",
        "seed_references": ["Hebrews 11:1", "Romans 10:17", "James 2:17"],
    },
    {
        "id": "love",
        "name": "Love",
        "seed_references": ["1 Corinthians 13:4-7", "John 13:34-35", "1 John 4:7-8"],
    },
    {
        "id": "suffering",
        "name": "Suffering",
        "seed_references": ["Romans 5:3-5", "James 1:2-4", "1 Peter 4:12-13"],
    },
    {
        "id": "prayer",
        "name": "Prayer",
        "seed_references": ["Matthew 6:9-13", "Philippians 4:6-7", "1 Thessalonians 5:17"],
    },
    {
        "id": "grace",
        "name": "Grace",
        "seed_references": ["Ephesians 2:8-9", "2 Corinthians 12:9", "Titus 2:11"],
    },
    {
        "id": "hope",
        "name": "Hope",
        "seed_references": ["Romans 15:13", "Jeremiah 29:11", "Romans 8:24-25"],
    },
]


def get_topic(topic_id: str) -> Optional[Dict[str, Any]]:
    return next((t for t in TOPICS if t["id"] == topic_id), None)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/chatbot/test_parables_and_topics.py -v`
Expected: 7 passed

- [ ] **Step 6: Commit**

```bash
git add chatbot/data/parables.py chatbot/data/topics.py tests/chatbot/test_parables_and_topics.py
git commit -m "feat: add curated parable and topic data"
```

---

## Task 7: Mode primers — seed the first turn of a new mode session

**Files:**
- Modify: `chatbot/router.py`
- Modify: `chatbot/api.py`
- Test: `tests/chatbot/test_mode_primers.py`

**Interfaces:**
- Consumes: `get_day_reading` (Task 5), `get_parable` (Task 6), `get_topic` (Task 6), `random_verse`/`fetch_verse_translations` (existing + Task 4).
- Produces: `chatbot.router.build_mode_primer(mode: str, mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]` (same dict shape `route_deterministic`/`route_claude` already return: `type`, `message`, `data`, `route`, `follow_up_questions`, plus `artifacts`). `POST /chat` now checks `request.mode` before falling through to the existing deterministic/Claude routing.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_mode_primers.py
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


@pytest.mark.asyncio
async def test_freeform_primer():
    result = await build_mode_primer("freeform", {})
    assert result["type"] == "chat"
```

`pytest-asyncio` with `asyncio_mode = auto` is already configured (Task 4), so these `async def test_...` functions run without extra marker setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/chatbot/test_mode_primers.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_mode_primer' from 'chatbot.router'`

- [ ] **Step 3: Implement `build_mode_primer` in `chatbot/router.py`**

Add near the bottom of `chatbot/router.py`, after `route_claude`:

```python
# ---------------------------------------------------------------------------
# Mode primers — seed the first assistant turn of a new mode session
# ---------------------------------------------------------------------------

from chatbot.data.parables import get_parable
from chatbot.data.reading_plans import get_day_reading
from chatbot.data.topics import get_topic
from chatbot.tools import random_verse

_FULL_NAME_TO_USFM = {full: usfm for usfm, full in _USFM_TO_BOOK.items()}


async def build_mode_primer(mode: str, mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Build the seeded first assistant turn for a newly created mode session."""
    mode_params = mode_params or {}

    if mode == "reading_plan":
        plan = mode_params.get("plan", "chronological")
        day_index = int(mode_params.get("day_index", 0))
        readings = get_day_reading(plan, day_index)
        refs = [
            f"{_FULL_NAME_TO_USFM.get(r['book'], r['book'])} {r['chapter']}"
            for r in readings
        ]
        message = (
            f"**Day {day_index + 1} — {plan.title()} Reading Plan**\n\n"
            f"Today's reading: {', '.join(refs)}."
        )
        return {
            "type": "chat",
            "message": message,
            "data": {"plan": plan, "day_index": day_index, "readings": readings},
            "route": "Mode primer → reading_plan",
            "artifacts": [
                {"type": "interlinear", "label": f"Read {ref} ▸", "params": {"reference": f"{ref}:1"}}
                for ref in refs
            ],
            "follow_up_questions": [
                "Mark today's reading complete",
                "What happened right before this in the story?",
            ],
        }

    if mode == "parable":
        parable = get_parable(mode_params.get("parable_id", ""))
        if not parable:
            return {
                "type": "error", "message": "Unknown parable.", "data": None,
                "route": "Mode primer → parable → not found",
            }
        message = (
            f"**{parable['name']}** ({parable['reference']})\n\n"
            "Let's study this parable together. Would you like to start with the text itself, "
            "its historical context, or its meaning?"
        )
        return {
            "type": "chat",
            "message": message,
            "data": {"parable": parable},
            "route": "Mode primer → parable",
            "artifacts": [
                {"type": "interlinear", "label": f"Read {parable['reference']} ▸", "params": {"reference": parable["reference"]}},
            ],
            "follow_up_questions": [
                f"What is the meaning of {parable['name']}?",
                f"What is the historical context of {parable['name']}?",
            ],
        }

    if mode == "topic":
        topic = get_topic(mode_params.get("topic_id", ""))
        if not topic:
            return {
                "type": "error", "message": "Unknown topic.", "data": None,
                "route": "Mode primer → topic → not found",
            }
        message = (
            f"**Topical Study: {topic['name']}**\n\n"
            f"Here are some passages to start with: {', '.join(topic['seed_references'])}. "
            "What would you like to explore?"
        )
        return {
            "type": "chat",
            "message": message,
            "data": {"topic": topic},
            "route": "Mode primer → topic",
            "artifacts": [
                {"type": "interlinear", "label": f"Read {ref} ▸", "params": {"reference": ref}}
                for ref in topic["seed_references"]
            ],
            "follow_up_questions": [f"Show me more verses about {topic['name']}"],
        }

    if mode == "verse":
        reference = mode_params.get("reference")
        if reference:
            ref = reference
        else:
            book, chapter, verse = await random_verse()
            ref = _format_reference("", book, str(chapter), str(verse))
        try:
            result = await fetch_verse_translations(ref, languages=["eng"])
        except Exception:
            result = None
        if not result:
            return {
                "type": "error", "message": f"Could not fetch {ref}.", "data": None,
                "route": "Mode primer → verse → fetch failed",
            }
        usfm = ref.split(" ")[0].upper()
        return {
            "type": "verse",
            "message": f"Here is **{ref}**.",
            "data": {"reference": ref, "translations": result, "book_context": get_book_context(usfm)},
            "route": "Mode primer → verse",
            "follow_up_questions": _generate_follow_ups("verse", None, ref),
        }

    return {
        "type": "chat",
        "message": "Ask me anything about the Bible.",
        "data": None,
        "route": "Mode primer → freeform",
        "follow_up_questions": [
            "Show me a relevant Bible verse on a topic I care about",
            "What does the original language say about a verse?",
        ],
    }
```

- [ ] **Step 4: Wire into `POST /chat` in `chatbot/api.py`**

Modify `post_chat` (import `build_mode_primer` alongside the other `chatbot.router` imports at the top of the file):

```python
from chatbot.router import build_mode_primer, route_deterministic, route_claude, _generate_follow_ups


@router.post("/chat", response_model=ChatResponse)
async def post_chat(request: ChatRequest):
    """Process a chat message and return a structured response."""
    try:
        if request.mode and not request.message.strip():
            result = await build_mode_primer(request.mode, request.mode_params)
            return ChatResponse(**result)

        history = (
            [{"role": m.role, "text": m.text} for m in request.history]
            if request.history else None
        )
        result = await route_deterministic(
            request.message, history=history, page_context=request.page_context
        )
        if result:
            return ChatResponse(**result)
        result = await route_claude(
            request.message, history=history, page_context=request.page_context
        )
        if "follow_up_questions" not in result or not result["follow_up_questions"]:
            result["follow_up_questions"] = _generate_follow_ups(
                result.get("type", "chat"), result.get("data"), ""
            )
        return ChatResponse(**result)
    except Exception as e:
        return ChatResponse(
            type="error",
            message=f"Server error: {type(e).__name__}: {e}",
            data=None,
            route="Error path",
        )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/chatbot/test_mode_primers.py -v`
Expected: 8 passed

- [ ] **Step 6: Run the full backend test suite**

Run: `pytest tests/chatbot/ -v`
Expected: all tests passed (Tasks 1–7 combined)

- [ ] **Step 7: Commit**

```bash
git add chatbot/router.py chatbot/api.py requirements-dev.txt pytest.ini tests/chatbot/test_mode_primers.py
git commit -m "feat: seed new mode sessions with reading-plan/parable/topic/verse primers"
```

---

## Task 8: `GET /book_context/{book}` endpoint

**Why:** `get_book_context()` (`chatbot/book_context.py`) is currently only ever called internally, embedded inside verse-type `/chat` responses. The Frontend Plan's `book_context` artifact needs to fetch context for a book on demand (e.g. the user clicks "Book Context ▸" from a chat bubble that didn't already carry it). `get_book_context` parses `context.md` at the project root and has no external dependency, so this is a small, self-contained addition.

**Files:**
- Modify: `chatbot/schemas.py`
- Modify: `chatbot/api.py`
- Test: `tests/chatbot/test_book_context_endpoint.py`

**Interfaces:**
- Consumes: `get_book_context(book: str) -> Optional[Dict]` (existing, `chatbot/book_context.py`).
- Produces: `GET /book_context/{book}` — accepts a USFM code (`MAT`) or full name (`Matthew`), used by the frontend's `BookContextArtifact` component.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_book_context_endpoint.py
def test_get_book_context_by_usfm(client):
    res = client.get("/book_context/MAT")
    assert res.status_code == 200
    body = res.json()
    assert body["book_name"] == "Matthew"
    assert "sections" in body


def test_get_book_context_by_full_name(client):
    res = client.get("/book_context/John")
    assert res.status_code == 200
    assert res.json()["book_name"] == "John"


def test_get_book_context_unknown_book(client):
    res = client.get("/book_context/Genesis")
    assert res.status_code == 404
```

(`Genesis` is expected to 404 because `context.md` — and therefore `get_book_context` — only covers New Testament books, per the existing data.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/chatbot/test_book_context_endpoint.py -v`
Expected: FAIL — `404 Not Found` for `/book_context/MAT` too (route doesn't exist yet, indistinguishable from the "unknown book" 404 — the first two tests are the ones that prove the route now exists)

- [ ] **Step 3: Add a response schema to `chatbot/schemas.py`**

Add below `StrongsResponse`:

```python
class BookContextResponse(BaseModel):
    book: str = Field(..., description="USFM code")
    book_name: str = Field(..., description="Full book name")
    sections: Dict[str, Optional[str]] = Field(..., description="Section key -> content, or null if not available")
```

- [ ] **Step 4: Add the endpoint to `chatbot/api.py`**

Add near the other direct tool endpoints:

```python
from chatbot.book_context import get_book_context
from chatbot.schemas import BookContextResponse


@router.get("/book_context/{book}", response_model=BookContextResponse)
async def get_book_context_endpoint(book: str):
    """Fetch book-level context (historical setting, themes, etc.) for a NT book."""
    ctx = get_book_context(book)
    if not ctx:
        raise HTTPException(status_code=404, detail="No context available for this book")
    return BookContextResponse(**ctx)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/chatbot/test_book_context_endpoint.py -v`
Expected: 3 passed

- [ ] **Step 6: Run the full backend test suite**

Run: `pytest tests/chatbot/ -v`
Expected: all tests passed (Tasks 1–8 combined)

- [ ] **Step 7: Commit**

```bash
git add chatbot/schemas.py chatbot/api.py tests/chatbot/test_book_context_endpoint.py
git commit -m "feat: add GET /book_context/{book} endpoint"
```

---

## Task 9: `GET /parables` and `GET /topics` list endpoints

**Why:** The Frontend Plan's mode-picker screen needs to render the curated parable and topic lists so the user can choose one. `chatbot/data/parables.py` and `chatbot/data/topics.py` (Task 6) are the single source of truth — exposing them over HTTP means the frontend never hardcodes a duplicate copy that could drift as topics are added.

**Files:**
- Modify: `chatbot/schemas.py`
- Modify: `chatbot/api.py`
- Test: `tests/chatbot/test_list_endpoints.py`

**Interfaces:**
- Consumes: `PARABLES` (Task 6), `TOPICS` (Task 6).
- Produces: `GET /parables` → `{"parables": [...]}`, `GET /topics` → `{"topics": [...]}`, used by the frontend's `ModePickerScreen`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_list_endpoints.py
def test_get_parables(client):
    res = client.get("/parables")
    assert res.status_code == 200
    body = res.json()
    ids = {p["id"] for p in body["parables"]}
    assert "prodigal_son" in ids


def test_get_topics(client):
    res = client.get("/topics")
    assert res.status_code == 200
    body = res.json()
    ids = {t["id"] for t in body["topics"]}
    assert "holiness" in ids
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/chatbot/test_list_endpoints.py -v`
Expected: FAIL — `404 Not Found` for both routes

- [ ] **Step 3: Add response schemas to `chatbot/schemas.py`**

Add below `BookContextResponse`:

```python
class ParableEntry(BaseModel):
    id: str
    name: str
    reference: str


class ParablesResponse(BaseModel):
    parables: List[ParableEntry]


class TopicEntry(BaseModel):
    id: str
    name: str
    seed_references: List[str]


class TopicsResponse(BaseModel):
    topics: List[TopicEntry]
```

- [ ] **Step 4: Add the endpoints to `chatbot/api.py`**

```python
from chatbot.data.parables import PARABLES
from chatbot.data.topics import TOPICS
from chatbot.schemas import ParablesResponse, TopicsResponse


@router.get("/parables", response_model=ParablesResponse)
async def list_parables():
    """List the curated parables available for Parable Study mode."""
    return ParablesResponse(parables=PARABLES)


@router.get("/topics", response_model=TopicsResponse)
async def list_topics():
    """List the curated topics available for Topical Study mode."""
    return TopicsResponse(topics=TOPICS)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/chatbot/test_list_endpoints.py -v`
Expected: 2 passed

- [ ] **Step 6: Run the full backend test suite**

Run: `pytest tests/chatbot/ -v`
Expected: all tests passed (Tasks 1–9 combined)

- [ ] **Step 7: Commit**

```bash
git add chatbot/schemas.py chatbot/api.py tests/chatbot/test_list_endpoints.py
git commit -m "feat: add GET /parables and GET /topics list endpoints"
```

---

## Self-Review Notes

- **Spec coverage:** `ChatRequest.mode`/`mode_params` (Task 2), `ChatResponse.artifacts` (Task 2), gematria/English search as in-process tools (Tasks 3–4), reading-plan data with chronological/canonical sub-modes (Task 5), parable/topic curated lists (Task 6), mode-primer seeding via the existing `/chat` endpoint (Task 7), book-context lookup for the artifact panel (Task 8), parable/topic list endpoints for the mode picker (Task 9) — every backend item in the spec has a task.
- **Not covered here (by design):** the manuscript-image "Manuscript" tab, all frontend components, and theming are entirely frontend concerns — covered in the Frontend Plan. Gematria/English-search *fetching* by the artifact panel reuses Flask's existing `/api/gematria` and `/api/english` routes rather than a new FastAPI route (see Task 4's note) — the interlinear and Strong's artifacts likewise reuse Flask's existing `/api/explorer` and `/api/strongs`.
- **External-dependency isolation verified:** only the `verse`-mode primer branch touches `fetch_verse_translations` (pre-existing, `mybibletoolbox-code`-backed); Task 7's tests monkeypatch it so the whole suite runs offline.
