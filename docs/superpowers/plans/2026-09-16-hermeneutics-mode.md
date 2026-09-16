# Hermeneutics Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Hermeneutics** study mode that runs a passage through a fixed 8-phase interpretive methodology, streaming each phase into the chat and writing the finished report to the artifact pane.

**Architecture:** A new async-generator orchestrator (`chatbot/hermeneutics.py`) runs one LLM call per phase via `simple_completion()`, feeding each phase the passage text, the prior phases' output, and its own grounding. Phases 2, 4 and 7 perform real `Complete.db` lookups (interlinear words, Strong's entries, English full-text search, witness-verse verification); the rest run on model knowledge. Each completed phase is emitted to the browser as a new additive `phase` SSE event on `/chat/stream`, ahead of the single `final` event that carries the assembled report plus an inline artifact link.

**Tech Stack:** Python 3 / FastAPI / pytest (`asyncio_mode = auto`) / `dataset` over SQLite (`Complete.db`) on the backend; React + TypeScript + Zustand + vitest + Tailwind on the frontend.

**Spec:** `docs/superpowers/specs/2026-09-16-hermeneutics-mode-design.md`

## Global Constraints

- Test commands: backend `python3 -m pytest tests/chatbot/<file> -v` from the repo root (pytest.ini sets `pythonpath = .` and `asyncio_mode = auto`, so async tests need **no** `@pytest.mark.asyncio` decorator). Frontend `npm test` from `frontend/` (vitest), and `npx tsc -b` must pass.
- `Complete.db` is **read-only**. Never write to it. It is not in the repo; tests that query it run against the developer's local copy, exactly as `tests/chatbot/test_bible_search.py` already does.
- `chatbot/bible_search.py` is **deliberately independent of the external mybibletoolbox dependency** (see its module docstring). New `Complete.db` readers go there and import only `dataset`/stdlib. Do not import from `src.*` or `book_codes` in that file.
- `~` is the field delimiter inside multi-value `Complete` columns; always `.split('~')` before iterating. The `Original_Words_SN` and `Original_Words_values` columns are additionally wrapped in braces and leading/trailing tildes — strip with `.strip('{').strip('}').strip('~')` before splitting (this is what `myproject.py:380` does).
- **Two distinct word alignments exist in a `Complete` row and must not be mixed:** `Original_Words`, `Original_Words_SN`, `Original_Words_Translit` and `Original_Words_values` align with each other (7 entries for Genesis 1:1); `KJV_SN`, `KJV_Text`, `Root`, `Root_Translit` and `Root_val` align with each other (6 entries for Genesis 1:1). They are different lengths and different orders.
- Strong's numbers are prefixed `H` (Hebrew) / `G` (Greek).
- Reference format throughout the chatbot is USFM + space, e.g. `"1TH 4:15-18"`, `"GEN 1:1"`.
- Phase 8 **never blocks, retries, or suppresses** a report. A failed test is disclosed, not enforced.
- Passage scope: a single verse or a range of **at most 25 verses**. Anything larger gets a narrowing reply, never a truncated run. The cap is set by the parable corpus — 12 of the 42 entries in `chatbot/data/parables.py` exceed 12 verses, the longest (The Prodigal Son, Luke 15:11-32) being 22.
- A passage may be named by **reference** or by **description** ("the parable of the ten virgins"). Any resolution the user did not type verbatim is echoed back to them.
- Every git commit message ends with the line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- The existing SSE contract must be preserved exactly: zero or more `stream` events, then **exactly one** `final`, then a terminal `trace`. The new `phase` event is additive only.

---

## File Structure

| File | Responsibility |
|---|---|
| `chatbot/data/hermeneutic_rulings.py` (new) | Curated `RULINGS` data + `rulings_for(text)` phrase matching. Data only, no LLM, no I/O. |
| `chatbot/bible_search.py` (modify) | `fetch_interlinear_sync`, `fetch_strongs_entries_sync` — dependency-free `Complete.db` readers. |
| `chatbot/tools.py` (modify) | `fetch_interlinear`, `fetch_strongs_local` — async, `record_tool`-instrumented wrappers. |
| `chatbot/hermeneutics_phases.py` (new) | The eight `PhaseSpec` definitions: prompts, grounding kind, token budget. Prose-heavy, no orchestration logic. |
| `chatbot/data/parables.py` (read only) | Existing 42-entry name → reference table, reused for description resolution. Not modified. |
| `chatbot/hermeneutics.py` (new) | Orchestration: scope check, reference and description resolution, `run()` generator, Phase 4 verification, Phase 8 verdict parsing, synthesis, post-report Q&A, digest. |
| `chatbot/router.py` (modify) | `mode == "hermeneutics"` primer branch. |
| `chatbot/api.py` (modify) | Dispatch on both endpoints; emit `phase` SSE events. |
| `chatbot/schemas.py` (modify) | Mode description + `PhaseEvent` schema. |
| `frontend/src/types/session.ts` (modify) | `SessionMode`, `ArtifactLink`, `PhaseResult`, `SessionMessage.phases`, `ModeParams.runDigest`. |
| `frontend/src/lib/chatApi.ts` (modify) | `onPhase` handler + `phase` frame branch. |
| `frontend/src/components/chatbot/PhaseList.tsx` (new) | Collapsible phase rendering, witness list, verdict badges, caution banner. |
| `frontend/src/components/shell/ChatPane.tsx` (modify) | Wire `onPhase`; persist reference + digest into `modeParams`. |
| `frontend/src/components/artifacts/HermeneuticsArtifact.tsx` (new) | Full report pane rendering from inline params. |
| `frontend/src/store/useArtifactStore.ts`, `components/shell/ArtifactPane.tsx` (modify) | Route the new artifact type. |
| `frontend/src/components/shell/ModePickerScreen.tsx`, `SessionsPane.tsx`, `store/useSessionsStore.ts` (modify) | Entry point, sidebar grouping, label. |

---

### Task 1: Curated hermeneutic rulings

**Files:**
- Create: `chatbot/data/hermeneutic_rulings.py`
- Test: `tests/chatbot/test_hermeneutic_rulings.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `RULINGS: list[dict]` with keys `id: str`, `triggers: list[str]`, `reading: str`, `rejects: str`, `proofs: list[str]`; `rulings_for(text: str) -> list[dict]`; `render_rulings(rulings: list[dict]) -> str`.

- [ ] **Step 1: Write the failing test**

Create `tests/chatbot/test_hermeneutic_rulings.py`:

```python
from chatbot.bible_search import _USFM_TO_BNUM
from chatbot.data.hermeneutic_rulings import RULINGS, render_rulings, rulings_for


def test_ruling_ids_are_unique():
    ids = [r["id"] for r in RULINGS]
    assert len(ids) == len(set(ids))


def test_every_ruling_has_required_fields():
    for r in RULINGS:
        assert r["id"] and r["triggers"] and r["reading"] and r["rejects"]
        assert len(r["proofs"]) >= 1, f"{r['id']} has no proof texts"


def test_rulings_for_matches_case_insensitively():
    matched = rulings_for("A THORN IN THE FLESH was given to me")
    assert [r["id"] for r in matched] == ["thorn_in_the_flesh"]


def test_rulings_for_returns_empty_when_nothing_triggers():
    assert rulings_for("In the beginning God created the heaven and the earth.") == []


def test_rulings_for_matches_whole_phrases_only():
    # "tell me about the flesh" must not trigger the thorn ruling.
    assert rulings_for("tell me about the flesh") == []


def test_render_rulings_names_reading_and_rejection():
    text = render_rulings(rulings_for("thorn in the flesh"))
    assert "adversaries" in text.lower()
    assert "sickness" in text.lower()


def test_render_rulings_of_nothing_is_empty_string():
    assert render_rulings([]) == ""


def test_every_proof_text_resolves_against_complete_db():
    """Data-integrity guard, mirroring scripts/validate_devotional_pool.py:
    a ruling whose proof text does not exist would let the pipeline cite a
    verse that isn't there."""
    import dataset
    from chatbot.bible_search import DB_PATH

    db = dataset.connect(DB_PATH)
    for ruling in RULINGS:
        for proof in ruling["proofs"]:
            book, _, chapter_verse = proof.partition(" ")
            chapter, _, verse = chapter_verse.partition(":")
            bnum = _USFM_TO_BNUM.get(book.upper())
            assert bnum, f"{ruling['id']}: unknown book in proof {proof!r}"
            first_verse = int(verse.split("-")[0])
            row = db["Complete"].find_one(bnum=bnum, cnum=int(chapter), vnum=first_verse)
            assert row is not None, f"{ruling['id']}: proof {proof!r} does not resolve"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/chatbot/test_hermeneutic_rulings.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.data.hermeneutic_rulings'`

- [ ] **Step 3: Write the implementation**

Create `chatbot/data/hermeneutic_rulings.py`:

```python
"""Curated idiom and phrase rulings for Hermeneutics mode.

Each entry records how a biblical phrase is to be read under the
methodology this mode implements, the reading it explicitly rejects, and
the proof texts that carry it. `rulings_for()` returns only the rulings a
passage actually triggers, so a run pays tokens for the rulings that apply
rather than for the whole list.

Editing this list changes the mode's doctrinal output. Every proof text is
verified against Complete.db by
tests/chatbot/test_hermeneutic_rulings.py::test_every_proof_text_resolves_against_complete_db.
"""

import re
from typing import Any, Dict, List

RULINGS: List[Dict[str, Any]] = [
    {
        "id": "thorn_in_the_flesh",
        "triggers": ["thorn in the flesh", "thorn in the side", "thorns in your sides"],
        "reading": "harassing persons or adversaries (e.g. Judaizers, persecutors)",
        "rejects": "physical sickness or disease",
        "proofs": ["NUM 33:55", "2CO 12:7"],
    },
    {
        "id": "fear_and_trembling",
        "triggers": ["fear and trembling", "fear and tremble"],
        "reading": "overwhelming awe and reverence produced by God's goodness and prosperity",
        "rejects": "terror of divine judgement or fear of losing salvation",
        "proofs": ["JER 33:8-9", "MRK 5:33", "PHP 2:12"],
    },
    {
        "id": "single_eye",
        "triggers": ["single eye", "evil eye", "good eye", "bountiful eye"],
        "reading": "a Hebrew idiom for financial generosity ('good'/'single') versus stinginess ('evil')",
        "rejects": "spiritual focus, purity of gaze, or the occult",
        "proofs": ["MAT 6:22", "PRO 22:9"],
    },
    {
        "id": "overcomer",
        "triggers": ["overcometh", "overcomer", "him that overcometh"],
        "reading": "anyone who believes that Jesus is the Son of God",
        "rejects": "an elite subclass of especially victorious Christians",
        "proofs": ["1JN 5:4", "1JN 5:5"],
    },
    {
        "id": "certain_man",
        "triggers": ["a certain man", "a certain disciple"],
        "reading": "in Luke/Acts usage, 'a certain man' designates a non-believer while 'a certain disciple' designates a born-again believer",
        "rejects": "treating the two phrases as interchangeable narrative filler",
        "proofs": ["LUK 10:30", "ACT 9:10"],
    },
    {
        "id": "falling_from_grace",
        "triggers": ["fallen from grace", "fall from grace", "falling from grace"],
        "reading": "attempting to be justified by law, performance, or self-righteousness",
        "rejects": "moral failure or the loss of salvation",
        "proofs": ["GAL 5:4", "GAL 2:21"],
    },
    {
        "id": "sowing_and_reaping",
        "triggers": ["soweth", "sowing and reaping", "whatsoever a man soweth"],
        "reading": "in its Galatians 6 context, financial stewardship and the support of gospel teachers",
        "rejects": "God resurrecting forgiven sins to punish a believer",
        "proofs": ["GAL 6:6", "GAL 6:7"],
    },
    {
        "id": "lord_gave_and_took_away",
        "triggers": ["the lord gave, and the lord hath taken away", "lord hath taken away"],
        "reading": "a faithfully recorded statement of Job's own erroneous understanding",
        "rejects": "a divine doctrinal statement about how God operates",
        "proofs": ["JOB 1:21", "JAS 1:17", "JHN 10:10"],
    },
]


def rulings_for(text: str) -> List[Dict[str, Any]]:
    """The rulings whose trigger phrases appear in `text`, in RULINGS order.

    Matching is case-insensitive and whole-phrase: a trigger must appear on
    word boundaries, so "the flesh" alone never triggers the thorn ruling.
    """
    haystack = text.lower()
    matched = []
    for ruling in RULINGS:
        for trigger in ruling["triggers"]:
            if re.search(rf"\b{re.escape(trigger.lower())}\b", haystack):
                matched.append(ruling)
                break
    return matched


def render_rulings(rulings: List[Dict[str, Any]]) -> str:
    """Format matched rulings as prompt text. Empty string for no rulings,
    so callers can concatenate unconditionally."""
    if not rulings:
        return ""
    lines = ["STANDARD RULINGS that apply to this passage (these are settled — apply them):"]
    for r in rulings:
        proofs = ", ".join(r["proofs"])
        lines.append(f"- {r['triggers'][0]!r} means {r['reading']}, NOT {r['rejects']} ({proofs}).")
    return "\n".join(lines)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_hermeneutic_rulings.py -v`
Expected: PASS (8 tests). If a proof text fails to resolve, fix the reference in `RULINGS` — do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add chatbot/data/hermeneutic_rulings.py tests/chatbot/test_hermeneutic_rulings.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): curated idiom rulings data module

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Interlinear and Strong's readers in bible_search

**Files:**
- Modify: `chatbot/bible_search.py` (append after `list_passage_verses_sync`)
- Test: `tests/chatbot/test_bible_search.py` (append)

**Interfaces:**
- Consumes: `_USFM_TO_BNUM`, `DB_PATH`, `_strongs_row_to_dict` (all already in `chatbot/bible_search.py`).
- Produces:
  - `fetch_interlinear_sync(usfm_book: str, chapter: int, verse: int) -> Optional[Dict[str, Any]]` returning `{"ref": str, "words": [{"strongs", "translit", "value"}], "roots": [{"strongs", "root", "translit", "english"}]}`, or `None` for an unknown book/verse. (The `Original_Words` column itself holds nested XML markup, not plain words — transliteration plus the root entries carry everything the phases need, so it is not parsed.)
  - `fetch_strongs_entries_sync(numbers: List[str]) -> Dict[str, Dict[str, Any]]` keyed by Strong's number.

- [ ] **Step 1: Write the failing tests**

Append to `tests/chatbot/test_bible_search.py`:

```python
from chatbot.bible_search import fetch_interlinear_sync, fetch_strongs_entries_sync


def test_fetch_interlinear_returns_original_word_alignment():
    result = fetch_interlinear_sync("GEN", 1, 1)
    assert result["ref"] == "Genesis 1:1"
    # Original_Words_SN for Genesis 1:1 holds 7 entries, brace-wrapped.
    assert [w["strongs"] for w in result["words"]] == [
        "H7225", "H1254", "H430", "H853", "H8064", "H853", "H776",
    ]
    assert result["words"][0]["translit"] == "bəreyshiyt"
    assert result["words"][0]["value"] == 913


def test_fetch_interlinear_returns_root_alignment_separately():
    result = fetch_interlinear_sync("GEN", 1, 1)
    # Roots align with KJV_SN (6 entries), NOT with Original_Words_SN (7).
    assert [r["strongs"] for r in result["roots"]] == [
        "H7225", "H430", "H1254", "H8064", "H853", "H776",
    ]
    assert result["roots"][1]["translit"] == "ʾelohiym"
    assert "God" in result["roots"][1]["english"]


def test_fetch_interlinear_strips_markup_from_english():
    result = fetch_interlinear_sync("GEN", 1, 1)
    assert all("<" not in r["english"] for r in result["roots"])


def test_fetch_interlinear_unknown_book_returns_none():
    assert fetch_interlinear_sync("ZZZ", 1, 1) is None


def test_fetch_interlinear_missing_verse_returns_none():
    assert fetch_interlinear_sync("GEN", 1, 999) is None


def test_fetch_strongs_entries_returns_entries_by_number():
    entries = fetch_strongs_entries_sync(["H430", "H1254"])
    assert set(entries) == {"H430", "H1254"}
    assert entries["H430"]["transliteration1"] == "ʾelohiym"
    assert "God" in entries["H430"]["meaning"]


def test_fetch_strongs_entries_skips_unknown_numbers():
    entries = fetch_strongs_entries_sync(["H430", "H999999"])
    assert set(entries) == {"H430"}


def test_fetch_strongs_entries_of_nothing_is_empty():
    assert fetch_strongs_entries_sync([]) == {}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/chatbot/test_bible_search.py -v -k "interlinear or strongs_entries"`
Expected: FAIL — `ImportError: cannot import name 'fetch_interlinear_sync'`

- [ ] **Step 3: Write the implementation**

Append to `chatbot/bible_search.py`:

```python
# ---------------------------------------------------------------------------
# Interlinear + Strong's (Complete.db direct)
#
# A Complete row carries TWO different word alignments that must not be
# mixed: Original_Words_SN / _Translit / _values align with each other
# (every original-language word, 7 for Genesis 1:1), while KJV_SN / Root /
# Root_Translit / Root_val align with each other (one per KJV phrase, 6 for
# Genesis 1:1). They differ in both length and order.
# ---------------------------------------------------------------------------

def _split_braced(value: Optional[str]) -> List[str]:
    """Split a `{~a~b~}`-wrapped multi-value column (myproject.py:380)."""
    if not value:
        return []
    return [p for p in value.strip("{").strip("}").strip("~").split("~") if p]


def _split_tilde(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return value.split("~")


_SN_TAG_RE = re.compile(r"<[^>]+>")


def fetch_interlinear_sync(
    usfm_book: str, chapter: int, verse: int
) -> Optional[Dict[str, Any]]:
    """Per-word original-language data for one verse.

    Returns None for an unknown book or a verse that isn't in Complete.db.
    """
    bnum = _USFM_TO_BNUM.get(usfm_book.upper())
    if bnum is None:
        return None
    db = dataset.connect(DB_PATH)
    row = db["Complete"].find_one(bnum=bnum, cnum=chapter, vnum=verse)
    if row is None:
        return None

    word_sns = _split_braced(row.get("Original_Words_SN"))
    word_translits = _split_tilde(row.get("Original_Words_Translit"))
    word_values = _split_braced(row.get("Original_Words_values"))
    words = []
    for i, sn in enumerate(word_sns):
        raw_value = word_values[i] if i < len(word_values) else ""
        words.append({
            "strongs": sn,
            "translit": word_translits[i] if i < len(word_translits) else "",
            "value": int(raw_value) if raw_value.isdigit() else None,
        })

    root_sns = _split_tilde(row.get("KJV_SN"))
    roots_text = _split_tilde(row.get("Root"))
    root_translits = _split_tilde(row.get("Root_Translit"))
    kjv_phrases = _split_tilde(row.get("KJV_Text"))
    roots = []
    for i, sn in enumerate(root_sns):
        english = kjv_phrases[i] if i < len(kjv_phrases) else ""
        roots.append({
            "strongs": sn,
            "root": roots_text[i] if i < len(roots_text) else "",
            "translit": root_translits[i] if i < len(root_translits) else "",
            "english": _SN_TAG_RE.sub("", english).strip(),
        })

    return {"ref": row["ref"], "words": words, "roots": roots}


def fetch_strongs_entries_sync(numbers: List[str]) -> Dict[str, Dict[str, Any]]:
    """Strong's entries keyed by number. Unknown numbers are skipped.

    The local, dependency-free counterpart to chatbot.tools.fetch_strongs,
    which reaches the same data through the external mybibletoolbox package.
    """
    if not numbers:
        return {}
    db = dataset.connect(DB_PATH)
    entries: Dict[str, Dict[str, Any]] = {}
    for number in dict.fromkeys(numbers):  # de-duplicate, keep order
        row = db["Strongs_"].find_one(StrongsNumber=number)
        if row is not None:
            entries[number] = _strongs_row_to_dict(row)
    return entries
```

Check `_strongs_row_to_dict`'s existing output keys (it is already defined at `chatbot/bible_search.py:55`) and confirm it exposes `transliteration1` and `meaning`. If a key name differs, adjust the **test** assertions to the real key names rather than changing the shared helper — `search_gematria_sync` already depends on its current shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_bible_search.py -v`
Expected: PASS, including the pre-existing gematria/english/passage tests.

- [ ] **Step 5: Commit**

```bash
git add chatbot/bible_search.py tests/chatbot/test_bible_search.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): interlinear and Strong's readers over Complete.db

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Async tool wrappers

**Files:**
- Modify: `chatbot/tools.py` (append beside the existing `search_gematria` / `search_english` wrappers)
- Test: `tests/chatbot/test_tools_search_wrappers.py` (append)

**Interfaces:**
- Consumes: `fetch_interlinear_sync`, `fetch_strongs_entries_sync` (Task 2); `_run_in_thread`, `record_tool` (existing).
- Produces: `async fetch_interlinear(usfm_book: str, chapter: int, verse: int) -> Optional[Dict[str, Any]]`; `async fetch_strongs_local(numbers: List[str]) -> Dict[str, Dict[str, Any]]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/chatbot/test_tools_search_wrappers.py`:

```python
from chatbot.tools import fetch_interlinear, fetch_strongs_local


async def test_fetch_interlinear_wrapper_returns_words():
    result = await fetch_interlinear("GEN", 1, 1)
    assert result["ref"] == "Genesis 1:1"
    assert result["words"][0]["strongs"] == "H7225"


async def test_fetch_strongs_local_wrapper_returns_entries():
    entries = await fetch_strongs_local(["H430"])
    assert "H430" in entries
```

Read the top of this file first: follow whatever import and trace-assertion conventions the existing wrapper tests already use.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/chatbot/test_tools_search_wrappers.py -v -k "interlinear or strongs_local"`
Expected: FAIL — `ImportError: cannot import name 'fetch_interlinear'`

- [ ] **Step 3: Write the implementation**

Append to `chatbot/tools.py`, and add `fetch_interlinear_sync, fetch_strongs_entries_sync` to the existing `from chatbot.bible_search import (...)` block:

```python
async def fetch_interlinear(
    usfm_book: str, chapter: int, verse: int
) -> Optional[Dict[str, Any]]:
    with record_tool(
        "fetch_interlinear",
        {"args": {"book": usfm_book, "chapter": chapter, "verse": verse}},
    ) as _step:
        result = await _run_in_thread(fetch_interlinear_sync, usfm_book, chapter, verse)
        _step.set_response(result)
        return result


async def fetch_strongs_local(numbers: List[str]) -> Dict[str, Any]:
    """Strong's entries straight from Complete.db — the dependency-free
    counterpart to fetch_strongs(), which goes through mybibletoolbox."""
    with record_tool("fetch_strongs_local", {"args": {"numbers": numbers}}) as _step:
        result = await _run_in_thread(fetch_strongs_entries_sync, numbers)
        _step.set_response(result)
        return result
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_tools_search_wrappers.py tests/chatbot/test_tools_trace.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add chatbot/tools.py tests/chatbot/test_tools_search_wrappers.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): async traced wrappers for interlinear and Strong's

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Phase definitions

**Files:**
- Create: `chatbot/hermeneutics_phases.py`
- Test: `tests/chatbot/test_hermeneutics_phases.py`

**Interfaces:**
- Consumes: nothing (pure data).
- Produces: `PHASES: List[PhaseSpec]` (8 entries) and `SYNTHESIS_PROMPT: str`, where `PhaseSpec` is a dataclass with fields `index: int`, `title: str`, `grounding: str` (one of `"book_context"`, `"lexical"`, `"witnesses"`, `"roots"`, `"none"`), `system_prompt: str`, `max_tokens: int`.

- [ ] **Step 1: Write the failing test**

Create `tests/chatbot/test_hermeneutics_phases.py`:

```python
from chatbot.hermeneutics_phases import PHASES, SYNTHESIS_PROMPT


def test_there_are_eight_phases_in_order():
    assert [p.index for p in PHASES] == [1, 2, 3, 4, 5, 6, 7, 8]


def test_phase_titles_match_the_methodology():
    titles = " | ".join(p.title.lower() for p in PHASES)
    for expected in ("context", "semantic", "record", "witness", "priority",
                     "covenant", "typolog", "validation"):
        assert expected in titles


def test_grounded_phases_are_two_four_and_seven():
    grounded = {p.index: p.grounding for p in PHASES}
    assert grounded[1] == "book_context"
    assert grounded[2] == "lexical"
    assert grounded[4] == "witnesses"
    assert grounded[7] == "roots"
    assert grounded[3] == grounded[5] == grounded[6] == grounded[8] == "none"


def test_phase_one_asks_for_the_eight_point_scan_and_audience():
    prompt = PHASES[0].system_prompt.lower()
    assert "by whom" in prompt and "to whom" in prompt
    assert "audience:" in prompt


def test_phase_three_distinguishes_record_from_truth():
    prompt = PHASES[2].system_prompt.lower()
    assert "records lies" in prompt or "faithfully records" in prompt
    assert "speaker:" in prompt


def test_phase_four_requires_two_or_three_witnesses():
    prompt = PHASES[3].system_prompt.lower()
    assert "two or three" in prompt
    assert "witnesses:" in prompt


def test_phase_eight_names_all_three_tests_and_forbids_rewriting():
    prompt = PHASES[7].system_prompt.lower()
    assert "heart" in prompt and "cross test" in prompt and "grace test" in prompt
    assert "verdict:" in prompt


def test_every_phase_has_a_token_budget():
    assert all(p.max_tokens > 0 for p in PHASES)


def test_synthesis_prompt_asks_for_the_final_interpretation():
    assert "final verified interpretation" in SYNTHESIS_PROMPT.lower()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_phases.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.hermeneutics_phases'`

- [ ] **Step 3: Write the implementation**

Create `chatbot/hermeneutics_phases.py`:

```python
"""The eight phase definitions for Hermeneutics mode.

Prompts only — no orchestration, no I/O. chatbot/hermeneutics.py runs
these in order, feeding each phase the passage, the prior phases' output,
and the grounding named by its `grounding` field.

Several phases are asked to emit a machine-readable line (`AUDIENCE:`,
`SPEAKER:`, `WITNESSES:`, `VERDICT:`) in addition to their prose. The
orchestrator parses those lines to carry structure forward and to drive the
UI; a phase whose line is missing degrades to prose-only rather than
failing the run.
"""

from dataclasses import dataclass
from typing import List

CORE_PHILOSOPHY = """You are a Biblical Hermeneutics Engine performing systematic, source-grounded interpretation.

Hold three commitments throughout:
1. Spiritual dependence — academic tools alone do not grant spiritual understanding.
2. Christocentric focus — every passage testifies to Jesus Christ and His finished work, and the aim is to strengthen the heart in love rather than to inflate intellectual pride.
3. Feed the inner man — Scripture is a bread book for nourishment and grace, not a textbook for speculative debate.

Be concise and concrete. Ground every claim in the passage and the data you are given. Never invent a verse reference."""


@dataclass(frozen=True)
class PhaseSpec:
    index: int
    title: str
    grounding: str  # book_context | lexical | witnesses | roots | none
    system_prompt: str
    max_tokens: int = 900


PHASES: List[PhaseSpec] = [
    PhaseSpec(
        index=1,
        title="Contextual & Historical Scope Intake",
        grounding="book_context",
        system_prompt=CORE_PHILOSOPHY + """

PHASE 1 — Apply the Miles Coverdale rule. Answer all eight points in one short line each:
1. What is said or written? 2. By whom? 3. To whom? 4. With what words?
5. At what time? 6. Where? 7. To what intent? 8. Under what circumstances?

Then apply audience separation: the whole Bible is written FOR the believer, but not every passage is written TO the believer. Classify the primary addressee as the Jew, the Gentile, or the Church.

End your reply with exactly one line:
AUDIENCE: jew|gentile|church""",
    ),
    PhaseSpec(
        index=2,
        title="Inter-Textual Semantic Analysis",
        grounding="lexical",
        system_prompt=CORE_PHILOSOPHY + """

PHASE 2 — Scripture interprets Scripture. Define this passage's key words, idioms and phrases from their usage elsewhere in Scripture and from the Strong's data supplied, never from modern cultural assumption or an external dictionary.

For each key term give: the term, its biblical definition, and where else Scripture uses it that way.

Any STANDARD RULINGS supplied below are settled — apply them as given and do not argue the rejected reading.""",
        max_tokens=1100,
    ),
    PhaseSpec(
        index=3,
        title="Factual Record vs. Absolute Truth",
        grounding="none",
        system_prompt=CORE_PHILOSOPHY + """

PHASE 3 — The Holy Spirit faithfully records lies, flawed human assumptions and enemy speeches, but those recordings are not God's doctrine or His will.

Decide which this passage is. If the speaker is God or an inspired prophet revealing God's character, it is divine truth. If the speaker is a human making a flawed assumption, an adversary, or a liar, it is a recorded fact and not divine truth.

State who is speaking, and what follows for how the passage may be used doctrinally.

End your reply with exactly one line:
SPEAKER: god|prophet|human|adversary""",
        max_tokens=700,
    ),
    PhaseSpec(
        index=4,
        title="Two-or-Three Witnesses Verification",
        grounding="witnesses",
        system_prompt=CORE_PHILOSOPHY + """

PHASE 4 — No doctrine stands on an isolated verse, a single allegory, or a private revelation (Deuteronomy 19:15, 2 Corinthians 13:1). Confirm the interpretation so far by at least two or three clear scriptural witnesses.

Explain in one or two sentences what each witness establishes.

End your reply with exactly one line listing only the references, comma-separated, in USFM form:
WITNESSES: 1CO 15:51-52, JHN 14:2-3, PHP 3:20-21""",
        max_tokens=800,
    ),
    PhaseSpec(
        index=5,
        title="Priority Resolution (Clear vs. Obscure)",
        grounding="none",
        system_prompt=CORE_PHILOSOPHY + """

PHASE 5 — Plain, unambiguous, foundational statements must never be overridden, modified or set aside by obscure, figurative or difficult passages. Interpret the obscure in light of the clear, never the reverse.

Name the clear declaration(s) that govern here, name any obscure or figurative passage commonly set against them, and state which governs and why.""",
        max_tokens=800,
    ),
    PhaseSpec(
        index=6,
        title="Covenantal & Cross-Filtering",
        grounding="none",
        system_prompt=CORE_PHILOSOPHY + """

PHASE 6 — Rightly divide the word of truth (2 Timothy 2:15). Filter the passage through the cross.

Old Covenant of Law: man's performance and works; "by no means clear the guilty"; conditional blessing; sin imputed.
New Covenant of Grace: Christ's finished work; "their sins I will remember no more"; unconditional standing; righteousness imparted.

Say which side of the cross this passage falls on, and what that means for applying it to a believer today. Watch for prophetic pauses, as when Jesus stopped mid-sentence in Luke 4:18-19, omitting "the day of vengeance of our God".""",
        max_tokens=900,
    ),
    PhaseSpec(
        index=7,
        title="Typological, Divine Title & Name Mapping",
        grounding="roots",
        system_prompt=CORE_PHILOSOPHY + """

PHASE 7 — "The new is in the old contained, the old is in the new explained."

Every Old Testament type must point first to Christ, His finished work, or His Church, before any secondary personal application.

Use the root meanings and divine titles supplied below. Elohim names God as Creator, Judge and Power, known to the world at large; Yahweh (LORD) names Him in covenant-keeping, unmerited grace and personal redemption. Where the passage uses one rather than the other, say what that signals.""",
        max_tokens=900,
    ),
    PhaseSpec(
        index=8,
        title="Output Validation & Hermeneutical Guardrails",
        grounding="none",
        system_prompt=CORE_PHILOSOPHY + """

PHASE 8 — Run the interpretation built in the phases above through three tests. Be honest: a failure is reported, not hidden, and you must NOT rewrite the interpretation to make a test pass.

1. The Heart & Love Test — does it inspire greater love, gratitude and devotion toward Jesus Christ, producing unconscious holiness? If it produces legalism or spiritual pride, it fails.
2. The Cross Test — does it honour the full, once-for-all sufficiency of Jesus' sacrifice? If it reintroduces sin-consciousness, fear of condemnation or self-righteousness, it fails.
3. The Grace Test — does it align with God no longer counting the believer's sins against them, because those sins were fully judged in Christ?

Give one short sentence of reasoning per test.

End your reply with exactly three lines:
VERDICT: heart=pass|fail — reason
VERDICT: cross=pass|fail — reason
VERDICT: grace=pass|fail — reason""",
        max_tokens=800,
    ),
]

SYNTHESIS_PROMPT = CORE_PHILOSOPHY + """

Write the FINAL VERIFIED INTERPRETATION: two or three short paragraphs summarising what the passage means, who it is addressed to, which covenant it belongs to, and what it gives the reader. Draw only on the phase findings supplied. Do not introduce a verse reference that no phase established. If a validation test failed, say so plainly in one sentence rather than glossing over it."""
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_phases.py -v`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/hermeneutics_phases.py tests/chatbot/test_hermeneutics_phases.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): the eight phase definitions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Passage scope and passage resolution

**Files:**
- Create: `chatbot/hermeneutics.py`
- Test: `tests/chatbot/test_hermeneutics_scope.py`

**Interfaces:**
- Consumes: `_resolve_verse_reference`, `_format_reference` (`chatbot/router.py`); `_detect_reference`, `_reference_from_history` (`chatbot/socratic.py`); `random_verse` (`chatbot/tools.py`).
- Produces:
  - `MAX_PASSAGE_VERSES = 25`
  - `parse_scope(reference: str) -> Tuple[str, int, int, int]` → `(usfm, chapter, start_verse, end_verse)`; raises `ScopeError` for a bare chapter or an over-long range.
  - `class ScopeError(Exception)` with a `.message` carrying the user-facing narrowing reply.
  - `async resolve_passage(message, reference, history) -> Tuple[Optional[str], bool]` — `(reference, was_described)`. `was_described` is True when the passage came from a description rather than something the user typed verbatim, and is what makes the run echo its reading back.
  - `async resolve_description(text: str) -> Optional[str]` — curated parable lookup, then a one-retry LLM fallback.
  - `find_parable_reference(text: str) -> Optional[str]` — the local table lookup, no LLM call.

- [ ] **Step 1: Write the failing test**

Create `tests/chatbot/test_hermeneutics_scope.py`:

```python
import pytest

from chatbot import hermeneutics


def test_parse_scope_single_verse():
    assert hermeneutics.parse_scope("ROM 8:1") == ("ROM", 8, 1, 1)


def test_parse_scope_range():
    assert hermeneutics.parse_scope("1TH 4:15-18") == ("1TH", 4, 15, 18)


def test_parse_scope_allows_the_longest_curated_parable():
    # The Prodigal Son, Luke 15:11-32 — 22 verses, the corpus maximum.
    assert hermeneutics.parse_scope("LUK 15:11-32") == ("LUK", 15, 11, 32)


def test_parse_scope_allows_a_twenty_five_verse_range():
    assert hermeneutics.parse_scope("ROM 8:1-25") == ("ROM", 8, 1, 25)


def test_parse_scope_rejects_a_twenty_six_verse_range():
    with pytest.raises(hermeneutics.ScopeError) as exc:
        hermeneutics.parse_scope("ROM 8:1-26")
    assert "26 verses" in exc.value.message


def test_every_curated_parable_is_within_the_cap():
    """The cap and the parable corpus are two settings that can silently
    collide — this is the guard that they have not."""
    from chatbot.data.parables import PARABLES
    from chatbot.router import _resolve_verse_reference

    for parable in PARABLES:
        resolved = _resolve_verse_reference(parable["reference"])
        assert resolved, f"{parable['id']}: reference does not resolve"
        hermeneutics.parse_scope(resolved)  # raises ScopeError if over


def test_parse_scope_rejects_a_bare_chapter_and_says_how_long_it_is():
    with pytest.raises(hermeneutics.ScopeError) as exc:
        hermeneutics.parse_scope("GEN 1")
    assert "31 verses" in exc.value.message
    assert "which part" in exc.value.message.lower()


def test_scope_error_message_is_user_facing_not_a_stack_trace():
    with pytest.raises(hermeneutics.ScopeError) as exc:
        hermeneutics.parse_scope("GEN 1")
    assert not exc.value.message.startswith("Traceback")


async def test_resolve_passage_prefers_a_reference_named_this_turn():
    resolved = await hermeneutics.resolve_passage(
        "Actually, run Romans 8:1", reference="1TH 4:15-18", history=None
    )
    assert resolved == "ROM 8:1"


async def test_resolve_passage_falls_back_to_the_session_reference():
    resolved = await hermeneutics.resolve_passage(
        "what about the covenant here?", reference="1TH 4:15-18", history=None
    )
    assert resolved == "1TH 4:15-18"


async def test_resolve_passage_falls_back_to_history():
    history = [{"role": "user", "text": "Let's look at John 3:16"}]
    resolved = await hermeneutics.resolve_passage("go on", reference=None, history=history)
    assert resolved == "JHN 3:16"


async def test_resolve_passage_returns_none_when_no_passage_anywhere():
    assert await hermeneutics.resolve_passage("hello", reference=None, history=[]) is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_scope.py -v`
Expected: FAIL — `ImportError: cannot import name 'hermeneutics' from 'chatbot'`

- [ ] **Step 3: Write the implementation**

Create `chatbot/hermeneutics.py`:

```python
"""Hermeneutics mode: run a passage through a fixed 8-phase interpretive
methodology, one LLM call per phase, emitting each phase as it completes.

Grounding is real for Phases 2, 4 and 7 (interlinear words, Strong's
entries, English full-text search, witness verification against
Complete.db); the remaining phases run on model knowledge over the passage
and the phases already completed. See
docs/superpowers/specs/2026-09-16-hermeneutics-mode-design.md.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

from chatbot.bible_search import list_passage_verses_sync
from chatbot.router import _USFM_TO_BOOK, _resolve_verse_reference
from chatbot.socratic import _detect_reference, _reference_from_history

MAX_PASSAGE_VERSES = 25

_SCOPE_RE = re.compile(r"^([1-3]?[A-Z]{2,3})\s+(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$")


class ScopeError(Exception):
    """A passage too large (or too vague) to run. `.message` is the
    user-facing narrowing reply, not a diagnostic."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _chapter_length(usfm: str, chapter: int) -> Optional[int]:
    book_name = _USFM_TO_BOOK.get(usfm.upper())
    if not book_name:
        return None
    return len(list_passage_verses_sync(book_name, chapter)) or None


def parse_scope(reference: str) -> Tuple[str, int, int, int]:
    """(usfm, chapter, start_verse, end_verse) for a runnable passage.

    Raises ScopeError, carrying the reply to send the user, for a bare
    chapter or a range longer than MAX_PASSAGE_VERSES.
    """
    match = _SCOPE_RE.match(reference.strip().upper())
    if not match:
        # A bare chapter ("GEN 1") is the common case here.
        bare = re.match(r"^([1-3]?[A-Z]{2,3})\s+(\d{1,3})$", reference.strip().upper())
        if bare:
            usfm, chapter = bare.group(1), int(bare.group(2))
            length = _chapter_length(usfm, chapter)
            book = _USFM_TO_BOOK.get(usfm, usfm)
            if length:
                raise ScopeError(
                    f"That's {book} {chapter} — {length} verses. A full run goes deep on "
                    "every word, so it works best on the passage that carries the point. "
                    "Which part would you like me to take?"
                )
            raise ScopeError(
                f"I need a verse or a short range to run — which part of {book} {chapter} "
                "would you like me to take?"
            )
        raise ScopeError(
            "Give me a verse or a short range to run — for example "
            "\"Romans 8:1\" or \"1 Thessalonians 4:15-18\"."
        )

    usfm, chapter = match.group(1), int(match.group(2))
    start = int(match.group(3))
    end = int(match.group(4)) if match.group(4) else start
    if end < start:
        start, end = end, start
    span = end - start + 1
    if span > MAX_PASSAGE_VERSES:
        book = _USFM_TO_BOOK.get(usfm, usfm)
        raise ScopeError(
            f"That's {span} verses. A full run goes deep on every word, so I cap it at "
            f"{MAX_PASSAGE_VERSES} — which part of {book} {chapter} carries the point "
            "you're after?"
        )
    return usfm, chapter, start, end


async def resolve_passage(
    message: str,
    reference: Optional[str],
    history: Optional[List[Dict[str, str]]],
) -> Optional[str]:
    """The passage this turn is about.

    A passage named in *this* message always wins over the one the session
    was previously grounded on — the same precedence socratic.answer() uses.
    """
    return (
        _detect_reference(message)
        or reference
        or _reference_from_history(history or [])
    )
```

Note: `_USFM_TO_BOOK` is imported from `chatbot/router.py`, where `chatbot/socratic.py` already imports it. Confirm the name before relying on it; if it lives elsewhere, import it from wherever socratic.py gets it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_scope.py -v`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/hermeneutics.py tests/chatbot/test_hermeneutics_scope.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): passage scope enforcement and reference resolution

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Write the failing description-resolution test**

A user should not have to know chapter and verse to use the mode. Create `tests/chatbot/test_hermeneutics_description.py`:

```python
import pytest

from chatbot import hermeneutics


def test_parable_lookup_matches_the_full_name():
    assert hermeneutics.find_parable_reference("the parable of the ten virgins") == "MAT 25:1-13"


def test_parable_lookup_matches_a_bare_name():
    assert hermeneutics.find_parable_reference("ten virgins") == "MAT 25:1-13"


def test_parable_lookup_matches_digits_for_number_words():
    assert hermeneutics.find_parable_reference("the 10 virgins") == "MAT 25:1-13"


def test_parable_lookup_matches_inside_a_sentence():
    assert hermeneutics.find_parable_reference(
        "Could you run the prodigal son for me?"
    ) == "LUK 15:11-32"


def test_parable_lookup_ignores_an_unrelated_message():
    assert hermeneutics.find_parable_reference("what does grace mean?") is None


def test_parable_lookup_does_not_match_on_a_single_common_word():
    # "The Lost Sheep" and "The Lost Coin" both contain "lost"; one weak
    # token must not pick a parable arbitrarily.
    assert hermeneutics.find_parable_reference("I feel lost") is None


async def test_resolve_description_prefers_the_table_over_the_llm(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("the table should have answered without an LLM call")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)
    assert await hermeneutics.resolve_description("the ten virgins") == "MAT 25:1-13"


async def test_resolve_description_falls_back_to_the_llm(monkeypatch):
    async def fake(system_prompt, user_prompt, *, max_tokens=64):
        return "Ephesians 6:10-18"

    monkeypatch.setattr(hermeneutics, "simple_completion", fake)
    assert await hermeneutics.resolve_description("the armour of God") == "EPH 6:10-18"


async def test_resolve_description_retries_once_then_gives_up(monkeypatch):
    calls = []

    async def unparseable(system_prompt, user_prompt, *, max_tokens=64):
        calls.append(1)
        return "I'm not sure which passage you mean."

    monkeypatch.setattr(hermeneutics, "simple_completion", unparseable)
    assert await hermeneutics.resolve_description("something vague") is None
    assert len(calls) == 2, "one retry, then give up"


async def test_resolve_description_never_guesses_a_random_verse(monkeypatch):
    async def empty(system_prompt, user_prompt, *, max_tokens=64):
        return ""

    monkeypatch.setattr(hermeneutics, "simple_completion", empty)
    # Unlike devotional.pick_verse_for_theme, which falls back to a random
    # verse: an eight-phase analysis of a passage the user did not ask about
    # is worse than asking them.
    assert await hermeneutics.resolve_description("???") is None


async def test_resolve_passage_flags_a_described_passage(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("no LLM call expected")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)
    resolved, described = await hermeneutics.resolve_passage(
        "run the parable of the ten virgins", reference=None, history=None
    )
    assert resolved == "MAT 25:1-13"
    assert described is True


async def test_resolve_passage_does_not_flag_an_explicit_reference():
    resolved, described = await hermeneutics.resolve_passage(
        "run Romans 8:1", reference=None, history=None
    )
    assert resolved == "ROM 8:1"
    assert described is False


async def test_resolve_passage_prefers_an_explicit_reference_over_a_description(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("no LLM call expected")

    monkeypatch.setattr(hermeneutics, "simple_completion", explode)
    resolved, described = await hermeneutics.resolve_passage(
        "the parable of the ten virgins — actually, Matthew 25:1", reference=None, history=None
    )
    assert resolved == "MAT 25:1"
    assert described is False
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_description.py -v`
Expected: FAIL — `AttributeError: module 'chatbot.hermeneutics' has no attribute 'find_parable_reference'`

- [ ] **Step 8: Write the description-resolution implementation**

Replace `resolve_passage` in `chatbot/hermeneutics.py` with the version below, and add the two new functions above it. New imports: `PARABLES` from `chatbot.data.parables`, `simple_completion` from `chatbot.ollama_client`, and `_find_flexible_verse_refs`, `_format_reference` from `chatbot.router`.

```python
# Parable names use number words ("Ten Virgins", "Two Sons") while users
# often type digits.
_NUMBER_WORDS = {
    "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
}

# Words carried by so many parable names that matching on them alone would
# pick a parable arbitrarily.
_WEAK_TOKENS = {"the", "of", "a", "and", "parable", "story", "lost", "good", "great", "rich", "wise"}


def _tokens(text: str) -> set:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {_NUMBER_WORDS.get(w, w) for w in words}


def find_parable_reference(text: str) -> Optional[str]:
    """A curated parable named in `text`, as a USFM reference.

    Matches when every distinctive word of the parable's name appears in
    the message, so "the parable of the ten virgins", "ten virgins" and
    "the 10 virgins" all hit. A name whose only tokens are weak ones
    cannot match at all.
    """
    message_tokens = _tokens(text)
    best: Optional[Tuple[int, str]] = None
    for parable in PARABLES:
        name_tokens = _tokens(parable["name"])
        distinctive = name_tokens - _WEAK_TOKENS
        if not distinctive or not distinctive <= message_tokens:
            continue
        # Prefer the most specific name when two parables both match
        # (e.g. "The Lost Sheep" vs "The Lost Coin" given both words).
        if best is None or len(distinctive) > best[0]:
            best = (len(distinctive), parable["reference"])
    if best is None:
        return None
    return _resolve_verse_reference(best[1])


_DESCRIPTION_SYSTEM_PROMPT = (
    "You identify which Bible passage a description refers to. Reply with only "
    "the reference and nothing else."
)


async def resolve_description(text: str) -> Optional[str]:
    """A passage described rather than cited, as a USFM reference.

    The curated parable table answers first (no LLM call). Anything else
    gets one short completion plus one retry. Unlike
    devotional.pick_verse_for_theme(), a failure returns None rather than a
    random verse: an eight-phase analysis of a passage the user did not ask
    about is worse than asking them which passage they meant.
    """
    from_table = find_parable_reference(text)
    if from_table:
        return from_table

    ask = (
        f"Which Bible passage is this describing: '{text}'? "
        "Reply with only the reference, e.g. `Ephesians 6:10-18`. "
        "If you cannot tell, reply with the word NONE."
    )
    for _ in range(2):
        reply = await simple_completion(_DESCRIPTION_SYSTEM_PROMPT, ask, max_tokens=64)
        refs = _find_flexible_verse_refs(reply or "")
        if refs:
            return _format_reference(*refs[0])
    return None


async def resolve_passage(
    message: str,
    reference: Optional[str],
    history: Optional[List[Dict[str, str]]],
) -> Tuple[Optional[str], bool]:
    """(the passage this turn is about, whether it came from a description).

    A passage named in *this* message always wins over the one the session
    was previously grounded on — the same precedence socratic.answer()
    uses. A description is only consulted when no explicit reference is
    available anywhere, so "the ten virgins — actually, Matthew 25:1" runs
    the verse the user corrected themselves to.
    """
    explicit = (
        _detect_reference(message)
        or reference
        or _reference_from_history(history or [])
    )
    if explicit:
        return explicit, False
    described = await resolve_description(message)
    return described, bool(described)
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_description.py tests/chatbot/test_hermeneutics_scope.py -v`
Expected: PASS. Note that the four `resolve_passage` tests written in Step 1 now unpack a tuple — update them to `resolved, _ = await hermeneutics.resolve_passage(...)` as part of this step.

- [ ] **Step 10: Commit**

```bash
git add chatbot/hermeneutics.py tests/chatbot/test_hermeneutics_description.py tests/chatbot/test_hermeneutics_scope.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): resolve a passage from a description, not just a reference

The curated parable table answers first with no LLM call; anything else
gets one short completion plus a retry, and gives up rather than guessing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Grounding builders

**Files:**
- Modify: `chatbot/hermeneutics.py`
- Test: `tests/chatbot/test_hermeneutics_grounding.py`

**Interfaces:**
- Consumes: Task 2/3 tools, `rulings_for`/`render_rulings` (Task 1), `PHASES` (Task 4), `get_book_context`, `list_passage_verses_sync`.
- Produces: `async build_grounding(kind: str, usfm: str, chapter: int, start: int, end: int, passage_text: str) -> str` — the phase-specific grounding block, `""` for `kind == "none"`.
- Produces: `async passage_text_for(usfm: str, chapter: int, start: int, end: int) -> str`.

- [ ] **Step 1: Write the failing test**

Create `tests/chatbot/test_hermeneutics_grounding.py`:

```python
from chatbot import hermeneutics


async def test_passage_text_joins_the_range_with_verse_numbers():
    text = await hermeneutics.passage_text_for("GEN", 1, 1, 2)
    assert text.startswith("1 In the beginning")
    assert " 2 " in text


async def test_grounding_none_is_empty():
    assert await hermeneutics.build_grounding("none", "GEN", 1, 1, 1, "x") == ""


async def test_lexical_grounding_includes_strongs_and_rulings(monkeypatch):
    captured = {}

    async def fake_search_english(query):
        captured.setdefault("queries", []).append(query)
        return {"results": [{"ref": "Numbers 33:55", "text": "thorns in your sides"}]}

    monkeypatch.setattr(hermeneutics, "search_english", fake_search_english)
    text = await hermeneutics.build_grounding(
        "lexical", "GEN", 1, 1, 1, "a thorn in the flesh was given"
    )
    assert "H430" in text                      # Strong's from the interlinear
    assert "adversaries" in text.lower()       # the triggered ruling
    assert "NOT" in text


async def test_lexical_grounding_omits_rulings_that_do_not_trigger(monkeypatch):
    async def fake_search_english(query):
        return {"results": []}

    monkeypatch.setattr(hermeneutics, "search_english", fake_search_english)
    text = await hermeneutics.build_grounding("lexical", "GEN", 1, 1, 1, "In the beginning")
    assert "thorn" not in text.lower()


async def test_roots_grounding_names_divine_titles_by_strongs_number():
    text = await hermeneutics.build_grounding("roots", "GEN", 1, 1, 1, "In the beginning")
    assert "Elohim" in text
    assert "H430" in text


async def test_roots_grounding_omits_titles_absent_from_the_passage():
    # Romans has no H430/H3068 — the title note must not be fabricated.
    text = await hermeneutics.build_grounding("roots", "ROM", 8, 1, 1, "There is therefore now")
    assert "Elohim" not in text


async def test_book_context_grounding_survives_a_book_with_no_context(monkeypatch):
    monkeypatch.setattr(hermeneutics, "get_book_context", lambda usfm: None)
    text = await hermeneutics.build_grounding("book_context", "GEN", 1, 1, 1, "x")
    assert isinstance(text, str)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_grounding.py -v`
Expected: FAIL — `AttributeError: module 'chatbot.hermeneutics' has no attribute 'passage_text_for'`

- [ ] **Step 3: Write the implementation**

Add to `chatbot/hermeneutics.py` (imports at the top, functions below `resolve_passage`):

```python
from chatbot.book_context import get_book_context
from chatbot.data.hermeneutic_rulings import render_rulings, rulings_for
from chatbot.tools import fetch_interlinear, fetch_strongs_local, search_english

# Divine titles are detected by Strong's number rather than by asking the
# model to spot them in transliteration.
_DIVINE_TITLES = {
    "H430": ("Elohim", "God as Creator, Judge and Power — known to the world at large"),
    "H3068": ("Yahweh", "the covenant-keeping LORD of unmerited grace and personal redemption"),
}

_SECTION_LABELS = {
    "literary_context": "Literary Context",
    "historical_setting": "Historical Setting",
    "author_and_audience": "Author and Audience",
    "immediate_purpose": "Immediate Purpose",
}


async def passage_text_for(usfm: str, chapter: int, start: int, end: int) -> str:
    """The passage's KJV text, verse-numbered, straight from Complete.db."""
    book_name = _USFM_TO_BOOK.get(usfm.upper(), usfm)
    verses = list_passage_verses_sync(book_name, chapter, start, end)
    return " ".join(f"{v['vnum']} {v['kjv']}" for v in verses if v.get("kjv"))


async def _interlinear_for_range(
    usfm: str, chapter: int, start: int, end: int
) -> List[Dict[str, Any]]:
    rows = []
    for verse in range(start, end + 1):
        row = await fetch_interlinear(usfm, chapter, verse)
        if row:
            rows.append(row)
    return rows


def _key_phrases(passage_text: str) -> List[str]:
    """Up to three multi-word phrases worth cross-referencing. Deliberately
    crude: the phrases only seed english_search, and the model judges what
    comes back."""
    cleaned = re.sub(r"\d+", " ", passage_text)
    phrases = re.findall(r"\b(?:[a-z]{4,}\s+){1,2}[a-z]{4,}\b", cleaned.lower())
    return list(dict.fromkeys(phrases))[:3]


async def build_grounding(
    kind: str, usfm: str, chapter: int, start: int, end: int, passage_text: str
) -> str:
    if kind == "none":
        return ""

    if kind == "book_context":
        ctx = get_book_context(usfm.upper())
        if not ctx:
            return ""
        parts = []
        for key, label in _SECTION_LABELS.items():
            value = ctx.get("sections", {}).get(key)
            if value:
                parts.append(f"{label}: {value}")
        return "\n".join(parts)

    if kind == "lexical":
        rows = await _interlinear_for_range(usfm, chapter, start, end)
        numbers = [w["strongs"] for row in rows for w in row["words"]]
        entries = await fetch_strongs_local(numbers)
        lines = ["STRONG'S DATA FOR THIS PASSAGE:"]
        for number, entry in entries.items():
            lines.append(
                f"- {number} {entry.get('transliteration1', '')} "
                f"({entry.get('root', '')}): {entry.get('meaning', '')}"
            )
        for phrase in _key_phrases(passage_text):
            found = await search_english(phrase)
            refs = [r["ref"] for r in found.get("results", [])[:6]]
            if refs:
                lines.append(f"OTHER OCCURRENCES of {phrase!r}: {', '.join(refs)}")
        rulings = render_rulings(rulings_for(passage_text))
        if rulings:
            lines.append("")
            lines.append(rulings)
        return "\n".join(lines)

    if kind == "roots":
        rows = await _interlinear_for_range(usfm, chapter, start, end)
        lines = ["ROOT MEANINGS IN THIS PASSAGE:"]
        seen = set()
        for row in rows:
            for root in row["roots"]:
                key = root["strongs"]
                if key in seen:
                    continue
                seen.add(key)
                lines.append(
                    f"- {key} {root['translit']} ({root['root']}) = {root['english']}"
                )
        titles = [
            f"- {name} ({number}): {gloss}"
            for number, (name, gloss) in _DIVINE_TITLES.items()
            if number in seen
        ]
        if titles:
            lines.append("")
            lines.append("DIVINE TITLES PRESENT IN THIS PASSAGE:")
            lines.extend(titles)
        return "\n".join(lines)

    # "witnesses" needs the model's proposals first, so Phase 4's grounding
    # is the verification pass in verify_witnesses() rather than a prompt
    # block built up front.
    return ""
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_grounding.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/hermeneutics.py tests/chatbot/test_hermeneutics_grounding.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): per-phase grounding builders for phases 1, 2 and 7

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Witness verification and verdict parsing

**Files:**
- Modify: `chatbot/hermeneutics.py`
- Test: `tests/chatbot/test_hermeneutics_verification.py`

**Interfaces:**
- Consumes: `_resolve_verse_reference`, `fetch_verse_translations` (`chatbot/tools.py`).
- Produces:
  - `async verify_witnesses(phase_text: str) -> Tuple[List[Dict[str, Any]], int]` → `(citations, dropped_count)` where a citation is `{"reference": str, "text": str, "verified": bool}`.
  - `parse_verdicts(phase_text: str) -> List[Dict[str, Any]]` → `[{"test": "heart"|"cross"|"grace", "passed": bool, "reason": str}]`.
  - `parse_marker(phase_text: str, marker: str) -> Optional[str]` for `AUDIENCE:` / `SPEAKER:`.

- [ ] **Step 1: Write the failing test**

Create `tests/chatbot/test_hermeneutics_verification.py`:

```python
from chatbot import hermeneutics


async def _fake_fetch(reference, languages=None):
    known = {
        "1CO 15:51-52": "Behold, I shew you a mystery...",
        "JHN 14:2-3": "In my Father's house are many mansions...",
    }
    if reference not in known:
        raise ValueError("no such verse")
    return {"eng-KJV": known[reference]}


async def test_verify_witnesses_keeps_resolvable_references_with_text(monkeypatch):
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", _fake_fetch)
    citations, dropped = await hermeneutics.verify_witnesses(
        "Reasoning here.\nWITNESSES: 1CO 15:51-52, JHN 14:2-3"
    )
    assert [c["reference"] for c in citations] == ["1CO 15:51-52", "JHN 14:2-3"]
    assert all(c["verified"] for c in citations)
    assert "mystery" in citations[0]["text"]
    assert dropped == 0


async def test_verify_witnesses_drops_unresolvable_references(monkeypatch):
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", _fake_fetch)
    citations, dropped = await hermeneutics.verify_witnesses(
        "WITNESSES: 1CO 15:51-52, HEB 4:19"
    )
    assert [c["reference"] for c in citations] == ["1CO 15:51-52"]
    assert dropped == 1


async def test_verify_witnesses_with_no_marker_returns_nothing(monkeypatch):
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", _fake_fetch)
    assert await hermeneutics.verify_witnesses("No marker line here.") == ([], 0)


async def test_verify_witnesses_accepts_full_book_names(monkeypatch):
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", _fake_fetch)
    citations, _ = await hermeneutics.verify_witnesses(
        "WITNESSES: 1 Corinthians 15:51-52"
    )
    assert citations[0]["reference"] == "1CO 15:51-52"


def test_parse_verdicts_reads_all_three_tests():
    verdicts = hermeneutics.parse_verdicts(
        "Some prose.\n"
        "VERDICT: heart=pass — it produces gratitude\n"
        "VERDICT: cross=fail — it reintroduces sin-consciousness\n"
        "VERDICT: grace=pass — sins are not counted"
    )
    assert [v["test"] for v in verdicts] == ["heart", "cross", "grace"]
    assert [v["passed"] for v in verdicts] == [True, False, True]
    assert "sin-consciousness" in verdicts[1]["reason"]


def test_parse_verdicts_of_prose_without_markers_is_empty():
    assert hermeneutics.parse_verdicts("All three tests passed.") == []


def test_parse_marker_reads_audience():
    assert hermeneutics.parse_marker("prose\nAUDIENCE: church", "AUDIENCE") == "church"


def test_parse_marker_missing_returns_none():
    assert hermeneutics.parse_marker("prose only", "AUDIENCE") is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_verification.py -v`
Expected: FAIL — `AttributeError: module 'chatbot.hermeneutics' has no attribute 'verify_witnesses'`

- [ ] **Step 3: Write the implementation**

Add to `chatbot/hermeneutics.py` (import `fetch_verse_translations` from `chatbot.tools` at the top):

```python
_WITNESS_LINE_RE = re.compile(r"^WITNESSES:\s*(.+)$", re.MULTILINE | re.IGNORECASE)
_VERDICT_LINE_RE = re.compile(
    r"^VERDICT:\s*(heart|cross|grace)\s*=\s*(pass|fail)\s*[—\-:]?\s*(.*)$",
    re.MULTILINE | re.IGNORECASE,
)


def parse_marker(phase_text: str, marker: str) -> Optional[str]:
    """The value of a `MARKER: value` line, lowercased, or None."""
    match = re.search(rf"^{marker}:\s*(.+)$", phase_text, re.MULTILINE | re.IGNORECASE)
    return match.group(1).strip().lower() if match else None


def parse_verdicts(phase_text: str) -> List[Dict[str, Any]]:
    """Phase 8's three verdicts. Prose without markers yields [] — the
    report then shows no badges rather than inventing passes."""
    return [
        {
            "test": test.lower(),
            "passed": outcome.lower() == "pass",
            "reason": reason.strip(),
        }
        for test, outcome, reason in _VERDICT_LINE_RE.findall(phase_text)
    ]


async def verify_witnesses(phase_text: str) -> Tuple[List[Dict[str, Any]], int]:
    """Resolve and fetch each reference Phase 4 proposed.

    Returns (verified citations, count dropped). A reference that doesn't
    resolve, or whose text can't be fetched, is dropped — the model must
    not be able to cite a verse that isn't there.
    """
    match = _WITNESS_LINE_RE.search(phase_text)
    if not match:
        return [], 0

    citations: List[Dict[str, Any]] = []
    dropped = 0
    for raw in match.group(1).split(","):
        candidate = raw.strip()
        if not candidate:
            continue
        resolved = _resolve_verse_reference(candidate)
        if not resolved:
            dropped += 1
            continue
        try:
            translations = await fetch_verse_translations(resolved, languages=["eng"])
        except Exception:
            translations = None
        text = (translations or {}).get("eng-KJV") or next(
            iter((translations or {}).values()), None
        )
        if not text:
            dropped += 1
            continue
        citations.append({"reference": resolved, "text": text, "verified": True})
    return citations, dropped
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_verification.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/hermeneutics.py tests/chatbot/test_hermeneutics_verification.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): verify Phase 4 witnesses and parse Phase 8 verdicts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The run() pipeline

**Files:**
- Modify: `chatbot/hermeneutics.py`
- Test: `tests/chatbot/test_hermeneutics_run.py`

**Interfaces:**
- Consumes: everything from Tasks 4–7; `simple_completion`, `llm_unconfigured_error` (`chatbot/ollama_client.py`).
- Produces: `async run(reference, message, history) -> AsyncIterator[Dict[str, Any]]`, yielding `{"kind": "phase", "phase": {...}}` per phase and finally `{"kind": "final", "result": {...ChatResponse-shaped...}}`. A phase dict is `{"index", "title", "status", "markdown", "citations"?, "verdicts"?, "audience"?, "speaker"?}`. **Index 0 is reserved** for the echo-back notice emitted when the passage came from a description; it is not a phase, never enters the report or the digest, and the frontend renders it as a plain line.
- Produces: `build_digest(phases: List[Dict[str, Any]], summary: str) -> str`.

- [ ] **Step 1: Write the failing test**

Create `tests/chatbot/test_hermeneutics_run.py`:

```python
import pytest

from chatbot import hermeneutics


@pytest.fixture
def fake_llm(monkeypatch):
    """Answers every phase with a marker-bearing stub, so marker parsing is
    exercised without a live provider."""
    calls = []

    async def fake_simple_completion(system_prompt, user_prompt, *, max_tokens=2048):
        calls.append({"system": system_prompt, "user": user_prompt})
        if "PHASE 1" in system_prompt:
            return "Context findings.\nAUDIENCE: church"
        if "PHASE 3" in system_prompt:
            return "Paul speaks by revelation.\nSPEAKER: prophet"
        if "PHASE 4" in system_prompt:
            return "Confirmed.\nWITNESSES: 1CO 15:51-52, JHN 14:2-3"
        if "PHASE 8" in system_prompt:
            return (
                "Checked.\n"
                "VERDICT: heart=pass — it comforts\n"
                "VERDICT: cross=pass — it rests on the finished work\n"
                "VERDICT: grace=pass — sins are not counted"
            )
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "This passage promises the resurrection and rapture of every believer."
        return "Phase findings."

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"text of {reference}"}

    monkeypatch.setattr(hermeneutics, "simple_completion", fake_simple_completion)
    monkeypatch.setattr(hermeneutics, "fetch_verse_translations", fake_fetch)
    monkeypatch.setattr(hermeneutics, "llm_unconfigured_error", lambda: None)
    monkeypatch.setattr(hermeneutics, "search_english", lambda q: _empty_search())
    return calls


async def _empty_search():
    return {"results": []}


async def _collect(reference, message="run it", history=None):
    return [event async for event in hermeneutics.run(reference, message, history)]


async def test_run_emits_eight_phases_in_order_then_a_final(fake_llm):
    events = await _collect("1TH 4:15-18")
    phases = [e["phase"] for e in events if e["kind"] == "phase"]
    assert [p["index"] for p in phases] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert events[-1]["kind"] == "final"


async def test_run_final_carries_the_synthesis_and_an_artifact(fake_llm):
    events = await _collect("1TH 4:15-18")
    result = events[-1]["result"]
    assert "resurrection and rapture" in result["message"]
    artifact = result["artifacts"][0]
    assert artifact["type"] == "hermeneutics_report"
    assert artifact["params"]["reference"] == "1TH 4:15-18"
    assert len(artifact["params"]["phases"]) == 8


async def test_a_described_passage_is_echoed_back_before_any_phase(monkeypatch, fake_llm):
    async def from_table(text):
        return "MAT 25:1-13"

    monkeypatch.setattr(hermeneutics, "resolve_description", from_table)
    events = await _collect(None, message="run the parable of the ten virgins")
    first = events[0]["phase"]
    assert first["index"] == 0
    assert "MAT 25:1-13" in first["markdown"]
    assert events[1]["phase"]["index"] == 1, "the notice precedes phase 1"


async def test_the_echo_notice_is_not_part_of_the_report(monkeypatch, fake_llm):
    async def from_table(text):
        return "MAT 25:1-13"

    monkeypatch.setattr(hermeneutics, "resolve_description", from_table)
    events = await _collect(None, message="run the parable of the ten virgins")
    report_phases = events[-1]["result"]["artifacts"][0]["params"]["phases"]
    assert [p["index"] for p in report_phases] == [1, 2, 3, 4, 5, 6, 7, 8]


async def test_an_explicit_reference_is_not_echoed_back(fake_llm):
    events = await _collect("1TH 4:15-18")
    assert events[0]["phase"]["index"] == 1, "no notice for a reference the user typed"


async def test_run_carries_audience_and_speaker_forward(fake_llm):
    events = await _collect("1TH 4:15-18")
    phases = {e["phase"]["index"]: e["phase"] for e in events if e["kind"] == "phase"}
    assert phases[1]["audience"] == "church"
    assert phases[3]["speaker"] == "prophet"


async def test_a_phase_without_its_marker_carries_none(monkeypatch, fake_llm):
    async def unmarked(system_prompt, user_prompt, *, max_tokens=2048):
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Prose with no marker line."

    monkeypatch.setattr(hermeneutics, "simple_completion", unmarked)
    events = await _collect("1TH 4:15-18")
    phase1 = next(e["phase"] for e in events if e["kind"] == "phase" and e["phase"]["index"] == 1)
    assert phase1["audience"] is None
    assert phase1["status"] == "done", "a missing marker degrades to prose, it does not fail"


async def test_run_attaches_verified_citations_to_phase_four(fake_llm):
    events = await _collect("1TH 4:15-18")
    phase4 = next(e["phase"] for e in events if e["kind"] == "phase" and e["phase"]["index"] == 4)
    assert [c["reference"] for c in phase4["citations"]] == ["1CO 15:51-52", "JHN 14:2-3"]


async def test_run_notes_when_fewer_than_two_witnesses_verify(monkeypatch, fake_llm):
    async def one_witness(system_prompt, user_prompt, *, max_tokens=2048):
        if "PHASE 4" in system_prompt:
            return "Only one.\nWITNESSES: 1CO 15:51-52"
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Phase findings."

    monkeypatch.setattr(hermeneutics, "simple_completion", one_witness)
    events = await _collect("1TH 4:15-18")
    phase4 = next(e["phase"] for e in events if e["kind"] == "phase" and e["phase"]["index"] == 4)
    assert "fewer than two" in phase4["markdown"].lower()


async def test_run_attaches_verdicts_to_phase_eight(fake_llm):
    events = await _collect("1TH 4:15-18")
    phase8 = next(e["phase"] for e in events if e["kind"] == "phase" and e["phase"]["index"] == 8)
    assert [v["test"] for v in phase8["verdicts"]] == ["heart", "cross", "grace"]


async def test_a_failed_verdict_is_disclosed_and_never_retried(monkeypatch, fake_llm):
    async def failing(system_prompt, user_prompt, *, max_tokens=2048):
        if "PHASE 8" in system_prompt:
            return (
                "VERDICT: heart=pass — fine\n"
                "VERDICT: cross=fail — reintroduces sin-consciousness\n"
                "VERDICT: grace=pass — fine"
            )
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Phase findings."

    monkeypatch.setattr(hermeneutics, "simple_completion", failing)
    events = await _collect("1TH 4:15-18")
    phase8s = [e for e in events if e["kind"] == "phase" and e["phase"]["index"] == 8]
    assert len(phase8s) == 1, "Phase 8 must run exactly once — no retry on failure"
    assert events[-1]["kind"] == "final", "a failed test must not suppress the report"
    assert events[-1]["result"]["data"]["hasFailedVerdict"] is True


async def test_an_erroring_phase_does_not_abort_the_run(monkeypatch, fake_llm):
    async def phase7_explodes(system_prompt, user_prompt, *, max_tokens=2048):
        if "PHASE 7" in system_prompt:
            raise RuntimeError("provider timeout")
        if "FINAL VERIFIED INTERPRETATION" in system_prompt:
            return "Summary."
        return "Phase findings."

    monkeypatch.setattr(hermeneutics, "simple_completion", phase7_explodes)
    events = await _collect("1TH 4:15-18")
    phases = {e["phase"]["index"]: e["phase"] for e in events if e["kind"] == "phase"}
    assert phases[7]["status"] == "error"
    assert phases[8]["status"] == "done", "phase 8 must still run after phase 7 failed"
    assert events[-1]["kind"] == "final"


async def test_run_refuses_a_chapter_with_a_narrowing_reply(fake_llm):
    events = await _collect("GEN 1")
    assert len(events) == 1
    assert events[0]["kind"] == "final"
    assert "which part" in events[0]["result"]["message"].lower()


async def test_run_fails_fast_when_the_llm_is_unconfigured(monkeypatch, fake_llm):
    monkeypatch.setattr(hermeneutics, "llm_unconfigured_error", lambda: "no key")
    events = await _collect("1TH 4:15-18")
    assert len(events) == 1
    assert events[0]["result"]["type"] == "error"


async def test_run_asks_for_a_passage_when_none_is_known(fake_llm):
    events = await _collect(None, message="hello", history=[])
    assert len(events) == 1
    assert "passage" in events[0]["result"]["message"].lower()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_run.py -v`
Expected: FAIL — `AttributeError: module 'chatbot.hermeneutics' has no attribute 'run'`

- [ ] **Step 3: Write the implementation**

Add to `chatbot/hermeneutics.py` (import `simple_completion`, `llm_unconfigured_error` from `chatbot.ollama_client` and `PHASES`, `SYNTHESIS_PROMPT` from `chatbot.hermeneutics_phases` at the top):

```python
from typing import AsyncIterator

MIN_WITNESSES = 2


def _final(result: Dict[str, Any]) -> Dict[str, Any]:
    return {"kind": "final", "result": result}


def build_digest(phases: List[Dict[str, Any]], summary: str) -> str:
    """The compact carry-forward a post-report turn answers from, instead
    of re-running the pipeline."""
    lines = [f"{p['index']}. {p['title']}: {p['markdown'][:400]}" for p in phases]
    lines.append(f"Final verified interpretation: {summary}")
    return "\n".join(lines)


async def run(
    reference: Optional[str],
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Run the eight phases, yielding each as it completes, then the final
    assembled report."""
    llm_error = llm_unconfigured_error()
    if llm_error:
        yield _final({
            "type": "error", "message": llm_error, "data": None,
            "route": "hermeneutics → LLM unconfigured",
        })
        return

    resolved, was_described = await resolve_passage(message, reference, history)
    if not resolved:
        yield _final({
            "type": "chat",
            "message": "Which passage would you like me to run? Give me a verse or a "
                       "short range — for example \"Romans 8:1\" or "
                       "\"1 Thessalonians 4:15-18\".",
            "data": None,
            "route": "hermeneutics → no passage",
        })
        return

    try:
        usfm, chapter, start, end = parse_scope(resolved)
    except ScopeError as exc:
        yield _final({
            "type": "chat", "message": exc.message, "data": {"reference": resolved},
            "route": "hermeneutics → out of scope",
        })
        return

    # A passage the user described rather than cited is echoed back before
    # any phase runs, so a wrong reading is visible immediately instead of
    # ninety seconds later with the report. Index 0 keeps this on the
    # existing `phase` event rather than inventing a second event type; the
    # frontend renders index 0 as a plain notice, not a collapsible phase.
    if was_described:
        yield {"kind": "phase", "phase": {
            "index": 0,
            "title": "Passage",
            "status": "done",
            "markdown": f"Reading that as **{resolved}** — running it now.",
        }}

    passage_text = await passage_text_for(usfm, chapter, start, end)
    completed: List[Dict[str, Any]] = []

    for spec in PHASES:
        phase: Dict[str, Any] = {
            "index": spec.index, "title": spec.title, "status": "done", "markdown": "",
        }
        try:
            grounding = await build_grounding(
                spec.grounding, usfm, chapter, start, end, passage_text
            )
            prior = "\n\n".join(
                f"PHASE {p['index']} ({p['title']}):\n{p['markdown']}" for p in completed
            )
            user_prompt = (
                f"PASSAGE: {resolved}\n\nTEXT (KJV): {passage_text}\n\n"
                + (f"{grounding}\n\n" if grounding else "")
                + (f"FINDINGS SO FAR:\n{prior}\n\n" if prior else "")
                + "Carry out your phase now."
            )
            phase["markdown"] = await simple_completion(
                spec.system_prompt, user_prompt, max_tokens=spec.max_tokens
            )
            if spec.index == 1:
                phase["audience"] = parse_marker(phase["markdown"], "AUDIENCE")
            if spec.index == 3:
                phase["speaker"] = parse_marker(phase["markdown"], "SPEAKER")
            if spec.index == 4:
                citations, dropped = await verify_witnesses(phase["markdown"])
                phase["citations"] = citations
                if len(citations) < MIN_WITNESSES:
                    phase["markdown"] += (
                        f"\n\n_Note: fewer than {MIN_WITNESSES} proposed witnesses could be "
                        f"verified against the text ({dropped} dropped as unresolvable). "
                        "Weigh this interpretation accordingly._"
                    )
                elif dropped:
                    phase["markdown"] += (
                        f"\n\n_{dropped} proposed reference(s) did not resolve and were dropped._"
                    )
            if spec.index == 8:
                phase["verdicts"] = parse_verdicts(phase["markdown"])
        except Exception as exc:  # a slow provider must not discard the run
            phase["status"] = "error"
            phase["markdown"] = f"This phase could not be completed: {type(exc).__name__}: {exc}"

        completed.append(phase)
        yield {"kind": "phase", "phase": phase}

    missing = [p["index"] for p in completed if p["status"] == "error"]
    findings = "\n\n".join(
        f"PHASE {p['index']} ({p['title']}):\n{p['markdown']}"
        for p in completed if p["status"] == "done"
    )
    try:
        summary = await simple_completion(
            SYNTHESIS_PROMPT,
            f"PASSAGE: {resolved}\n\nTEXT (KJV): {passage_text}\n\nPHASE FINDINGS:\n{findings}",
            max_tokens=900,
        )
    except Exception as exc:
        summary = f"The summary could not be generated: {type(exc).__name__}: {exc}"
    if missing:
        summary += (
            "\n\n_Phases "
            + ", ".join(str(i) for i in missing)
            + " could not be completed, so this summary rests on the remainder._"
        )

    verdicts = next((p.get("verdicts") for p in completed if p["index"] == 8), None) or []
    has_failed = any(not v["passed"] for v in verdicts)

    yield _final({
        "type": "chat",
        "message": summary,
        "data": {
            "reference": resolved,
            "hasFailedVerdict": has_failed,
            "runDigest": build_digest(completed, summary),
        },
        "route": f"hermeneutics → {len(completed)} phases",
        "artifacts": [{
            "type": "hermeneutics_report",
            "label": "Open full report ▸",
            "params": {"reference": resolved, "phases": completed, "summary": summary},
        }],
        "follow_up_questions": [
            "Which phase is doing the most work here?",
            "What would change if this were addressed to the Church instead?",
        ],
    })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_run.py -v`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add chatbot/hermeneutics.py tests/chatbot/test_hermeneutics_run.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): the eight-phase run pipeline

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Post-report follow-up turns

**Files:**
- Modify: `chatbot/hermeneutics.py`
- Test: `tests/chatbot/test_hermeneutics_followup.py`

**Interfaces:**
- Consumes: `call_ollama_with_context`, `generate_llm_follow_ups` (`chatbot/ollama_client.py`); `run` (Task 8).
- Produces: `async answer(reference, message, history, run_digest=None) -> Dict[str, Any]` — the buffered entry point — and `async stream(reference, message, history, run_digest=None) -> AsyncIterator[Dict[str, Any]]` — the streaming one. Both re-run only when there is no digest, or when the message names a *new* passage (by reference **or** by curated parable name — the LLM fallback is not used on a follow-up turn).

- [ ] **Step 1: Write the failing test**

Create `tests/chatbot/test_hermeneutics_followup.py`:

```python
import pytest

from chatbot import hermeneutics

DIGEST = "1. Context: addressed to the Church\nFinal verified interpretation: the rapture."


@pytest.fixture
def no_rerun(monkeypatch):
    """Fails the test loudly if the pipeline runs when it shouldn't."""
    async def exploding_run(*args, **kwargs):
        raise AssertionError("the pipeline must not re-run on a follow-up turn")
        yield  # pragma: no cover — makes this an async generator

    monkeypatch.setattr(hermeneutics, "run", exploding_run)


@pytest.fixture
def fake_chat(monkeypatch):
    captured = {}

    async def fake_call(message, research_data, conversation_history=None,
                        page_context=None, system_prompt=None):
        captured["research_data"] = research_data
        return {"type": "chat", "message": "Because Paul writes to the Church.", "data": None}

    async def no_follow_ups(user_message, assistant_message, page_context=None):
        return []

    monkeypatch.setattr(hermeneutics, "call_ollama_with_context", fake_call)
    monkeypatch.setattr(hermeneutics, "generate_llm_follow_ups", no_follow_ups)
    return captured


async def test_followup_answers_from_the_digest_without_rerunning(no_rerun, fake_chat):
    result = await hermeneutics.answer(
        "1TH 4:15-18", "why does the audience matter?", history=None, run_digest=DIGEST
    )
    assert result["type"] == "chat"
    assert "rapture" in fake_chat["research_data"]


async def test_followup_route_names_the_digest_path(no_rerun, fake_chat):
    result = await hermeneutics.answer(
        "1TH 4:15-18", "say more", history=None, run_digest=DIGEST
    )
    assert "digest" in result["route"]


async def test_a_new_passage_starts_a_fresh_run(monkeypatch, fake_chat):
    ran = {}

    async def fake_run(reference, message, history=None):
        ran["reference"] = reference
        yield {"kind": "final", "result": {"type": "chat", "message": "ran", "data": None}}

    monkeypatch.setattr(hermeneutics, "run", fake_run)
    result = await hermeneutics.answer(
        "1TH 4:15-18", "now run Romans 8:1", history=None, run_digest=DIGEST
    )
    assert result["message"] == "ran"


async def test_a_newly_named_parable_starts_a_fresh_run(monkeypatch, fake_chat):
    ran = {}

    async def fake_run(reference, message, history=None):
        ran["called"] = True
        yield {"kind": "final", "result": {"type": "chat", "message": "ran", "data": None}}

    monkeypatch.setattr(hermeneutics, "run", fake_run)
    result = await hermeneutics.answer(
        "1TH 4:15-18", "now do the prodigal son", history=None, run_digest=DIGEST
    )
    assert ran.get("called"), "a parable named by description is a new passage"
    assert result["message"] == "ran"


async def test_a_vague_question_stays_on_the_digest(no_rerun, fake_chat):
    # Only the table is consulted here, never the LLM fallback — a vague
    # follow-up is a question about the passage in hand.
    result = await hermeneutics.answer(
        "1TH 4:15-18", "what about the bit with the trumpet?", history=None, run_digest=DIGEST
    )
    assert result["type"] == "chat"


async def test_no_digest_means_run_the_pipeline(monkeypatch, fake_chat):
    async def fake_run(reference, message, history=None):
        yield {"kind": "final", "result": {"type": "chat", "message": "ran", "data": None}}

    monkeypatch.setattr(hermeneutics, "run", fake_run)
    result = await hermeneutics.answer("1TH 4:15-18", "go", history=None, run_digest=None)
    assert result["message"] == "ran"


async def test_answer_returns_the_last_final_event(monkeypatch, fake_chat):
    async def fake_run(reference, message, history=None):
        yield {"kind": "phase", "phase": {"index": 1, "title": "t", "status": "done", "markdown": ""}}
        yield {"kind": "final", "result": {"type": "chat", "message": "done", "data": None}}

    monkeypatch.setattr(hermeneutics, "run", fake_run)
    result = await hermeneutics.answer("ROM 8:1", "go", history=None)
    assert result["message"] == "done"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_followup.py -v`
Expected: FAIL — `AttributeError: module 'chatbot.hermeneutics' has no attribute 'answer'`

- [ ] **Step 3: Write the implementation**

Add to `chatbot/hermeneutics.py` (import `call_ollama_with_context`, `generate_llm_follow_ups` from `chatbot.ollama_client` at the top):

```python
FOLLOW_UP_SYSTEM_PROMPT = """You are a Biblical Hermeneutics Engine answering a follow-up question about a passage you have already analysed through an eight-phase methodology. The findings of that analysis are given below.

Answer from those findings. Be concise — a short paragraph. Do not re-run the phases, do not re-list them, and do not introduce a verse reference the analysis did not establish."""


def _is_new_passage(message: str, current: Optional[str]) -> bool:
    """True when this follow-up turn actually names a different passage.

    Consults the parable table as well as the reference regex, so "now do
    the prodigal son" starts a fresh run instead of being answered from the
    previous passage's digest. The LLM fallback is deliberately NOT used
    here — it would cost a completion on every follow-up turn, and a
    description vague enough to need it is more likely a question about the
    passage in hand than a request for a new one.
    """
    named = _detect_reference(message) or find_parable_reference(message)
    return bool(named) and named != current


async def stream(
    reference: Optional[str],
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    run_digest: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Phase events + final for a fresh run; a single final for a
    follow-up answered from the digest."""
    if run_digest and not _is_new_passage(message, reference):
        result = await call_ollama_with_context(
            message,
            research_data=f"PASSAGE: {reference}\n\nANALYSIS FINDINGS:\n{run_digest}",
            conversation_history=history,
            system_prompt=FOLLOW_UP_SYSTEM_PROMPT,
        )
        result["route"] = "hermeneutics → follow-up from digest"
        result.setdefault("data", {"reference": reference})
        if result.get("type") == "chat" and result.get("message"):
            follow_ups = await generate_llm_follow_ups(message, result["message"])
            if follow_ups:
                result["follow_up_questions"] = follow_ups
        yield _final(result)
        return

    async for event in run(reference, message, history):
        yield event


async def answer(
    reference: Optional[str],
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    run_digest: Optional[str] = None,
) -> Dict[str, Any]:
    """Buffered entry point: drives the same pipeline and returns only the
    final result, so POST /chat behaves identically to /chat/stream."""
    result: Dict[str, Any] = {}
    async for event in stream(reference, message, history, run_digest):
        if event["kind"] == "final":
            result = event["result"]
    return result
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_hermeneutics_followup.py tests/chatbot/test_hermeneutics_run.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add chatbot/hermeneutics.py tests/chatbot/test_hermeneutics_followup.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): answer follow-up turns from the run digest

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Mode primer

**Files:**
- Modify: `chatbot/router.py` (add a branch in `build_mode_primer`, immediately before the `if mode == "devotional":` branch at ~line 1220)
- Modify: `chatbot/schemas.py:23` (mode description)
- Test: `tests/chatbot/test_mode_primers.py` (append)

**Interfaces:**
- Consumes: `random_verse`, `_format_reference`, `_resolve_verse_reference`, `fetch_verse_translations`, `get_book_context`, `_reading_artifacts` (all already used by the `socratic` primer directly above).
- Produces: a primer response for `mode == "hermeneutics"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/chatbot/test_mode_primers.py` (match the file's existing call style — read it first):

```python
async def test_hermeneutics_primer_with_no_reference_asks_for_a_passage():
    result = await build_mode_primer("hermeneutics", {})
    assert "passage" in result["message"].lower()
    assert result["route"].endswith("hermeneutics")


async def test_hermeneutics_primer_with_a_reference_names_the_passage():
    result = await build_mode_primer("hermeneutics", {"reference": "Romans 8:1"})
    assert "ROM 8:1" in result["message"] or "Romans 8:1" in result["message"]
    assert result["data"]["reference"] == "ROM 8:1"


async def test_hermeneutics_primer_surprise_me_picks_a_passage():
    result = await build_mode_primer("hermeneutics", {"surprise": True})
    assert result["data"]["reference"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/chatbot/test_mode_primers.py -v -k hermeneutics`
Expected: FAIL — the freeform fallback's "Ask me anything about the Bible." is returned instead.

- [ ] **Step 3: Write the implementation**

In `chatbot/router.py`, insert before `if mode == "devotional":`:

```python
    if mode == "hermeneutics":
        reference = mode_params.get("reference")
        if not reference and mode_params.get("surprise"):
            book, chapter, verse = await random_verse()
            reference = _format_reference("", book, str(chapter), str(verse))
        if not reference:
            return {
                "type": "chat",
                "message": (
                    "Which passage would you like me to run through the eight phases? "
                    "Give me a verse or a short range — for example **Romans 8:1** or "
                    "**1 Thessalonians 4:15-18**."
                ),
                "data": None,
                "route": "Mode primer → hermeneutics",
                "follow_up_questions": [],
            }

        ref = _resolve_verse_reference(reference) or reference
        is_range = ":" in ref and "-" in ref.split(":", 1)[1]
        translations = None
        if not is_range:
            try:
                translations = await fetch_verse_translations(ref, languages=["eng"])
            except Exception:
                translations = None

        message = (
            f"**{ref}** — I'll take this through all eight phases: context and audience, "
            "semantics, record versus truth, witnesses, priority, covenant, typology, and "
            "the validation tests. Say **go** when you're ready."
        )
        data = (
            {"reference": ref, "translations": translations,
             "book_context": get_book_context(ref.split(" ")[0].upper())}
            if translations
            else {"reference": ref}
        )
        return {
            "type": "verse" if translations else "chat",
            "message": message,
            "data": data,
            "route": "Mode primer → hermeneutics",
            "artifacts": _reading_artifacts(ref),
            "follow_up_questions": ["go"],
        }
```

In `chatbot/schemas.py:23`, extend the description string to end `..., socratic, hermeneutics, freeform`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot/test_mode_primers.py tests/chatbot/test_schemas.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add chatbot/router.py chatbot/schemas.py tests/chatbot/test_mode_primers.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): mode primer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: API dispatch and the `phase` SSE event

**Files:**
- Modify: `chatbot/api.py` — buffered branch beside the `socratic` one at ~:260; streaming branch beside the one at ~:420
- Test: `tests/chatbot/test_chat_endpoint_hermeneutics.py` (new), `tests/chatbot/test_chat_stream_hermeneutics.py` (new)

**Interfaces:**
- Consumes: `hermeneutics.answer`, `hermeneutics.stream` (Task 9); `sse_event` (`chatbot/streaming.py`).
- Produces: `phase` SSE events on `/chat/stream`, ahead of the single `final` and terminal `trace`.

- [ ] **Step 1: Write the failing tests**

Create `tests/chatbot/test_chat_endpoint_hermeneutics.py` — read `tests/chatbot/test_chat_endpoint_socratic_routing.py` first and mirror its structure and `client` fixture use:

```python
import json

from chatbot import api


def test_buffered_endpoint_dispatches_to_hermeneutics(client, monkeypatch):
    captured = {}

    async def fake_answer(reference, message, history=None, run_digest=None):
        captured.update(reference=reference, message=message, run_digest=run_digest)
        return {"type": "chat", "message": "report", "data": None, "route": "hermeneutics → x"}

    monkeypatch.setattr(api.hermeneutics, "answer", fake_answer)
    response = client.post("/chat", json={
        "message": "run it",
        "mode": "hermeneutics",
        "mode_params": {"reference": "ROM 8:1", "run_digest": "prior findings"},
    })
    assert response.status_code == 200
    assert response.json()["message"] == "report"
    assert captured["reference"] == "ROM 8:1"
    assert captured["run_digest"] == "prior findings"
```

Create `tests/chatbot/test_chat_stream_hermeneutics.py` — read `tests/chatbot/test_chat_stream_devotional.py` first and mirror how it reads the SSE body:

```python
import json

from chatbot import api


def _events(body: str):
    return [
        json.loads(frame[len("data: "):])
        for frame in body.strip().split("\n\n")
        if frame.startswith("data: ")
    ]


def test_stream_emits_phase_events_then_one_final_then_trace(client, monkeypatch):
    async def fake_stream(reference, message, history=None, run_digest=None):
        for i in (1, 2):
            yield {"kind": "phase", "phase": {
                "index": i, "title": f"Phase {i}", "status": "done", "markdown": "text",
            }}
        yield {"kind": "final", "result": {
            "type": "chat", "message": "report", "data": None, "route": "hermeneutics → 2 phases",
        }}

    monkeypatch.setattr(api.hermeneutics, "stream", fake_stream)
    response = client.post("/chat/stream", json={
        "message": "run it", "mode": "hermeneutics", "mode_params": {"reference": "ROM 8:1"},
    })
    events = _events(response.text)
    types = [e["type"] for e in events]
    assert types.count("final") == 1, "exactly one final event"
    assert types.index("final") > max(i for i, t in enumerate(types) if t == "phase")
    assert types[-1] == "trace"
    phases = [e for e in events if e["type"] == "phase"]
    assert [p["phase"]["index"] for p in phases] == [1, 2]


def test_stream_phase_event_carries_the_full_phase_payload(client, monkeypatch):
    async def fake_stream(reference, message, history=None, run_digest=None):
        yield {"kind": "phase", "phase": {
            "index": 4, "title": "Witnesses", "status": "done", "markdown": "m",
            "citations": [{"reference": "1CO 15:51-52", "text": "t", "verified": True}],
        }}
        yield {"kind": "final", "result": {
            "type": "chat", "message": "report", "data": None, "route": "r",
        }}

    monkeypatch.setattr(api.hermeneutics, "stream", fake_stream)
    response = client.post("/chat/stream", json={
        "message": "run it", "mode": "hermeneutics", "mode_params": {"reference": "ROM 8:1"},
    })
    phase = next(e for e in _events(response.text) if e["type"] == "phase")
    assert phase["phase"]["citations"][0]["reference"] == "1CO 15:51-52"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/chatbot/test_chat_endpoint_hermeneutics.py tests/chatbot/test_chat_stream_hermeneutics.py -v`
Expected: FAIL — `AttributeError: module 'chatbot.api' has no attribute 'hermeneutics'`

- [ ] **Step 3: Write the implementation**

In `chatbot/api.py`, extend the existing import at line 33 to `from chatbot import wiki_loader, wiki_qa, socratic, hermeneutics`.

In `post_chat`, immediately after the `if request.mode == "socratic":` block:

```python
        # Every turn in a Hermeneutics session needs the phase pipeline (or
        # its digest-backed follow-up path) — same special case Socratic
        # Study makes above.
        if request.mode == "hermeneutics":
            params = request.mode_params or {}
            result = await hermeneutics.answer(
                params.get("reference"), request.message, history,
                run_digest=params.get("run_digest"),
            )
            return _with_trace(result)
```

In `_stream_chat_response`, immediately after the streaming `socratic` block:

```python
        # Same special case, plus the additive `phase` event: each completed
        # phase is pushed as it lands, ahead of the single `final`.
        if request.mode == "hermeneutics":
            params = request.mode_params or {}
            async for event in hermeneutics.stream(
                params.get("reference"), request.message, history,
                run_digest=params.get("run_digest"),
            ):
                if event["kind"] == "phase":
                    yield await sse_event("phase", {"phase": event["phase"]})
                else:
                    _note_outcome(event["result"])
                    yield await sse_event("final", {"result": event["result"]})
            return
```

Confirm `sse_event` is already imported in `chatbot/api.py`; it is used by the surrounding branches.

In `chatbot/schemas.py`, add:

```python
class PhaseEvent(BaseModel):
    """One `phase` SSE event from a Hermeneutics run — additive to the
    existing stream/final/trace contract, ignored by clients that predate
    it."""
    index: int = Field(..., description="Phase number, 1-8")
    title: str = Field(..., description="Phase title")
    status: str = Field(..., description="running | done | error")
    markdown: str = Field(..., description="The phase's findings as markdown")
    citations: Optional[List[Dict[str, Any]]] = Field(
        None, description="Phase 4 only: verified witness references with their KJV text"
    )
    verdicts: Optional[List[Dict[str, Any]]] = Field(
        None, description="Phase 8 only: the three validation-test verdicts"
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/chatbot -v`
Expected: PASS — the whole backend suite, including the pre-existing stream-contract tests (`test_chat_stream_trace.py`, `test_chat_stream_devotional.py`), which must be unaffected.

- [ ] **Step 5: Commit**

```bash
git add chatbot/api.py chatbot/schemas.py tests/chatbot/test_chat_endpoint_hermeneutics.py tests/chatbot/test_chat_stream_hermeneutics.py
git commit -m "$(cat <<'EOF'
feat(hermeneutics): dispatch the mode and stream phase events

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Frontend types and the `onPhase` stream handler

**Files:**
- Modify: `frontend/src/types/session.ts`, `frontend/src/lib/chatApi.ts`
- Test: `frontend/src/lib/chatApi.test.ts` (append)

**Interfaces:**
- Produces: `PhaseResult`, `HermeneuticsArtifactParams`; `'hermeneutics'` in `SessionMode`; `'hermeneutics_report'` in `ArtifactLink['type']`; `SessionMessage.phases`; `ModeParams.runDigest`; `ChatStreamHandlers.onPhase`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/chatApi.test.ts` — follow the existing SSE-mocking helper in that file:

```ts
it('calls onPhase for each phase event and still resolves with the final result', async () => {
  mockSseResponse([
    'data: {"type":"phase","phase":{"index":1,"title":"Context","status":"done","markdown":"a"}}\n\n',
    'data: {"type":"phase","phase":{"index":2,"title":"Semantics","status":"done","markdown":"b"}}\n\n',
    'data: {"type":"final","result":{"type":"chat","message":"report"}}\n\n',
    'data: {"type":"trace","trace":{}}\n\n',
  ])
  const phases: PhaseResult[] = []
  const result = await postChatStream({ message: 'run it' }, { onPhase: (p) => phases.push(p) })
  expect(phases.map((p) => p.index)).toEqual([1, 2])
  expect(phases[0].title).toBe('Context')
  expect(result.message).toBe('report')
})

it('ignores phase events when no onPhase handler is given', async () => {
  mockSseResponse([
    'data: {"type":"phase","phase":{"index":1,"title":"Context","status":"done","markdown":"a"}}\n\n',
    'data: {"type":"final","result":{"type":"chat","message":"report"}}\n\n',
  ])
  await expect(postChatStream({ message: 'run it' })).resolves.toMatchObject({ message: 'report' })
})
```

Rename `mockSseResponse` to whatever the existing tests in that file actually use.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- chatApi`
Expected: FAIL — `onPhase` is not a known property of `ChatStreamHandlers`.

- [ ] **Step 3: Write the implementation**

In `frontend/src/types/session.ts`:

```ts
export type SessionMode = 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform' | 'devotional' | 'socratic' | 'hermeneutics'
```

Add `'hermeneutics_report'` to the `ArtifactLink['type']` union, and append:

```ts
/** One completed phase of a Hermeneutics run, delivered by the `phase`
 * SSE event and stored on the assistant message so a reload — or a share —
 * shows the finished run. */
export interface PhaseResult {
  /** 1-8 for a real phase. 0 is the "reading that as X" notice shown when
   * the passage was resolved from a description; it renders as a plain
   * line and never appears in the report. */
  index: number
  title: string
  status: 'running' | 'done' | 'error'
  markdown: string
  /** Phase 1 only: the passage's primary addressee ('jew' | 'gentile' |
   * 'church'), or null when the model omitted its marker line. */
  audience?: string | null
  /** Phase 3 only: who is speaking ('god' | 'prophet' | 'human' |
   * 'adversary'), or null when the marker line was omitted. */
  speaker?: string | null
  /** Phase 4 only: witnesses that resolved and were fetched. */
  citations?: { reference: string; text: string; verified: boolean }[]
  /** Phase 8 only: the three validation-test verdicts. */
  verdicts?: { test: string; passed: boolean; reason?: string }[]
}

/** Params for a `hermeneutics_report` ArtifactLink — the whole report
 * travels inline (no fetch when the pane opens it), as the devotional does. */
export interface HermeneuticsArtifactParams {
  reference: string
  phases: PhaseResult[]
  summary: string
}
```

Add `phases?: PhaseResult[]` to `SessionMessage`, and to `ModeParams`:

```ts
  /** Hermeneutics mode: the compact digest of a completed run. Its presence
   * is what makes a later turn a follow-up rather than a fresh run. */
  runDigest?: string
```

In `frontend/src/lib/chatApi.ts`, add to `ChatStreamHandlers`:

```ts
  /** Called once per completed phase of a Hermeneutics run, in order.
   * Never called for any other mode. */
  onPhase?: (phase: PhaseResult) => void
```

and in `handleFrame`, before the `final` branch:

```ts
    } else if (event.type === 'phase') {
      handlers.onPhase?.(event.phase as PhaseResult)
```

Check `toWireModeParams` in the same file: it maps camelCase `ModeParams` onto the snake_case wire shape. Add `runDigest → run_digest` there, matching how `seriesId → series_id` is handled.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- chatApi && npx tsc -b`
Expected: PASS, and a clean type-check.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/lib/chatApi.ts frontend/src/lib/chatApi.test.ts
git commit -m "$(cat <<'EOF'
feat(hermeneutics): PhaseResult type and onPhase stream handler

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: PhaseList component

**Files:**
- Create: `frontend/src/components/chatbot/PhaseList.tsx`, `frontend/src/components/chatbot/PhaseList.test.tsx`

**Interfaces:**
- Consumes: `PhaseResult` (Task 12), `renderMarkdown` (`@/lib/renderMarkdown`).
- Produces: `export function PhaseList({ phases }: { phases: PhaseResult[] })`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/chatbot/PhaseList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PhaseList } from './PhaseList'
import type { PhaseResult } from '@/types/session'

const done = (over: Partial<PhaseResult> = {}): PhaseResult => ({
  index: 1, title: 'Contextual Scope', status: 'done', markdown: 'Findings body text.', ...over,
})

describe('PhaseList', () => {
  it('shows each phase title collapsed, with the body hidden until expanded', async () => {
    render(<PhaseList phases={[done()]} />)
    expect(screen.getByText(/contextual scope/i)).toBeInTheDocument()
    expect(screen.queryByText(/findings body text/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /contextual scope/i }))
    expect(screen.getByText(/findings body text/i)).toBeInTheDocument()
  })

  it('marks a running phase as in progress', () => {
    render(<PhaseList phases={[done({ status: 'running', markdown: '' })]} />)
    expect(screen.getByLabelText(/in progress/i)).toBeInTheDocument()
  })

  it('shows an errored phase as failed', () => {
    render(<PhaseList phases={[done({ status: 'error', markdown: 'provider timeout' })]} />)
    expect(screen.getByLabelText(/could not be completed/i)).toBeInTheDocument()
  })

  it('lists verified witnesses for phase 4', async () => {
    render(<PhaseList phases={[done({
      index: 4, title: 'Witnesses',
      citations: [{ reference: '1CO 15:51-52', text: 'Behold, I shew you a mystery', verified: true }],
    })]} />)
    await userEvent.click(screen.getByRole('button', { name: /witnesses/i }))
    expect(screen.getByText('1CO 15:51-52')).toBeInTheDocument()
    expect(screen.getByText(/shew you a mystery/i)).toBeInTheDocument()
  })

  it('shows verdict badges for phase 8', async () => {
    render(<PhaseList phases={[done({
      index: 8, title: 'Validation',
      verdicts: [
        { test: 'heart', passed: true },
        { test: 'cross', passed: true },
        { test: 'grace', passed: true },
      ],
    })]} />)
    await userEvent.click(screen.getByRole('button', { name: /validation/i }))
    expect(screen.getAllByText(/passed/i)).toHaveLength(3)
  })

  it('raises a caution banner when a validation test failed', () => {
    render(<PhaseList phases={[done({
      index: 8, title: 'Validation',
      verdicts: [
        { test: 'heart', passed: true },
        { test: 'cross', passed: false, reason: 'reintroduces sin-consciousness' },
        { test: 'grace', passed: true },
      ],
    })]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/cross test/i)
    expect(screen.getByRole('status')).toHaveTextContent(/sin-consciousness/i)
  })

  it('renders an index-0 notice as a plain line, not a collapsible phase', () => {
    render(<PhaseList phases={[done({
      index: 0, title: 'Passage', markdown: 'Reading that as **MAT 25:1-13**.',
    })]} />)
    expect(screen.getByText(/reading that as/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/phase 0/i)).not.toBeInTheDocument()
  })

  it('renders nothing for an empty phase list', () => {
    const { container } = render(<PhaseList phases={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- PhaseList`
Expected: FAIL — cannot resolve `./PhaseList`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/chatbot/PhaseList.tsx`. Match the Tailwind token conventions used by the sibling components (`var(--color-surface-alt)`, `var(--color-text-secondary)`, `var(--color-green)`):

```tsx
import { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Loader2, X } from 'lucide-react'
import { renderMarkdown } from '@/lib/renderMarkdown'
import type { PhaseResult } from '@/types/session'

function StatusIcon({ status }: { status: PhaseResult['status'] }) {
  if (status === 'running') {
    return <Loader2 aria-label="In progress" className="h-3.5 w-3.5 animate-spin text-[var(--color-text-secondary)]" />
  }
  if (status === 'error') {
    return <X aria-label="Could not be completed" className="h-3.5 w-3.5 text-[var(--color-red)]" />
  }
  return <Check aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-green)]" />
}

function Phase({ phase }: { phase: PhaseResult }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-[var(--color-border)]">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-medium hover:bg-[var(--color-surface-alt)]"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
        <span className="text-[var(--color-text-secondary)]">Phase {phase.index}</span>
        <span className="flex-1 truncate">{phase.title}</span>
        <StatusIcon status={phase.status} />
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-2.5 py-2 text-sm leading-relaxed">
          {renderMarkdown(phase.markdown)}
          {!!phase.citations?.length && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {phase.citations.map((c) => (
                <li key={c.reference} className="text-xs">
                  <span className="font-semibold">{c.reference}</span>{' '}
                  <span className="text-[var(--color-text-secondary)]">{c.text}</span>
                </li>
              ))}
            </ul>
          )}
          {!!phase.verdicts?.length && (
            <ul className="mt-2 flex flex-col gap-1">
              {phase.verdicts.map((v) => (
                <li key={v.test} className="text-xs">
                  <span className="font-semibold capitalize">{v.test} Test</span>:{' '}
                  <span className={v.passed ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}>
                    {v.passed ? 'PASSED' : 'FAILED'}
                  </span>
                  {v.reason ? ` — ${v.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function PhaseList({ phases }: { phases: PhaseResult[] }) {
  if (!phases.length) return null
  const failed = phases.flatMap((p) => p.verdicts ?? []).filter((v) => !v.passed)
  return (
    <div className="flex flex-col gap-1.5">
      {phases.map((phase) =>
        // Index 0 is the "reading that as X" notice a described passage
        // gets — a line to read, not a phase to open.
        phase.index === 0 ? (
          <div key={phase.index} className="text-xs text-[var(--color-text-secondary)]">
            {renderMarkdown(phase.markdown)}
          </div>
        ) : (
          <Phase key={phase.index} phase={phase} />
        )
      )}
      {failed.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-md bg-[var(--color-surface-alt)] px-2.5 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-amber)]" aria-hidden="true" />
          <span>
            {failed.map((v) => (
              <span key={v.test} className="block">
                <span className="font-semibold capitalize">{v.test} Test</span> failed
                {v.reason ? `: ${v.reason}` : ''}. Weigh this before accepting the reading.
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  )
}
```

If `--color-red` or `--color-amber` are not defined in `frontend/src/index.css`, use the nearest tokens that are — do not invent new CSS variables.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- PhaseList && npx tsc -b`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chatbot/PhaseList.tsx frontend/src/components/chatbot/PhaseList.test.tsx
git commit -m "$(cat <<'EOF'
feat(hermeneutics): collapsible PhaseList with witnesses and verdict badges

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: ChatPane wiring

**Files:**
- Modify: `frontend/src/components/shell/ChatPane.tsx` — `streamAssistantReply` (~:187–232), the three post-response blocks that persist the socratic reference (~:363, ~:448, ~:503), and wherever `MessageBubble`/assistant messages are rendered
- Test: `frontend/src/components/shell/ChatPane.test.tsx` (append)

**Interfaces:**
- Consumes: `PhaseList` (Task 13), `onPhase` (Task 12).
- Produces: phases accumulated onto the assistant `SessionMessage`; `reference` and `runDigest` persisted into `modeParams` after a run.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/shell/ChatPane.test.tsx`, following the existing socratic-persistence test at line ~116 for setup style:

```tsx
it('accumulates phase events onto the assistant message', async () => {
  mockStreamWithPhases([
    { index: 1, title: 'Context', status: 'done', markdown: 'a' },
    { index: 2, title: 'Semantics', status: 'done', markdown: 'b' },
  ], { type: 'chat', message: 'report', data: { reference: 'ROM 8:1' } })

  const session = useSessionsStore.getState().createSession('hermeneutics', { reference: 'ROM 8:1' })
  renderChatPane(session.id)
  await sendMessage('run it')

  const messages = useSessionsStore.getState().sessions.find((s) => s.id === session.id)!.messages
  const assistant = messages[messages.length - 1]
  expect(assistant.phases?.map((p) => p.index)).toEqual([1, 2])
})

it('persists the reference and run digest into modeParams after a run', async () => {
  mockStreamWithPhases([], {
    type: 'chat',
    message: 'report',
    data: { reference: '1TH 4:15-18', runDigest: 'digest text' },
  })

  const session = useSessionsStore.getState().createSession('hermeneutics', {})
  renderChatPane(session.id)
  await sendMessage('run 1 Thessalonians 4:15-18')

  const params = useSessionsStore.getState().sessions.find((s) => s.id === session.id)!.modeParams
  expect(params.reference).toBe('1TH 4:15-18')
  expect(params.runDigest).toBe('digest text')
})

it('does not overwrite an existing digest when a turn returns none', async () => {
  mockStreamWithPhases([], { type: 'chat', message: 'follow-up answer', data: { reference: 'ROM 8:1' } })

  const session = useSessionsStore.getState().createSession('hermeneutics', {
    reference: 'ROM 8:1', runDigest: 'existing digest',
  })
  renderChatPane(session.id)
  await sendMessage('say more')

  const params = useSessionsStore.getState().sessions.find((s) => s.id === session.id)!.modeParams
  expect(params.runDigest).toBe('existing digest')
})
```

Write `mockStreamWithPhases(phases, finalResult)` as a local helper in this test file, modelled on however the file already mocks `postChatStream`: it should invoke `handlers.onPhase` once per phase, then resolve with `finalResult`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- ChatPane`
Expected: FAIL — `assistant.phases` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `streamAssistantReply`, accumulate phases through the same `put()` patch mechanism the text uses:

```ts
      const collected: PhaseResult[] = []
      const handlers = opts?.devotional
        ? {}
        : {
            onChunk: (text: string) => put({ text }),
            onPhase: (phase: PhaseResult) => {
              collected.push(phase)
              put({ phases: [...collected] })
            },
          }
```

Add a helper beside the existing `socraticReference` helper (~:51):

```ts
// Hermeneutics persists both the resolved passage and the run digest into
// modeParams, so a later turn is answered from the completed run instead of
// re-running the eight phases.
function hermeneuticsParams(data: unknown): { reference?: string; runDigest?: string } {
  const d = data as { reference?: string; runDigest?: string } | undefined
  const patch: { reference?: string; runDigest?: string } = {}
  if (d?.reference) patch.reference = d.reference
  // Only a fresh run returns a digest; a follow-up turn returns none, and
  // must not clear the one the session already holds.
  if (d?.runDigest) patch.runDigest = d.runDigest
  return patch
}
```

At each of the three places that currently do `if (session.mode === 'socratic') { ... }` with the response in hand, add the parallel branch:

```ts
        if (session.mode === 'hermeneutics') {
          const patch = hermeneuticsParams(response?.data)
          if (Object.keys(patch).length) updateModeParams(sessionId, patch)
        }
```

(In `resolveChoice` the variable is `response.data`, not `response?.data` — match the local shape at each site.)

Where assistant messages render, add the phase list above the bubble text:

```tsx
{!!message.phases?.length && <PhaseList phases={message.phases} />}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- ChatPane && npx tsc -b`
Expected: PASS, including the pre-existing socratic-persistence tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(hermeneutics): stream phases into the chat and persist the run digest

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Report artifact

**Files:**
- Create: `frontend/src/components/artifacts/HermeneuticsArtifact.tsx`, `frontend/src/components/artifacts/HermeneuticsArtifact.test.tsx`
- Modify: `frontend/src/store/useArtifactStore.ts` (`fetchForLink`), `frontend/src/components/shell/ArtifactPane.tsx` (~:79 render switch)
- Test: `frontend/src/store/useArtifactStore.test.ts` (append)

**Interfaces:**
- Consumes: `HermeneuticsArtifactParams` (Task 12).
- Produces: `export function HermeneuticsArtifact({ reference, phases, summary }: HermeneuticsArtifactParams)`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/artifacts/HermeneuticsArtifact.test.tsx` — mirror `DevotionalArtifact.test.tsx`'s setup:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HermeneuticsArtifact } from './HermeneuticsArtifact'
import type { PhaseResult } from '@/types/session'

const phases: PhaseResult[] = [
  { index: 1, title: 'Contextual Scope', status: 'done', markdown: 'Addressed to the Church.' },
  { index: 8, title: 'Validation', status: 'done', markdown: 'Checked.', verdicts: [
    { test: 'heart', passed: true }, { test: 'cross', passed: true }, { test: 'grace', passed: true },
  ] },
]

describe('HermeneuticsArtifact', () => {
  it('shows the reference, every phase body, and the final interpretation', () => {
    render(<HermeneuticsArtifact reference="1TH 4:15-18" phases={phases} summary="The rapture." />)
    expect(screen.getByText('1TH 4:15-18')).toBeInTheDocument()
    expect(screen.getByText(/addressed to the church/i)).toBeInTheDocument()
    expect(screen.getByText(/checked/i)).toBeInTheDocument()
    expect(screen.getByText(/final verified interpretation/i)).toBeInTheDocument()
    expect(screen.getByText(/the rapture/i)).toBeInTheDocument()
  })

  it('renders phase bodies expanded, unlike the chat list', () => {
    render(<HermeneuticsArtifact reference="1TH 4:15-18" phases={phases} summary="s" />)
    expect(screen.queryByRole('button', { name: /contextual scope/i })).not.toBeInTheDocument()
  })

  it('handles a report with no phases', () => {
    render(<HermeneuticsArtifact reference="ROM 8:1" phases={[]} summary="Only a summary." />)
    expect(screen.getByText(/only a summary/i)).toBeInTheDocument()
  })
})
```

Append to `frontend/src/store/useArtifactStore.test.ts`:

```ts
it('opens a hermeneutics report from inline params without fetching', async () => {
  await useArtifactStore.getState().openArtifact({
    type: 'hermeneutics_report',
    label: 'Open full report ▸',
    params: { reference: 'ROM 8:1', phases: [], summary: 's' },
  })
  const state = useArtifactStore.getState()
  expect(state.status).toBe('ready')
  expect((state.data as { reference: string }).reference).toBe('ROM 8:1')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- HermeneuticsArtifact useArtifactStore`
Expected: FAIL — cannot resolve `./HermeneuticsArtifact`; `Unknown artifact type: hermeneutics_report`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/artifacts/HermeneuticsArtifact.tsx`:

```tsx
import { renderMarkdown } from '@/lib/renderMarkdown'
import type { HermeneuticsArtifactParams } from '@/types/session'

export function HermeneuticsArtifact({ reference, phases, summary }: HermeneuticsArtifactParams) {
  return (
    <div className="flex flex-col gap-4 max-w-prose">
      <h2 className="text-sm font-semibold">{reference}</h2>
      {phases.map((phase) => (
        <section key={phase.index} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Phase {phase.index} · {phase.title}
          </h3>
          <div className="text-sm leading-relaxed">{renderMarkdown(phase.markdown)}</div>
          {!!phase.citations?.length && (
            <ul className="flex flex-col gap-1">
              {phase.citations.map((c) => (
                <li key={c.reference} className="text-xs">
                  <span className="font-semibold">{c.reference}</span>{' '}
                  <span className="text-[var(--color-text-secondary)]">{c.text}</span>
                </li>
              ))}
            </ul>
          )}
          {!!phase.verdicts?.length && (
            <ul className="flex flex-col gap-0.5">
              {phase.verdicts.map((v) => (
                <li key={v.test} className="text-xs">
                  <span className="font-semibold capitalize">{v.test} Test</span>:{' '}
                  {v.passed ? 'PASSED' : 'FAILED'}
                  {v.reason ? ` — ${v.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <section className="flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Final Verified Interpretation
        </h3>
        <div className="text-sm leading-relaxed">{renderMarkdown(summary)}</div>
      </section>
    </div>
  )
}
```

In `useArtifactStore.ts`'s `fetchForLink`, beside the `devotional` case:

```ts
    case 'hermeneutics_report':
      // The whole report travels inline on the link params (set by the chat
      // message that produced it) — nothing to fetch.
      return link.params
```

In `ArtifactPane.tsx`, import the component and add beside the devotional line:

```tsx
                {activeArtifact.type === 'hermeneutics_report' && (
                  <HermeneuticsArtifact {...(data as HermeneuticsArtifactParams)} />
                )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- HermeneuticsArtifact useArtifactStore && npx tsc -b`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/artifacts/HermeneuticsArtifact.tsx frontend/src/components/artifacts/HermeneuticsArtifact.test.tsx frontend/src/store/useArtifactStore.ts frontend/src/store/useArtifactStore.test.ts frontend/src/components/shell/ArtifactPane.tsx
git commit -m "$(cat <<'EOF'
feat(hermeneutics): full-report artifact pane

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Mode picker and sidebar

**Files:**
- Modify: `frontend/src/components/shell/ModePickerScreen.tsx` (add beside the Socratic Study button at ~:258), `frontend/src/components/shell/SessionsPane.tsx` (`MODE_ORDER` :35, `MODE_ICONS` :44), `frontend/src/store/useSessionsStore.ts` (`MODE_LABELS` :47)
- Test: `frontend/src/components/shell/ModePickerScreen.test.tsx`, `frontend/src/components/shell/SessionsPane.test.tsx` (append)

**Interfaces:**
- Consumes: `startWithChoices` (already in `ModePickerScreen`).
- Produces: the mode's entry point and sidebar grouping.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/shell/ModePickerScreen.test.tsx`:

```tsx
it('offers a Hermeneutics starter', () => {
  renderModePicker()
  expect(screen.getByRole('button', { name: /hermeneutics/i })).toBeInTheDocument()
})

it('creates a hermeneutics session with a Surprise me choice', async () => {
  renderModePicker()
  await userEvent.click(screen.getByRole('button', { name: /hermeneutics/i }))
  const session = useSessionsStore.getState().sessions[0]
  expect(session.mode).toBe('hermeneutics')
  expect(screen.getByRole('button', { name: /surprise me/i })).toBeInTheDocument()
})
```

Match the existing tests' helper names (`renderModePicker` above stands in for whatever this file already uses at line 36/168).

Append to `frontend/src/components/shell/SessionsPane.test.tsx`:

```tsx
it('groups hermeneutics sessions under their own heading', () => {
  useSessionsStore.getState().createSession('hermeneutics', {})
  renderSessionsPane()
  expect(screen.getByText('Hermeneutics')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- ModePickerScreen SessionsPane`
Expected: FAIL — no Hermeneutics button; `MODE_LABELS` has no `hermeneutics` key (a TypeScript error once `SessionMode` includes it — which is the point: the `Record<SessionMode, …>` maps force every site to be updated).

- [ ] **Step 3: Write the implementation**

In `ModePickerScreen.tsx`, after the Socratic Study button (import `Scale` from `lucide-react`):

```tsx
          <button
            className={STARTER_BUBBLE}
            onClick={() =>
              startWithChoices(
                'hermeneutics',
                '⚖️ Hermeneutics',
                'Name a passage and I\'ll run it through all eight phases — context, semantics, witnesses, covenant, typology and the validation tests.',
                [{ label: 'Surprise me', modeParams: { surprise: true } }]
              )
            }
          >
            <Scale className="h-4 w-4 shrink-0" aria-hidden="true" /> Hermeneutics
          </button>
```

Add `surprise?: boolean` to `ModeParams` in `frontend/src/types/session.ts`, and map it in `toWireModeParams` (`chatApi.ts`) as `surprise → surprise`.

In `SessionsPane.tsx`: add `'hermeneutics'` to `MODE_ORDER` immediately after `'socratic'`, and `hermeneutics: Scale` to `MODE_ICONS` (importing `Scale`).

In `useSessionsStore.ts`: add `hermeneutics: 'Hermeneutics'` to `MODE_LABELS`.

- [ ] **Step 4: Run the full frontend suite**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: PASS across the board. `Record<SessionMode, …>` exhaustiveness means any site still missing the new mode fails the type-check here.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ModePickerScreen.tsx frontend/src/components/shell/ModePickerScreen.test.tsx frontend/src/components/shell/SessionsPane.tsx frontend/src/components/shell/SessionsPane.test.tsx frontend/src/store/useSessionsStore.ts frontend/src/types/session.ts frontend/src/lib/chatApi.ts
git commit -m "$(cat <<'EOF'
feat(hermeneutics): mode picker entry and sidebar grouping

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Documentation and manual smoke

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the whole suite**

```bash
python3 -m pytest tests -v
cd frontend && npm test && npx tsc -b && npm run lint
```

Expected: all green. Fix anything that is not before continuing.

- [ ] **Step 2: Manual smoke against a running server**

Start the app per `CHATBOT_SETUP.md`, then in the UI:

1. **1 Thessalonians 4:15–18** — the methodology's own worked example. All eight phases stream in; Phase 4 shows verified witnesses; the report opens in the pane.
2. **Hebrews 6:4–6** — Phase 5 should set the obscure passage under the clear declaration, not the reverse.
3. **Job 1:21** — Phase 3 should return `SPEAKER: human` and classify the line as recorded, not doctrinal.
4. **Genesis 1** — the narrowing reply, not a run.
5. **"the parable of the ten virgins"** — resolves from the curated table with
   no LLM call, echoes "Reading that as **MAT 25:1-13**" *before* Phase 1
   appears, and runs all eight phases (13 verses, within the 25-verse cap).
6. **"the armour of God"** — not a parable, so it exercises the LLM fallback;
   expect Ephesians 6:10-18 and the same echo-back.
7. **"the bit where that guy does the thing"** — resolves to nothing; expect a
   request for a reference, never a run on a guessed passage.
8. Ask a follow-up after a completed run ("why does the audience matter?") — it must answer from the digest, and the phases must **not** re-run. Confirm in the trace pane.
9. Reload the page mid-session — the completed phases are still rendered.

- [ ] **Step 3: Document the mode**

Add to `CLAUDE.md`, after the "Devotional 'Pick one for me'" section:

```markdown
## Hermeneutics mode

Runs a passage (a verse or a range of at most 25 verses — see
`MAX_PASSAGE_VERSES`, sized to fit every curated parable) through a fixed
8-phase interpretive methodology,
one LLM call per phase, orchestrated by `chatbot/hermeneutics.py` with
the prompts in `chatbot/hermeneutics_phases.py`. Phases 2, 4 and 7 are
grounded in real `Complete.db` lookups (interlinear words and Strong's
entries via the new dependency-free readers in `chatbot/bible_search.py`,
English full-text search, and witness-verse verification that **drops any
reference that does not resolve**); the rest run on model knowledge over
the passage and the prior phases.

Each completed phase is pushed to the browser as an additive `phase` SSE
event — the `stream` / single `final` / terminal `trace` contract is
otherwise unchanged — and stored on the assistant message, so a reload or
a share link shows the finished run. The whole report also opens in the
artifact pane (`hermeneutics_report`, carried inline like `devotional`).

A passage can be named by reference **or described** ("the parable of the
ten virgins"): resolution tries the reference regex, then a normalised name
match against the existing `chatbot/data/parables.py` table (no LLM call),
then one short LLM completion with a single retry. A resolution the user did
not type verbatim is echoed back before Phase 1 runs, as an index-0 `phase`
event. Resolution failure asks for a reference rather than guessing. Note
that the 25-verse cap is sized to the parable corpus — 12 of the 42 parables
exceed 12 verses, the longest being the Prodigal Son at 22 — so lowering it
would start rejecting named parables.

The curated idiom rulings in `chatbot/data/hermeneutic_rulings.py` are
injected only when their trigger phrases match the passage. Every proof
text is verified against `Complete.db` by
`tests/chatbot/test_hermeneutic_rulings.py`. **Editing `RULINGS` changes
the mode's doctrinal output** — the methodology encodes a specific
free-grace/dispensational position deliberately, and Phase 8's three tests
are *disclosure, never enforcement*: a failed test is reported with a
caution banner and never triggers a rewrite. See
`docs/superpowers/specs/2026-09-16-hermeneutics-mode-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(hermeneutics): document the mode in CLAUDE.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **The `Original_Words_*` and `Root`/`KJV_SN` alignments are different lengths and different orders.** Genesis 1:1 has 7 original words and 6 root entries. Mixing them silently produces wrong Strong's-to-English pairings. The Task 2 tests pin both.
- **`simple_completion` returns `""` on an unconfigured provider or any HTTP error** — it does not raise. Task 8 checks `llm_unconfigured_error()` up front for that reason; an empty phase body from a transient error still yields a phase with `status: "done"` and empty markdown, which the UI renders as an empty section. That is acceptable; do not add a retry.
- **Do not add a Phase 8 retry loop.** It was explicitly considered and rejected — see the spec's *Phase 8 is disclosure, not enforcement*.
- **`_resolve_verse_reference` returns `None` for an unidentifiable book.** That is the mechanism by which a hallucinated witness gets dropped; do not "fix" it by falling back to the raw string.
