# "Is that in the Bible?" (misquote mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat mode, internal id `misquote`, that checks whether a saying is really in the Bible. It returns a verdict card grounded in `Complete.db`, decided by TypeSafe's JEV classifier, with an optional LLM "Explain" follow-up.

**Architecture:**
- `bible_corpus.py` loads all KJV and 1611 Apocrypha verses into memory once. It provides normalization, exact matching, keyword candidates and reference lookup.
- Candidate verses come from the keyword search plus one LLM "which verses?" suggestion call. `jev_client.py` asks JEV one Choice question per candidate over HTTP.
- `misquote_verdict.py` is a pure function that turns those judgments into one of six verdicts.
- `misquote.py` runs the whole check. `api.py` and `router.py` wire it in as a mode, freeform detection, `/misquote/status` and `/misquote/explain`.
- The frontend adds a `misquote` artifact, a mode tile, and small wiring changes.

**Tech Stack:** Python 3.13, FastAPI, `httpx`, `dataset`/SQLite, pytest (`asyncio_mode = auto`); React + TypeScript, Zustand, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-26-misquote-mode-design.md`

## Global Constraints

- Internal mode id `misquote`; display name **"Is that in the Bible?"**; artifact type `misquote`; artifact label `View check ▸`.
- Verdict ids: `verbatim`, `paraphrase`, `distorted`, `apocrypha_only`, `not_in_bible`, `unclear`. Sub-labels (Apocrypha only): `verbatim` / `paraphrase` / `distorted`.
- JEV Choice options, exactly: `same_meaning`, `meaning_changed`, `related_only`, `unrelated`.
- Starting thresholds: `SOURCE_MIN = 0.70`, `CONFIDENCE_MIN = 0.60`, `NOT_IN_BIBLE_MAX = 0.20`, `CONFIDENT_LABEL_MIN = 0.85`, `RELATED_MIN = 0.5`.
- Saying length: 1–300 characters (`MAX_SAYING_CHARS = 300`). Candidate cap is 30; keyword `k = 25`; at most 5 partial exact hits.
- Env vars: `TYPESAFE_API_KEY` (unset → mode disabled), `TYPESAFE_MODEL` (default `jev-latest`), `MISQUOTE_JEV_TIMEOUT` (default `10`, seconds), `MISQUOTE_JEV_MODE` (`batched` default | `split`), `TYPESAFE_API_URL` (default `https://api.typesafe.ai/v1/systemone`).
- JEV is called over plain HTTP with `httpx`. **No new Python dependency.**
- Never produce a verdict without JEV, except for whole-verse exact hits (no JEV needed) and the "no candidates" case (`not_in_bible`).
- User-facing copy, exact:
  - unavailable: `The checker is unavailable right now. Please try again later.`
  - length: `Please give me just the saying, under about 300 characters.`
  - explain failure: `I couldn't explain this one right now.`
  - primer: `Type a saying and I'll check whether it's really in the Bible.`
- Raw probabilities are never shown to users. The confidence label is only `Confident` or `Fairly sure`, or none.
- Every verse shown is corpus text. Generated text is never displayed as scripture.
- Run backend tests with `pytest` from the repo root. Run frontend tests with `npm test` and type-check with `npx tsc -b`, both from `frontend/`.

## Review Focus

1. **Topic questions in freeform chat.** A message like "Does the Bible say anything about divorce?" must go to normal chat, **not** a misquote check. Pinned in Task 5 (`test_extract_saying_ignores_topic_questions`).
2. **1611 spelling and footnote tags.** An Apocrypha saying typed in modern spelling must still match `APOC` text containing `ſ`, `vnto` or `<f data=…>` footnotes. Pinned in Task 1 (`test_normalize_folds_1611_spelling_and_strips_footnotes`, `test_exact_match_finds_apocrypha_in_modern_spelling`).
3. **Very short or very common sayings,** such as "the Lord is good". These must not flood JEV with thousands of partial exact hits: at most 5 partial hits and at most 30 candidates. Pinned in Task 5 (`test_common_phrase_caps_partial_hits_and_candidates`).
4. **Malformed or partial JEV responses,** for example a missing answer id or missing probabilities. These must give the honest "unavailable" message, never a verdict built on missing data. Pinned in Task 2 (`test_missing_answer_raises_unavailable`).
5. **A saying with no letters at all** (`"???"`, emoji, digits only). This must get the length/format message, not a search. Pinned in Task 5 (`test_saying_without_words_gets_length_message`).

---

## File structure

**Backend (create):**
- `chatbot/bible_corpus.py`: the in-memory verse corpus (normalize, stem, exact match, keyword candidates, reference lookup, context).
- `chatbot/jev_client.py`: the JEV HTTP client (`is_configured`, `judge`, `JevUnavailable`, `Judgment`).
- `chatbot/misquote_verdict.py`: the pure `verdict_from` function and the `Candidate` and `Verdict` types.
- `chatbot/misquote.py`: the orchestrator (`check`, `suggest_refs`, `extract_saying`, `primer`, `explain`).
- `chatbot/data/misquote_eval.py`: the labelled evaluation sayings.
- `scripts/eval_misquote.py`: the manual live evaluation run against the real JEV.
- Tests: `tests/chatbot/test_bible_corpus.py`, `test_jev_client.py`, `test_misquote_verdict.py`, `test_misquote_check.py`, `test_chat_endpoint_misquote.py`, `test_misquote_explain_endpoint.py`.

**Backend (modify):** `chatbot/api.py`, `chatbot/router.py`, `chatbot/schemas.py`, `.env.example`, `DEPLOYMENT.md`, `CLAUDE.md`.

**Frontend (create):** `frontend/src/lib/misquoteDiff.ts` (+ `.test.ts`), `frontend/src/components/artifacts/MisquoteArtifact.tsx` (+ `.test.tsx`).

**Frontend (modify):** `types/session.ts`, `lib/chatApi.ts`, `store/useArtifactStore.ts`, `store/useSessionsStore.ts`, `components/shell/ArtifactPane.tsx`, `components/shell/SessionsPane.tsx`, `components/shell/ChatPane.tsx`, `components/shell/ModePickerScreen.tsx` (+ test).

---

### Task 1: `bible_corpus` — in-memory verse corpus

**Files:**
- Create: `chatbot/bible_corpus.py`
- Test: `tests/chatbot/test_bible_corpus.py`

**Interfaces:**
- Consumes: `chatbot.bible_search.DB_PATH`, `chatbot.bible_search._USFM_TO_BNUM`; `chatbot.router._find_flexible_verse_refs`, `chatbot.router._format_reference` (imported lazily inside `find_refs`).
- Produces:
  - `Verse` (frozen dataclass): `ref: str, text: str, source: str ("canon"|"apocrypha"), book: str, chapter: int, verse: int, stems: Tuple[str, ...], position: int`
  - `ExactHit` (frozen dataclass): `verse: Verse, whole_verse: bool`
  - `normalize(text: str) -> List[str]`, `stem(word: str) -> str`, `stems_of(text: str) -> Tuple[str, ...]`
  - `exact_match(saying: str) -> List[ExactHit]`
  - `keyword_candidates(saying: str, k: int = 25) -> List[Verse]`
  - `by_ref(ref: str) -> Optional[Verse]`: an exact DB ref string such as `"1 Timothy 6:10"` or `"Ecclesiasticus 31:27"`
  - `find_refs(text: str, max_range: int = 5) -> List[Verse]`: every reference in free text (canon via the router parser, Apocrypha via book names/aliases), with ranges expanded up to `max_range` verses
  - `context(verse: Verse, radius: int = 2) -> List[Verse]`: neighbours in the same book and chapter, in order, including `verse`
  - `load() -> None` forces loading (used by tests and the eval script)

- [ ] **Step 1: Write the failing tests**

`tests/chatbot/test_bible_corpus.py`:

```python
"""In-memory KJV + 1611 Apocrypha corpus for the misquote checker. Runs
against the real Complete.db, like test_bible_search.py."""

import threading

from chatbot import bible_corpus as bc


def test_loads_every_canonical_and_apocrypha_verse():
    bc.load()
    corpus = bc._corpus()
    assert sum(1 for v in corpus.verses if v.source == "canon") == 31102
    assert sum(1 for v in corpus.verses if v.source == "apocrypha") == 5705


def test_concurrent_first_use_loads_once(monkeypatch):
    monkeypatch.setattr(bc, "_CORPUS", None)
    calls = []
    real_build = bc._build

    def counting_build():
        calls.append(1)
        return real_build()

    monkeypatch.setattr(bc, "_build", counting_build)
    threads = [threading.Thread(target=bc.load) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1


def test_normalize_folds_1611_spelling_and_strips_footnotes():
    raw = 'ANd Ioſias helde the <f data="%3Cnote%3E">*</f> Feaſt vnto his Lord &amp; <it>is</it> here'
    assert bc.normalize(raw) == ["and", "iosias", "helde", "the", "feast", "unto", "his", "lord", "and", "amp", "is", "here"]


def test_stem_merges_archaic_and_modern_endings():
    assert bc.stem("goeth") == bc.stem("goes") == "go"
    assert bc.stem("spareth") == bc.stem("spare") == "spar"
    assert bc.stem("loveth") == bc.stem("love")
    assert bc.stem("mightie") == bc.stem("mighty")
    assert bc.stem("sinners") == "sinner"
    assert bc.stem("is") == "is"


def test_exact_match_flags_whole_verse_hits():
    hits = bc.exact_match("Jesus wept.")
    assert [(h.verse.ref, h.whole_verse) for h in hits] == [("John 11:35", True)]


def test_exact_match_flags_partial_hits_and_ignores_case_and_punctuation():
    hits = bc.exact_match("money is the ROOT of all evil!")
    refs = {h.verse.ref: h.whole_verse for h in hits}
    assert refs["1 Timothy 6:10"] is False


def test_exact_match_finds_apocrypha_in_modern_spelling():
    hits = bc.exact_match("Wine is as good as life to a man if it be drunk moderately")
    assert any(h.verse.ref == "Ecclesiasticus 31:27" and h.verse.source == "apocrypha" for h in hits)


def test_exact_match_needs_two_words():
    assert bc.exact_match("love") == []


def test_keyword_candidates_rank_the_source_verse_in_the_top_25():
    for saying, ref in [
        ("Spare the rod, spoil the child", "Proverbs 13:24"),
        ("Pride goes before a fall", "Proverbs 16:18"),
        ("Physician, heal thyself", "Luke 4:23"),
        ("He that toucheth pitch shall be defiled", "Ecclesiasticus 13:1"),
    ]:
        refs = [v.ref for v in bc.keyword_candidates(saying, k=25)]
        assert ref in refs, (saying, refs[:5])


def test_keyword_candidates_empty_for_stopwords_only():
    assert bc.keyword_candidates("it is what it is") == []


def test_by_ref_resolves_both_tables_and_strips_tags():
    canon = bc.by_ref("Proverbs 9:10")
    assert canon.source == "canon"
    assert canon.text == "The fear of the LORD is the beginning of wisdom: and the knowledge of the holy is understanding."
    apoc = bc.by_ref("Ecclesiasticus 13:1")
    assert apoc.source == "apocrypha"
    assert "<" not in apoc.text
    assert bc.by_ref("Hezekiah 1:1") is None


def test_find_refs_parses_canon_apocrypha_aliases_and_ranges():
    # Full book names: the router's flexible parser (reused for canon) is
    # unreliable on abbreviations inside lists, so suggest_refs asks the
    # LLM for full names.
    refs = [v.ref for v in bc.find_refs("Try 1 Timothy 6:10, Sirach 31:27 and Isaiah 11:6-7.")]
    assert refs == ["1 Timothy 6:10", "Isaiah 11:6", "Isaiah 11:7", "Ecclesiasticus 31:27"]


def test_find_refs_ignores_unknown_references():
    assert bc.find_refs("NONE") == []
    assert bc.find_refs("Genesis 99:1") == []


def test_context_stays_in_the_chapter():
    first = bc.by_ref("Genesis 1:1")
    assert [v.ref for v in bc.context(first, radius=2)] == ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]
    mid = bc.by_ref("1 Timothy 6:10")
    assert [v.ref for v in bc.context(mid, radius=1)] == ["1 Timothy 6:9", "1 Timothy 6:10", "1 Timothy 6:11"]
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pytest tests/chatbot/test_bible_corpus.py -v`
Expected: FAIL with `ImportError: cannot import name 'bible_corpus'`.

- [ ] **Step 3: Implement `chatbot/bible_corpus.py`**

```python
"""In-memory verse corpus — the 31,102 canonical KJV verses plus the 5,705
1611 Apocrypha verses — for the "Is that in the Bible?" misquote checker.

Loaded once, lazily and thread-safely, on first use (~6 MB). Checks never
run per-request SQL: search_english_sync's REPLACE(...) LIKE full scan is
far too slow to call several times per check.

Normalization is shared by both tables and deliberately lossy so the 1611
spelling of the Apocrypha ("Ieruſalem", "vnto", "mightie") and modern typed
sayings meet: footnotes/tags stripped, ſ→s, v→u, j→i, then stem()."""

import re
import threading
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import dataset

from chatbot.bible_search import DB_PATH, _USFM_TO_BNUM

_FOOTNOTE_RE = re.compile(r"<f\b[^>]*>.*?</f>", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_NON_LETTER_RE = re.compile(r"[^a-z\s]")
_SPACE_RE = re.compile(r"\s+")
_REF_RE = re.compile(r"^(.+) (\d+):(\d+)$")
_SUFFIXES = ("eth", "est", "ing", "ed", "es", "s")

# Only ever removed from the *saying* (never from verse text): common
# modern and KJV function words that would otherwise match everything.
STOPWORDS = frozenset("""
a an the and or but nor of to in on at by for with from as into unto upon
is are was were be been being am it its this that these those there here
he she they them his her hers their theirs him i me my mine we us our ours
you your yours ye thee thou thy thine not no so if then than when which who
whom whose what shall will would should can could may might must do does did
doth hath have has had let all also even every any some one out up
""".split())

_APOC_ALIASES = {
    "sirach": "Ecclesiasticus",
    "ben sira": "Ecclesiasticus",
    "wisdom": "Wisdom of Solomon",
    "tobias": "Tobit",
    "manasseh": "Prayer of Manasseh",
    "bel": "Bel and the Dragon",
}


@dataclass(frozen=True)
class Verse:
    ref: str
    text: str
    source: str  # "canon" | "apocrypha"
    book: str
    chapter: int
    verse: int
    stems: Tuple[str, ...]
    position: int


@dataclass(frozen=True)
class ExactHit:
    verse: Verse
    whole_verse: bool


def normalize(text: str) -> List[str]:
    text = _FOOTNOTE_RE.sub(" ", text)
    text = _TAG_RE.sub(" ", text)
    text = text.lower().replace("ſ", "s").replace("&", " and ")
    text = text.replace("v", "u").replace("j", "i")
    text = text.replace("’", "").replace("'", "")
    return _NON_LETTER_RE.sub(" ", text).split()


def stem(word: str) -> str:
    if word.endswith("ie") and len(word) > 3:
        word = word[:-2] + "y"
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 2:
            word = word[: -len(suffix)]
            break
    if len(word) > 3 and word.endswith("e"):
        word = word[:-1]
    return word[:6]


def stems_of(text: str) -> Tuple[str, ...]:
    return tuple(stem(w) for w in normalize(text))


def _display(raw: str) -> str:
    text = _FOOTNOTE_RE.sub("", raw or "")
    text = _TAG_RE.sub("", text)
    return _SPACE_RE.sub(" ", text).strip()


class _Corpus:
    def __init__(self, verses: List[Verse]):
        self.verses = verses
        self.by_ref: Dict[str, Verse] = {v.ref: v for v in verses}
        self.by_bcv: Dict[Tuple[int, int, int], Verse] = {}
        self.index: Dict[str, List[int]] = defaultdict(list)
        self.apoc_books: Dict[str, str] = {}
        for v in verses:
            for s in set(v.stems):
                self.index[s].append(v.position)
            if v.source == "apocrypha":
                self.apoc_books[v.book.lower()] = v.book


_CORPUS: Optional[_Corpus] = None
_LOCK = threading.Lock()


def _build() -> _Corpus:
    db = dataset.connect(DB_PATH)
    verses: List[Verse] = []
    bcv: Dict[Tuple[int, int, int], int] = {}
    for row in db.query("SELECT id, ref, bnum, cnum, vnum, book, text_1769 FROM Complete ORDER BY id"):
        position = len(verses)
        verses.append(Verse(
            ref=row["ref"], text=_display(row["text_1769"]), source="canon",
            book=row["book"], chapter=int(row["cnum"]), verse=int(row["vnum"]),
            stems=stems_of(row["text_1769"] or ""), position=position,
        ))
        bcv[(int(row["bnum"]), int(row["cnum"]), int(row["vnum"]))] = position
    for row in db.query("SELECT id, ref, text FROM APOC ORDER BY id"):
        match = _REF_RE.match(row["ref"])
        if not match:
            continue
        verses.append(Verse(
            ref=row["ref"], text=_display(row["text"]), source="apocrypha",
            book=match.group(1), chapter=int(match.group(2)), verse=int(match.group(3)),
            stems=stems_of(row["text"] or ""), position=len(verses),
        ))
    corpus = _Corpus(verses)
    corpus.by_bcv = {key: verses[pos] for key, pos in bcv.items()}
    return corpus


def _corpus() -> _Corpus:
    global _CORPUS
    if _CORPUS is None:
        with _LOCK:
            if _CORPUS is None:
                _CORPUS = _build()
    return _CORPUS


def load() -> None:
    _corpus()


def _contains(haystack: Tuple[str, ...], needle: Tuple[str, ...]) -> bool:
    n = len(needle)
    first = needle[0]
    for i in range(len(haystack) - n + 1):
        if haystack[i] == first and haystack[i:i + n] == needle:
            return True
    return False


def exact_match(saying: str) -> List[ExactHit]:
    needle = stems_of(saying)
    if len(needle) < 2:
        return []
    corpus = _corpus()
    positions = set(corpus.index.get(needle[0], []))
    for s in needle[1:]:
        positions &= set(corpus.index.get(s, []))
        if not positions:
            return []
    hits = []
    for pos in sorted(positions):
        verse = corpus.verses[pos]
        if _contains(verse.stems, needle):
            hits.append(ExactHit(verse=verse, whole_verse=verse.stems == needle))
    return hits


def keyword_candidates(saying: str, k: int = 25) -> List[Verse]:
    words = normalize(saying)
    content = list(dict.fromkeys(
        stem(w) for w in words if w not in STOPWORDS and len(stem(w)) >= 2
    ))
    if not content:
        return []
    saying_stems = tuple(stem(w) for w in words)
    saying_pairs = set(zip(saying_stems, saying_stems[1:]))
    corpus = _corpus()
    matched: Dict[int, int] = defaultdict(int)
    for s in content:
        for pos in corpus.index.get(s, []):
            matched[pos] += 1
    scored = []
    for pos, count in matched.items():
        verse = corpus.verses[pos]
        pairs = len(saying_pairs & set(zip(verse.stems, verse.stems[1:])))
        scored.append((-(count + 0.5 * pairs), pos))
    scored.sort()
    return [corpus.verses[pos] for _, pos in scored[:k]]


def by_ref(ref: str) -> Optional[Verse]:
    return _corpus().by_ref.get(ref)


_APOC_REF_RE = re.compile(r"((?:[1-4] )?[A-Z][A-Za-z]+(?: (?:of|and|the|to) [A-Z]?[A-Za-z]+)*) (\d+):(\d+)(?:\s*-\s*(\d+))?")
_USFM_REF_RE = re.compile(r"^([1-3A-Z][A-Z0-9]{2}) (\d+):(\d+)(?:-(\d+))?$")


def find_refs(text: str, max_range: int = 5) -> List[Verse]:
    from chatbot.router import _find_flexible_verse_refs, _format_reference

    corpus = _corpus()
    found: List[Verse] = []

    def add(verse: Optional[Verse]) -> None:
        if verse is not None and verse not in found:
            found.append(verse)

    for parsed in _find_flexible_verse_refs(text or ""):
        match = _USFM_REF_RE.match(_format_reference(*parsed))
        if not match or match.group(1) not in _USFM_TO_BNUM:
            continue
        bnum, chapter, start = _USFM_TO_BNUM[match.group(1)], int(match.group(2)), int(match.group(3))
        end = int(match.group(4)) if match.group(4) else start
        for v in range(start, min(end, start + max_range - 1) + 1):
            add(corpus.by_bcv.get((bnum, chapter, v)))

    for match in _APOC_REF_RE.finditer(text or ""):
        name = match.group(1).lower()
        book = corpus.apoc_books.get(name) or _APOC_ALIASES.get(name)
        if not book:
            continue
        chapter, start = int(match.group(2)), int(match.group(3))
        end = int(match.group(4)) if match.group(4) else start
        for v in range(start, min(end, start + max_range - 1) + 1):
            add(corpus.by_ref.get(f"{book} {chapter}:{v}"))
    return found


def context(verse: Verse, radius: int = 2) -> List[Verse]:
    verses = _corpus().verses
    lo = max(0, verse.position - radius)
    hi = min(len(verses), verse.position + radius + 1)
    return [
        v for v in verses[lo:hi]
        if v.source == verse.source and v.book == verse.book and v.chapter == verse.chapter
    ]
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pytest tests/chatbot/test_bible_corpus.py -v`
Expected: all PASS. The `&amp;` in the normalize test is deliberate: `&` becomes `and`, and the leftover `amp` is kept as a word.

If a `keyword_candidates` saying misses its verse, print that verse's `stems` alongside the saying's `stems_of(...)` and fix `stem()` for the mismatched word. Do **not** weaken the test.

- [ ] **Step 5: Commit**

```bash
git add chatbot/bible_corpus.py tests/chatbot/test_bible_corpus.py
git commit -m "feat(chatbot): in-memory KJV + Apocrypha corpus for the misquote checker"
```

---

### Task 2: `jev_client` — JEV HTTP client

**Files:**
- Create: `chatbot/jev_client.py`
- Modify: `.env.example` (append the JEV block)
- Test: `tests/chatbot/test_jev_client.py`

**Interfaces:**
- Consumes: `bible_corpus.Verse` (from Task 1).
- Produces:
  - `class JevUnavailable(Exception)`
  - `Judgment` (frozen dataclass): `ref: str, probabilities: Dict[str, float], confidence: float`
  - `OPTIONS: Tuple[str, ...] = ("same_meaning", "meaning_changed", "related_only", "unrelated")`
  - `is_configured() -> bool`
  - `async judge(saying: str, verses: List[Verse], mode: Optional[str] = None) -> List[Judgment]` returns one Judgment per verse, in input order. `mode` is `"batched"` or `"split"`, defaulting to the `MISQUOTE_JEV_MODE` env var or `"batched"`.
  - `_client_factory(timeout: float) -> httpx.AsyncClient`, a module-level hook that tests replace.

- [ ] **Step 1: Write the failing tests**

`tests/chatbot/test_jev_client.py`:

```python
import json

import httpx
import pytest

from chatbot import jev_client
from chatbot.bible_corpus import Verse


def _verse(ref, text="Some verse text."):
    return Verse(ref=ref, text=text, source="canon", book="Proverbs", chapter=1, verse=1, stems=(), position=0)


def _answer(probs, confidence=0.9):
    return {"type": "choice", "choice": max(probs, key=probs.get), "probabilities": probs, "confidence": confidence}


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    monkeypatch.delenv("MISQUOTE_JEV_MODE", raising=False)


def _install(monkeypatch, handler):
    monkeypatch.setattr(
        jev_client, "_client_factory",
        lambda timeout: httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=timeout),
    )


def test_is_configured_follows_the_key(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    assert jev_client.is_configured() is False
    monkeypatch.setenv("TYPESAFE_API_KEY", "  ")
    assert jev_client.is_configured() is False
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    assert jev_client.is_configured() is True


async def test_batched_judge_sends_one_request_with_one_choice_per_verse(configured, monkeypatch):
    seen = []

    def handler(request):
        seen.append(request)
        body = json.loads(request.content)
        probs = {"same_meaning": 0.1, "meaning_changed": 0.8, "related_only": 0.05, "unrelated": 0.05}
        return httpx.Response(200, json={"model": "jev", "answers": {qid: _answer(probs) for qid in body["questions"]}})

    _install(monkeypatch, handler)
    verses = [_verse("1 Timothy 6:10", "For the love of money is the root of all evil."), _verse("Proverbs 13:24")]
    out = await jev_client.judge("Money is the root of all evil", verses)

    assert len(seen) == 1
    req = seen[0]
    assert req.headers["Authorization"] == "Bearer test-key"
    body = json.loads(req.content)
    assert body["state"] == "Money is the root of all evil"
    assert body["model"] == "jev-latest"
    assert list(body["questions"]) == ["c0", "c1"]
    q0 = body["questions"]["c0"]
    assert q0["type"] == "choice"
    assert set(q0["criteria"]) == set(jev_client.OPTIONS)
    assert q0["instructions"]["verse_reference"] == "1 Timothy 6:10"
    assert q0["instructions"]["verse_text"] == "For the love of money is the root of all evil."
    assert [j.ref for j in out] == ["1 Timothy 6:10", "Proverbs 13:24"]
    assert out[0].probabilities["meaning_changed"] == 0.8
    assert out[0].confidence == 0.9


async def test_split_judge_sends_one_request_per_verse_with_verse_in_state(configured, monkeypatch):
    bodies = []

    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        probs = {"same_meaning": 0.7, "meaning_changed": 0.1, "related_only": 0.1, "unrelated": 0.1}
        return httpx.Response(200, json={"answers": {"c0": _answer(probs, 0.7)}})

    _install(monkeypatch, handler)
    out = await jev_client.judge("saying", [_verse("A 1:1", "one"), _verse("B 1:1", "two")], mode="split")
    assert len(bodies) == 2
    assert {b["state"]["verse"] for b in bodies} == {"A 1:1: one", "B 1:1: two"}
    assert all(b["state"]["saying"] == "saying" for b in bodies)
    assert [j.ref for j in out] == ["A 1:1", "B 1:1"]


async def test_http_error_raises_unavailable(configured, monkeypatch):
    _install(monkeypatch, lambda request: httpx.Response(529, json={"error": "overloaded"}))
    with pytest.raises(jev_client.JevUnavailable):
        await jev_client.judge("s", [_verse("A 1:1")])


async def test_network_error_raises_unavailable(configured, monkeypatch):
    def handler(request):
        raise httpx.ConnectTimeout("slow")

    _install(monkeypatch, handler)
    with pytest.raises(jev_client.JevUnavailable):
        await jev_client.judge("s", [_verse("A 1:1")])


async def test_missing_answer_raises_unavailable(configured, monkeypatch):
    _install(monkeypatch, lambda request: httpx.Response(200, json={"answers": {}}))
    with pytest.raises(jev_client.JevUnavailable):
        await jev_client.judge("s", [_verse("A 1:1")])


async def test_answer_without_probabilities_raises_unavailable(configured, monkeypatch):
    _install(monkeypatch, lambda request: httpx.Response(200, json={"answers": {"c0": {"type": "choice", "confidence": 0.9}}}))
    with pytest.raises(jev_client.JevUnavailable):
        await jev_client.judge("s", [_verse("A 1:1")])


async def test_unconfigured_raises_unavailable_without_a_request(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)

    def handler(request):
        raise AssertionError("must not call JEV without a key")

    _install(monkeypatch, handler)
    with pytest.raises(jev_client.JevUnavailable):
        await jev_client.judge("s", [_verse("A 1:1")])


async def test_empty_verse_list_makes_no_request(configured, monkeypatch):
    def handler(request):
        raise AssertionError("no request for zero verses")

    _install(monkeypatch, handler)
    assert await jev_client.judge("s", []) == []
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pytest tests/chatbot/test_jev_client.py -v`
Expected: FAIL with `ImportError: cannot import name 'jev_client'`.

- [ ] **Step 3: Implement `chatbot/jev_client.py`**

```python
"""Thin async client for TypeSafe's JEV "System One" model
(https://docs.typesafe.ai/api.md), used by the misquote checker.

Plain httpx against the documented HTTP contract rather than typesafe-sdk:
the SDK's response attributes are only partly documented, and httpx is
already a dependency. Every failure — no key, HTTP/network error, non-2xx
(401/422/429/529), timeout, malformed body — raises JevUnavailable; callers
never get a partial result."""

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx

from chatbot.bible_corpus import Verse

OPTIONS: Tuple[str, ...] = ("same_meaning", "meaning_changed", "related_only", "unrelated")
_SPLIT_CONCURRENCY = 8

CRITERIA: Dict[str, Any] = {
    "same_meaning": {
        "what": "The verse says what the saying says, possibly in different, condensed or modernized words.",
        "examples": ["'Pride comes before a fall' vs 'Pride goeth before destruction, and an haughty spirit before a fall.'"],
    },
    "meaning_changed": {
        "what": "The verse is clearly the source of the saying, but the saying drops or alters words so its meaning shifts.",
        "examples": ["'Money is the root of all evil' vs 'For the love of money is the root of all evil.'"],
    },
    "related_only": {
        "what": "The verse is on the same topic as the saying but is not where the saying comes from.",
        "examples": ["'God helps those who help themselves' vs a verse about God helping the needy."],
    },
    "unrelated": {
        "what": "The verse has no real connection to the saying.",
        "examples": [],
    },
}


class JevUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Judgment:
    ref: str
    probabilities: Dict[str, float]
    confidence: float


def is_configured() -> bool:
    return bool(os.getenv("TYPESAFE_API_KEY", "").strip())


def _client_factory(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout)


def _question(verse: Verse, verse_in_state: bool) -> Dict[str, Any]:
    if verse_in_state:
        instructions: Any = "How does the verse in the state relate to the saying in the state?"
    else:
        instructions = {
            "what": "How does this verse relate to the saying in the state?",
            "verse_reference": verse.ref,
            "verse_text": verse.text,
        }
    return {"type": "choice", "instructions": instructions, "criteria": CRITERIA}


def _parse(answer: Any, ref: str) -> Judgment:
    try:
        raw = answer["probabilities"]
        probabilities = {option: float(raw.get(option, 0.0)) for option in OPTIONS}
        confidence = float(answer["confidence"])
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise JevUnavailable(f"malformed JEV answer for {ref}") from exc
    return Judgment(ref=ref, probabilities=probabilities, confidence=confidence)


async def _post(client: httpx.AsyncClient, body: Dict[str, Any]) -> Dict[str, Any]:
    url = os.getenv("TYPESAFE_API_URL", "https://api.typesafe.ai/v1/systemone")
    headers = {"Authorization": f"Bearer {os.getenv('TYPESAFE_API_KEY', '').strip()}"}
    try:
        response = await client.post(url, json=body, headers=headers)
        response.raise_for_status()
        answers = response.json()["answers"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise JevUnavailable(str(exc) or type(exc).__name__) from exc
    if not isinstance(answers, dict):
        raise JevUnavailable("JEV response has no answers object")
    return answers


async def judge(saying: str, verses: List[Verse], mode: Optional[str] = None) -> List[Judgment]:
    if not is_configured():
        raise JevUnavailable("TYPESAFE_API_KEY is not set")
    if not verses:
        return []
    mode = mode or os.getenv("MISQUOTE_JEV_MODE", "batched")
    model = os.getenv("TYPESAFE_MODEL", "jev-latest")
    timeout = float(os.getenv("MISQUOTE_JEV_TIMEOUT", "10"))

    async with _client_factory(timeout) as client:
        if mode == "split":
            semaphore = asyncio.Semaphore(_SPLIT_CONCURRENCY)

            async def one(verse: Verse) -> Judgment:
                body = {
                    "state": {"saying": saying, "verse": f"{verse.ref}: {verse.text}"},
                    "model": model,
                    "questions": {"c0": _question(verse, verse_in_state=True)},
                }
                async with semaphore:
                    answers = await _post(client, body)
                return _parse(answers.get("c0"), verse.ref)

            return list(await asyncio.gather(*(one(v) for v in verses)))

        body = {
            "state": saying,
            "model": model,
            "questions": {f"c{i}": _question(v, verse_in_state=False) for i, v in enumerate(verses)},
        }
        answers = await _post(client, body)
        return [_parse(answers.get(f"c{i}"), v.ref) for i, v in enumerate(verses)]
```

- [ ] **Step 4: Append the JEV block to `.env.example`**

Add at the end of `.env.example`:

```bash
# --- "Is that in the Bible?" (misquote mode) — TypeSafe JEV classifier ---
# https://console.typesafe.ai/keys. Leave empty to disable the mode (its
# tile is hidden and freeform "is 'X' in the Bible?" detection is skipped).
# Put the real value only in .env, never in .env.example.
TYPESAFE_API_KEY=
TYPESAFE_MODEL=jev-latest
# Seconds before a JEV call counts as unavailable.
MISQUOTE_JEV_TIMEOUT=10
# batched = one request with one question per candidate; split = one
# request per candidate (8 at a time). Chosen by scripts/eval_misquote.py.
MISQUOTE_JEV_MODE=batched
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pytest tests/chatbot/test_jev_client.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add chatbot/jev_client.py tests/chatbot/test_jev_client.py .env.example
git commit -m "feat(chatbot): JEV HTTP client for the misquote checker"
```

---

### Task 3: `misquote_verdict` — pure verdict function

**Files:**
- Create: `chatbot/misquote_verdict.py`
- Test: `tests/chatbot/test_misquote_verdict.py`

**Interfaces:**
- Consumes: `bible_corpus.Verse`, `jev_client.Judgment`.
- Produces:
  - `Candidate` (frozen dataclass): `verse: Verse, exact: bool` (`exact` = a partial exact hit)
  - `Verdict` (frozen dataclass): `verdict: str, sub_label: Optional[str], confidence_label: Optional[str], sources: List[Verse], related: List[Verse]`
  - constants `SOURCE_MIN`, `CONFIDENCE_MIN`, `NOT_IN_BIBLE_MAX`, `CONFIDENT_LABEL_MIN`, `RELATED_MIN`
  - `verdict_from(whole_hits: List[Verse], candidates: List[Candidate], judgments: Dict[str, Judgment]) -> Verdict`, where `judgments` is keyed by `Verse.ref`

- [ ] **Step 1: Write the failing tests**

`tests/chatbot/test_misquote_verdict.py`:

```python
from chatbot.bible_corpus import Verse
from chatbot.jev_client import Judgment
from chatbot.misquote_verdict import Candidate, verdict_from


def V(ref, source="canon"):
    return Verse(ref=ref, text=f"text of {ref}", source=source, book="B", chapter=1, verse=1, stems=(), position=0)


def J(ref, same=0.0, changed=0.0, related=0.0, unrelated=None, confidence=0.9):
    if unrelated is None:
        unrelated = max(0.0, 1.0 - same - changed - related)
    return Judgment(ref=ref, probabilities={
        "same_meaning": same, "meaning_changed": changed, "related_only": related, "unrelated": unrelated,
    }, confidence=confidence)


def run(cands, judgments, whole=()):
    return verdict_from(list(whole), cands, {j.ref: j for j in judgments})


def test_canonical_whole_verse_hit_is_verbatim_without_judgments():
    v = run([], [], whole=[V("John 11:35")])
    assert (v.verdict, v.sub_label, v.confidence_label) == ("verbatim", None, "Confident")
    assert [s.ref for s in v.sources] == ["John 11:35"]


def test_canon_whole_hit_beats_apocrypha_whole_hit():
    v = run([], [], whole=[V("Tobit 1:1", "apocrypha"), V("John 11:35")])
    assert v.verdict == "verbatim"
    assert [s.ref for s in v.sources] == ["John 11:35"]


def test_apocrypha_only_whole_hit():
    v = run([], [], whole=[V("Tobit 1:1", "apocrypha")])
    assert (v.verdict, v.sub_label) == ("apocrypha_only", "verbatim")


def test_paraphrase_when_same_meaning_wins():
    c = [Candidate(V("Proverbs 16:18"), exact=False)]
    v = run(c, [J("Proverbs 16:18", same=0.8, changed=0.1, confidence=0.9)])
    assert (v.verdict, v.confidence_label) == ("paraphrase", "Confident")


def test_distorted_when_meaning_changed_wins():
    c = [Candidate(V("1 Timothy 6:10"), exact=True)]
    v = run(c, [J("1 Timothy 6:10", same=0.2, changed=0.7, confidence=0.7)])
    assert (v.verdict, v.confidence_label) == ("distorted", "Fairly sure")


def test_partial_exact_hit_with_same_meaning_is_verbatim():
    c = [Candidate(V("Proverbs 9:10"), exact=True)]
    v = run(c, [J("Proverbs 9:10", same=0.9, changed=0.05)])
    assert v.verdict == "verbatim"


def test_tie_between_same_and_changed_is_distorted():
    c = [Candidate(V("A 1:1"), exact=False)]
    v = run(c, [J("A 1:1", same=0.4, changed=0.4, confidence=0.7)])
    assert v.verdict == "distorted"


def test_source_threshold_edge_is_inclusive():
    c = [Candidate(V("A 1:1"), exact=False)]
    assert run(c, [J("A 1:1", same=0.70, confidence=0.60)]).verdict == "paraphrase"
    assert run(c, [J("A 1:1", same=0.69, confidence=0.9)]).verdict == "unclear"


def test_low_confidence_blocks_a_source_verdict():
    c = [Candidate(V("A 1:1"), exact=False)]
    assert run(c, [J("A 1:1", same=0.9, confidence=0.59)]).verdict == "unclear"


def test_apocrypha_candidate_used_only_when_canon_fails():
    c = [Candidate(V("A 1:1"), exact=False), Candidate(V("Tobit 4:15", "apocrypha"), exact=False)]
    v = run(c, [J("A 1:1", related=0.9), J("Tobit 4:15", same=0.85)])
    assert (v.verdict, v.sub_label) == ("apocrypha_only", "paraphrase")
    v2 = run(c, [J("A 1:1", same=0.8), J("Tobit 4:15", same=0.95)])
    assert v2.verdict == "paraphrase"
    assert v2.sources[0].ref == "A 1:1"


def test_additional_sources_are_the_next_two_above_threshold():
    c = [Candidate(V(r), exact=False) for r in ["A 1:1", "B 1:1", "C 1:1", "D 1:1", "E 1:1"]]
    js = [J("A 1:1", same=0.75), J("B 1:1", same=0.9), J("C 1:1", same=0.72), J("D 1:1", same=0.71), J("E 1:1", same=0.1)]
    v = run(c, js)
    assert [s.ref for s in v.sources] == ["B 1:1", "A 1:1", "C 1:1"]
    assert v.related == []


def test_not_in_bible_shows_only_clearly_related_verses():
    c = [Candidate(V(r), exact=False) for r in ["A 1:1", "B 1:1", "C 1:1", "D 1:1", "E 1:1"]]
    js = [
        J("A 1:1", related=0.6), J("B 1:1", related=0.9), J("C 1:1", related=0.4),
        J("D 1:1", related=0.7, same=0.2), J("E 1:1", related=0.55),
    ]
    v = run(c, js)
    assert (v.verdict, v.confidence_label, v.sources) == ("not_in_bible", None, [])
    assert [r.ref for r in v.related] == ["B 1:1", "D 1:1", "A 1:1"]


def test_not_in_bible_with_no_candidates():
    v = run([], [])
    assert (v.verdict, v.related) == ("not_in_bible", [])


def test_unclear_shows_top_three_by_source():
    c = [Candidate(V(r), exact=False) for r in ["A 1:1", "B 1:1", "C 1:1", "D 1:1"]]
    js = [J("A 1:1", same=0.3), J("B 1:1", same=0.5), J("C 1:1", same=0.1), J("D 1:1", changed=0.4)]
    v = run(c, js)
    assert v.verdict == "unclear"
    assert [r.ref for r in v.related] == ["B 1:1", "D 1:1", "A 1:1"]


def test_candidates_without_a_judgment_are_ignored():
    c = [Candidate(V("A 1:1"), exact=False), Candidate(V("B 1:1"), exact=False)]
    v = run(c, [J("B 1:1", same=0.9)])
    assert v.sources[0].ref == "B 1:1"
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pytest tests/chatbot/test_misquote_verdict.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'chatbot.misquote_verdict'`.

- [ ] **Step 3: Implement `chatbot/misquote_verdict.py`**

```python
"""Pure verdict logic for the misquote checker: JEV judgments in, one of
six verdicts out. No I/O, so every branch and threshold edge is unit-tested.
Thresholds are starting points — tune them with scripts/eval_misquote.py,
erring toward `unclear`: calling a made-up saying scripture is the worst
error this mode can make."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from chatbot.bible_corpus import Verse
from chatbot.jev_client import Judgment

SOURCE_MIN = 0.70
CONFIDENCE_MIN = 0.60
NOT_IN_BIBLE_MAX = 0.20
CONFIDENT_LABEL_MIN = 0.85
RELATED_MIN = 0.5


@dataclass(frozen=True)
class Candidate:
    verse: Verse
    exact: bool  # a partial word-for-word hit, still judged by JEV


@dataclass(frozen=True)
class Verdict:
    verdict: str
    sub_label: Optional[str]
    confidence_label: Optional[str]
    sources: List[Verse] = field(default_factory=list)
    related: List[Verse] = field(default_factory=list)


def _source(j: Judgment) -> float:
    return j.probabilities.get("same_meaning", 0.0) + j.probabilities.get("meaning_changed", 0.0)


def _label(candidate: Candidate, j: Judgment) -> str:
    if j.probabilities.get("meaning_changed", 0.0) >= j.probabilities.get("same_meaning", 0.0):
        return "distorted"
    return "verbatim" if candidate.exact else "paraphrase"


def _confidence_label(j: Judgment) -> str:
    return "Confident" if j.confidence >= CONFIDENT_LABEL_MIN else "Fairly sure"


def verdict_from(
    whole_hits: List[Verse],
    candidates: List[Candidate],
    judgments: Dict[str, Judgment],
) -> Verdict:
    canon_whole = [v for v in whole_hits if v.source == "canon"]
    if canon_whole:
        return Verdict("verbatim", None, "Confident", canon_whole[:3], [])
    apoc_whole = [v for v in whole_hits if v.source == "apocrypha"]
    if apoc_whole:
        return Verdict("apocrypha_only", "verbatim", "Confident", apoc_whole[:3], [])

    judged: List[Tuple[Candidate, Judgment]] = [
        (c, judgments[c.verse.ref]) for c in candidates if c.verse.ref in judgments
    ]

    for source_kind in ("canon", "apocrypha"):
        pool = sorted(
            [(c, j) for c, j in judged if c.verse.source == source_kind],
            key=lambda cj: -_source(cj[1]),
        )
        if not pool:
            continue
        best_c, best_j = pool[0]
        if _source(best_j) >= SOURCE_MIN and best_j.confidence >= CONFIDENCE_MIN:
            label = _label(best_c, best_j)
            extra = [c.verse for c, j in pool[1:] if _source(j) >= SOURCE_MIN][:2]
            sources = [best_c.verse] + extra
            if source_kind == "canon":
                return Verdict(label, None, _confidence_label(best_j), sources, [])
            return Verdict("apocrypha_only", label, _confidence_label(best_j), sources, [])

    if all(_source(j) <= NOT_IN_BIBLE_MAX for _, j in judged):
        related = sorted(
            [(c, j) for c, j in judged if j.probabilities.get("related_only", 0.0) >= RELATED_MIN],
            key=lambda cj: -cj[1].probabilities["related_only"],
        )[:3]
        return Verdict("not_in_bible", None, None, [], [c.verse for c, _ in related])

    top = sorted(judged, key=lambda cj: -_source(cj[1]))[:3]
    return Verdict("unclear", None, None, [], [c.verse for c, _ in top])
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pytest tests/chatbot/test_misquote_verdict.py -v`
Expected: all PASS. The `not_in_bible` test's candidate D has `same=0.2`, which is ≤ 0.20, so every candidate still qualifies.

- [ ] **Step 5: Commit**

```bash
git add chatbot/misquote_verdict.py tests/chatbot/test_misquote_verdict.py
git commit -m "feat(chatbot): pure verdict logic for the misquote checker"
```

---

### Task 4: `misquote.check` — orchestration

**Files:**
- Create: `chatbot/misquote.py`
- Test: `tests/chatbot/test_misquote_check.py`

**Interfaces:**
- Consumes: Task 1 (`bible_corpus.exact_match`, `keyword_candidates`, `find_refs`, `normalize`), Task 2 (`jev_client.is_configured`, `judge`, `JevUnavailable`), Task 3 (`Candidate`, `Verdict`, `verdict_from`), and `chatbot.ollama_client.simple_completion`.
- Produces:
  - constants `MAX_SAYING_CHARS = 300`, `MAX_CANDIDATES = 30`, `KEYWORD_K = 25`, `MAX_PARTIAL_HITS = 5`, `PARTIAL_MIN_WORDS = 4`, `UNAVAILABLE_MESSAGE`, `LENGTH_MESSAGE`, `EXAMPLE_SAYINGS: List[str]`
  - `async suggest_refs(saying: str) -> List[Verse]` (fails open to `[]`)
  - `async check(saying: str) -> Dict[str, Any]`, a chat response dict: `{"type": "chat", "message", "data": None, "route", "artifacts": [misquote link] | absent, "follow_up_questions": []}`
  - `artifact_params(saying: str, verdict: Verdict) -> Dict[str, Any]`, matching the spec's params shape

- [ ] **Step 1: Write the failing tests**

`tests/chatbot/test_misquote_check.py`:

```python
"""misquote.check() end to end with fake JEV and LLM responses (the real corpus
is used — it's local)."""

import pytest

from chatbot import jev_client, misquote
from chatbot.jev_client import Judgment


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")


def fake_llm(monkeypatch, reply):
    calls = []

    async def fake(system_prompt, user_prompt, *, max_tokens=2048, timeout=60.0):
        calls.append(user_prompt)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(misquote, "simple_completion", fake)
    return calls


def fake_jev(monkeypatch, decide=None, error=False):
    """decide(ref) -> dict of option probabilities (default: unrelated)."""
    calls = []

    async def fake(saying, verses, mode=None):
        calls.append([v.ref for v in verses])
        if error:
            raise jev_client.JevUnavailable("down")
        out = []
        for v in verses:
            probs = (decide(v.ref) if decide else None) or {"unrelated": 1.0}
            full = {o: probs.get(o, 0.0) for o in jev_client.OPTIONS}
            out.append(Judgment(ref=v.ref, probabilities=full, confidence=0.9))
        return out

    monkeypatch.setattr(misquote.jev_client, "judge", fake)
    return calls


def params(result):
    [link] = result["artifacts"]
    assert link["type"] == "misquote"
    assert link["label"] == "View check ▸"
    return link["params"]


async def test_whole_verse_hit_is_verbatim_without_calling_jev_or_llm(monkeypatch):
    jev = fake_jev(monkeypatch)
    llm = fake_llm(monkeypatch, "John 11:35")
    result = await misquote.check("Jesus wept")
    p = params(result)
    assert (p["verdict"], p["confidence_label"]) == ("verbatim", "Confident")
    assert p["verses"] == [{"ref": "John 11:35", "text": "Jesus wept.", "source": "canon", "role": "source"}]
    assert result["message"].startswith("**Word for word**")
    assert "John 11:35" in result["message"]
    assert jev == [] and llm == []
    assert result["follow_up_questions"] == []


async def test_partial_hit_goes_to_jev_and_can_be_distorted(monkeypatch):
    fake_llm(monkeypatch, "1 Timothy 6:10")
    jev = fake_jev(monkeypatch, lambda ref: {"meaning_changed": 0.8, "same_meaning": 0.1} if ref == "1 Timothy 6:10" else None)
    result = await misquote.check("Money is the root of all evil")
    p = params(result)
    assert p["verdict"] == "distorted"
    assert p["verses"][0]["ref"] == "1 Timothy 6:10"
    assert jev[0][0] == "1 Timothy 6:10"  # partial exact hits are listed first
    assert result["message"].startswith("**Distorted**")


async def test_llm_suggestions_are_verified_and_listed_before_keywords(monkeypatch):
    fake_llm(monkeypatch, "Maybe Proverbs 13:24 or Hezekiah 4:1")
    jev = fake_jev(monkeypatch, lambda ref: {"same_meaning": 0.85} if ref == "Proverbs 13:24" else None)
    result = await misquote.check("Spare the rod, spoil the child")
    assert params(result)["verdict"] == "paraphrase"
    sent = jev[0]
    assert sent[0] == "Proverbs 13:24"
    assert "Hezekiah 4:1" not in sent
    assert len(sent) == len(set(sent))  # deduped
    assert len(sent) <= misquote.MAX_CANDIDATES


async def test_llm_failure_falls_back_to_keywords(monkeypatch):
    fake_llm(monkeypatch, "")
    jev = fake_jev(monkeypatch, lambda ref: {"same_meaning": 0.85} if ref == "Proverbs 13:24" else None)
    result = await misquote.check("Spare the rod, spoil the child")
    assert params(result)["verdict"] == "paraphrase"
    assert "Proverbs 13:24" in jev[0]


async def test_llm_exception_falls_back_to_keywords(monkeypatch):
    fake_llm(monkeypatch, RuntimeError("boom"))
    fake_jev(monkeypatch)
    result = await misquote.check("God helps those who help themselves")
    assert params(result)["verdict"] == "not_in_bible"


async def test_jev_failure_gives_the_unavailable_message(monkeypatch):
    fake_llm(monkeypatch, "NONE")
    fake_jev(monkeypatch, error=True)
    result = await misquote.check("God helps those who help themselves")
    assert result["message"] == misquote.UNAVAILABLE_MESSAGE
    assert "artifacts" not in result


async def test_missing_key_gives_the_unavailable_message_before_any_work(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY")
    llm = fake_llm(monkeypatch, "Proverbs 13:24")
    result = await misquote.check("Spare the rod, spoil the child")
    assert result["message"] == misquote.UNAVAILABLE_MESSAGE
    assert llm == []


@pytest.mark.parametrize("saying", ["", "   ", "x" * 301])
async def test_bad_length_gets_the_length_message(monkeypatch, saying):
    llm = fake_llm(monkeypatch, "")
    result = await misquote.check(saying)
    assert result["message"] == misquote.LENGTH_MESSAGE
    assert llm == []


@pytest.mark.parametrize("saying", ["???", "🙏🙏", "12345"])
async def test_saying_without_words_gets_length_message(monkeypatch, saying):
    llm = fake_llm(monkeypatch, "")
    result = await misquote.check(saying)
    assert result["message"] == misquote.LENGTH_MESSAGE
    assert llm == []


async def test_common_phrase_caps_partial_hits_and_candidates(monkeypatch):
    fake_llm(monkeypatch, "NONE")
    jev = fake_jev(monkeypatch)
    await misquote.check("the Lord is good")
    sent = jev[0]
    assert len(sent) <= misquote.MAX_CANDIDATES


async def test_short_sayings_do_not_use_partial_exact_hits(monkeypatch):
    fake_llm(monkeypatch, "NONE")
    jev = fake_jev(monkeypatch)
    await misquote.check("the Lord")  # 2 words: below PARTIAL_MIN_WORDS
    assert jev == [] or len(jev[0]) <= misquote.KEYWORD_K


async def test_apocrypha_only_result_is_tagged(monkeypatch):
    fake_llm(monkeypatch, "Ecclesiasticus 31:27")
    fake_jev(monkeypatch, lambda ref: {"same_meaning": 0.9} if ref == "Ecclesiasticus 31:27" else None)
    result = await misquote.check("Wine is as good as life to a man, if it be drunk moderately")
    p = params(result)
    assert (p["verdict"], p["sub_label"]) == ("apocrypha_only", "verbatim")
    assert p["verses"][0]["source"] == "apocrypha"


async def test_not_in_bible_lists_related_verses_with_related_role(monkeypatch):
    fake_llm(monkeypatch, "NONE")
    fake_jev(monkeypatch, lambda ref: {"related_only": 0.8})
    result = await misquote.check("God helps those who help themselves")
    p = params(result)
    assert p["verdict"] == "not_in_bible"
    assert 1 <= len(p["verses"]) <= 3
    assert all(v["role"] == "related" for v in p["verses"])
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pytest tests/chatbot/test_misquote_check.py -v`
Expected: FAIL with `ImportError: cannot import name 'misquote'`.

- [ ] **Step 3: Implement `chatbot/misquote.py`** (check-related parts; Task 5 adds to this file)

```python
""""Is that in the Bible?" (internal id `misquote`): checks whether a saying
is really in the Bible. See
docs/superpowers/specs/2026-09-26-misquote-mode-design.md.

Candidates come from bible_corpus (exact + keyword) plus one LLM
suggestion call; JEV judges every candidate; misquote_verdict decides.
The LLM never decides a verdict, and no verdict is ever given without JEV
(except a whole-verse word-for-word hit, which needs no judgment)."""

import asyncio
import logging
from typing import Any, Dict, List

from chatbot import bible_corpus, jev_client
from chatbot.bible_corpus import Verse
from chatbot.misquote_verdict import Candidate, Verdict, verdict_from
from chatbot.ollama_client import simple_completion

logger = logging.getLogger(__name__)

MAX_SAYING_CHARS = 300
MAX_CANDIDATES = 30
KEYWORD_K = 25
MAX_PARTIAL_HITS = 5
PARTIAL_MIN_WORDS = 4

UNAVAILABLE_MESSAGE = "The checker is unavailable right now. Please try again later."
LENGTH_MESSAGE = "Please give me just the saying, under about 300 characters."

EXAMPLE_SAYINGS = [
    "Money is the root of all evil",
    "God helps those who help themselves",
    "Spare the rod, spoil the child",
    "This too shall pass",
]

_BUBBLES = {
    "verbatim": "**Word for word**: this is in the Bible.",
    "paraphrase": "**Paraphrase**: the Bible says this, in different words.",
    "distorted": "**Distorted**: this is a real verse, but the saying changes its meaning.",
    "apocrypha_only": "**In the Apocrypha only**: this comes from the Apocrypha, not the 66-book canon.",
    "not_in_bible": "**Not in the Bible**: I couldn't find this saying in the Bible.",
    "unclear": "**Unclear**: I can't say for sure. These are the closest verses.",
}

_SUGGEST_SYSTEM = "You are a concise Bible reference assistant."


def _chat(message: str, route: str) -> Dict[str, Any]:
    return {"type": "chat", "message": message, "data": None, "route": route, "follow_up_questions": []}


def _verse_param(verse: Verse, role: str) -> Dict[str, str]:
    return {"ref": verse.ref, "text": verse.text, "source": verse.source, "role": role}


def artifact_params(saying: str, verdict: Verdict) -> Dict[str, Any]:
    return {
        "saying": saying,
        "verdict": verdict.verdict,
        "sub_label": verdict.sub_label,
        "confidence_label": verdict.confidence_label,
        "verses": [_verse_param(v, "source") for v in verdict.sources]
        + [_verse_param(v, "related") for v in verdict.related],
    }


def _result(saying: str, verdict: Verdict, route: str) -> Dict[str, Any]:
    message = _BUBBLES[verdict.verdict]
    if verdict.sources:
        message += f" *{verdict.sources[0].ref}*"
    result = _chat(message, route)
    result["artifacts"] = [{"type": "misquote", "label": "View check ▸", "params": artifact_params(saying, verdict)}]
    return result


async def suggest_refs(saying: str) -> List[Verse]:
    ask = (
        f"Saying: '{saying}'\n\n"
        "Which Bible verses (including the Apocrypha), if any, might this saying "
        "come from or be based on? Reply with up to five references only, "
        "using full book names, e.g. `Proverbs 13:24; 1 Timothy 6:10`, or `NONE`."
    )
    try:
        reply = await simple_completion(_SUGGEST_SYSTEM, ask, max_tokens=120, timeout=20.0)
    except Exception:  # noqa: BLE001 — suggestions are optional; fail open
        logger.warning("misquote: suggestion call failed", exc_info=True)
        return []
    if not reply or reply.strip().upper().startswith("NONE"):
        return []
    return await asyncio.to_thread(bible_corpus.find_refs, reply)


def _merge(partial: List[Verse], suggested: List[Verse], keyword: List[Verse]) -> List[Candidate]:
    seen = set()
    merged: List[Candidate] = []
    partial_refs = {v.ref for v in partial}
    for verse in partial + suggested + keyword:
        if verse.ref in seen:
            continue
        seen.add(verse.ref)
        merged.append(Candidate(verse=verse, exact=verse.ref in partial_refs))
        if len(merged) == MAX_CANDIDATES:
            break
    return merged


async def check(saying: str) -> Dict[str, Any]:
    saying = (saying or "").strip()
    if not saying or len(saying) > MAX_SAYING_CHARS or not bible_corpus.normalize(saying):
        return _chat(LENGTH_MESSAGE, "misquote → bad length")
    if not jev_client.is_configured():
        return _chat(UNAVAILABLE_MESSAGE, "misquote → JEV unconfigured")

    hits = await asyncio.to_thread(bible_corpus.exact_match, saying)
    whole = [h.verse for h in hits if h.whole_verse]
    if whole:
        return _result(saying, verdict_from(whole, [], {}), "misquote → whole-verse exact match")

    word_count = len(bible_corpus.normalize(saying))
    partial = [h.verse for h in hits][:MAX_PARTIAL_HITS] if word_count >= PARTIAL_MIN_WORDS else []

    suggested, keyword = await asyncio.gather(
        suggest_refs(saying),
        asyncio.to_thread(bible_corpus.keyword_candidates, saying, KEYWORD_K),
    )
    candidates = _merge(partial, suggested, keyword)
    if not candidates:
        return _result(saying, verdict_from([], [], {}), "misquote → no candidates")

    try:
        judgments = await jev_client.judge(saying, [c.verse for c in candidates])
    except jev_client.JevUnavailable:
        logger.warning("misquote: JEV unavailable", exc_info=True)
        return _chat(UNAVAILABLE_MESSAGE, "misquote → JEV unavailable")

    verdict = verdict_from([], candidates, {j.ref: j for j in judgments})
    return _result(saying, verdict, f"misquote → JEV ({len(candidates)} candidates)")
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pytest tests/chatbot/test_misquote_check.py -v`
Expected: all PASS.

If `test_apocrypha_only_result_is_tagged` fails because a canonical partial hit outranks the Apocrypha verse, inspect the returned `verses`. The fake JEV marks only `Ecclesiasticus 31:27` as a source, so the verdict must be `apocrypha_only`. Fix the code, not the test.

- [ ] **Step 5: Commit**

```bash
git add chatbot/misquote.py tests/chatbot/test_misquote_check.py
git commit -m "feat(chatbot): misquote check orchestration (corpus + LLM suggestions + JEV)"
```

---

### Task 5: Saying extraction, primer, and Explain in `misquote.py`

**Files:**
- Modify: `chatbot/misquote.py`, adding `extract_saying`, `primer`, `explain` and `EXPLAIN_FAILED`
- Test: add to `tests/chatbot/test_misquote_check.py`

**Interfaces:**
- Consumes: `bible_corpus.by_ref`, `bible_corpus.context`, `chatbot.wiki_refs.resolve_scripture_refs`, `simple_completion`.
- Produces:
  - `extract_saying(message: str) -> Optional[str]`
  - `primer() -> Dict[str, Any]`: a chat dict with `follow_up_questions == EXAMPLE_SAYINGS`
  - `async explain(params: Dict[str, Any]) -> str`: markdown, or `EXPLAIN_FAILED`
  - `EXPLAIN_FAILED = "I couldn't explain this one right now."`

- [ ] **Step 1: Write the failing tests** (append to `tests/chatbot/test_misquote_check.py`)

```python
@pytest.mark.parametrize("message, saying", [
    ('Is "money is the root of all evil" in the Bible?', "money is the root of all evil"),
    ("Is “God helps those who help themselves” in the Bible?", "God helps those who help themselves"),
    ("Where does the Bible say 'spare the rod, spoil the child'?", "spare the rod, spoil the child"),
    ("Does the Bible really say that God helps those who help themselves?", "God helps those who help themselves"),
    ("is it in the bible that cleanliness is next to godliness", "cleanliness is next to godliness"),
    ("Is it biblical that money is the root of all evil?", "money is the root of all evil"),
])
def test_extract_saying_finds_sayings(message, saying):
    assert misquote.extract_saying(message) == saying


@pytest.mark.parametrize("message", [
    "Does the Bible say anything about divorce?",
    "What does the Bible say about money?",
    "Is John 3:16 in the Bible?",
    'Search for "lovingkindness"',
    'Is "love" in the Bible?',  # fewer than 3 words
    "Tell me about 'the prodigal son' parable",  # quoted, but no Bible mention
])
def test_extract_saying_ignores_topic_questions(message):
    assert misquote.extract_saying(message) is None


def test_primer_offers_the_example_sayings():
    p = misquote.primer()
    assert p["message"] == "Type a saying and I'll check whether it's really in the Bible."
    assert p["follow_up_questions"] == misquote.EXAMPLE_SAYINGS
    assert "artifacts" not in p


async def test_explain_grounds_on_context_and_links_references(monkeypatch):
    calls = fake_llm(monkeypatch, "Paul wrote this in 1 Timothy 6:10 about **the love of** money.")
    out = await misquote.explain({
        "saying": "Money is the root of all evil",
        "verdict": "distorted",
        "verses": [{"ref": "1 Timothy 6:10", "text": "…", "source": "canon", "role": "source"}],
    })
    prompt = calls[0]
    assert "1 Timothy 6:9" in prompt and "1 Timothy 6:11" in prompt  # ±2 context loaded
    assert "Money is the root of all evil" in prompt
    assert "](/explorer" in out  # scripture refs linked


async def test_explain_failure_is_honest(monkeypatch):
    fake_llm(monkeypatch, "")
    out = await misquote.explain({"saying": "x y z", "verdict": "not_in_bible", "verses": []})
    assert out == misquote.EXPLAIN_FAILED


async def test_explain_ignores_unknown_verse_refs(monkeypatch):
    calls = fake_llm(monkeypatch, "Some explanation.")
    out = await misquote.explain({
        "saying": "a saying here", "verdict": "unclear",
        "verses": [{"ref": "Hezekiah 1:1", "text": "fake", "source": "canon", "role": "related"}],
    })
    assert "fake" not in calls[0]
    assert out == "Some explanation."
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pytest tests/chatbot/test_misquote_check.py -v -k "extract or primer or explain"`
Expected: FAIL with `AttributeError: module 'chatbot.misquote' has no attribute 'extract_saying'`.

- [ ] **Step 3: Implement**

Add to the imports at the top of `chatbot/misquote.py`:

```python
import re
from typing import Optional

from chatbot import wiki_refs
```

Append to `chatbot/misquote.py`:

```python
EXPLAIN_FAILED = "I couldn't explain this one right now."

# Deliberately narrow: "does the Bible say anything about divorce?" is a
# topic question, not a saying to check, and must fall through to chat.
_BIBLE_MENTION_RE = re.compile(r"\b(?:bible|scriptures?|biblical)\b", re.IGNORECASE)
_DOUBLE_QUOTED_RE = re.compile(r"[\"“]([^\"“”]+)[\"”]")
_SINGLE_QUOTED_RE = re.compile(r"(?<![\w])['‘]([^'‘’]+)['’](?![\w])")
_UNQUOTED_RES = [
    re.compile(r"^\s*(?:does|did)\s+the\s+bible\s+(?:really\s+|actually\s+)?say\s+that\s+(.+?)[\s?.!]*$", re.IGNORECASE),
    re.compile(r"^\s*is\s+it\s+(?:really\s+|actually\s+)?in\s+the\s+bible\s+that\s+(.+?)[\s?.!]*$", re.IGNORECASE),
    re.compile(r"^\s*is\s+it\s+(?:really\s+|actually\s+)?biblical\s+that\s+(.+?)[\s?.!]*$", re.IGNORECASE),
]


def _clean(saying: str) -> str:
    return saying.strip().strip("\"'“”‘’").strip().rstrip("?").strip()


def extract_saying(message: str) -> Optional[str]:
    text = (message or "").strip()
    for pattern in _UNQUOTED_RES:
        match = pattern.match(text)
        if match:
            saying = _clean(match.group(1))
            return saying if len(saying.split()) >= 3 else None
    if not _BIBLE_MENTION_RE.search(text):
        return None
    for pattern in (_DOUBLE_QUOTED_RE, _SINGLE_QUOTED_RE):
        match = pattern.search(text)
        if match:
            saying = _clean(match.group(1))
            if len(saying.split()) >= 3:
                return saying
    return None


def primer() -> Dict[str, Any]:
    result = _chat("Type a saying and I'll check whether it's really in the Bible.", "Mode primer → misquote")
    result["follow_up_questions"] = list(EXAMPLE_SAYINGS)
    return result


_EXPLAIN_SYSTEM = (
    "You explain, briefly and warmly, where a popular saying comes from and "
    "what the related Bible verses actually mean in context. Use only the "
    "verse text provided for what Scripture says. For where a saying comes "
    "from outside the Bible, hedge anything not firmly established "
    "(\"often attributed to…\"). Plain markdown, at most three short paragraphs."
)

_VERDICT_WORDS = {
    "verbatim": "found word for word",
    "paraphrase": "a paraphrase of a real verse",
    "distorted": "a real verse whose meaning the saying changes",
    "apocrypha_only": "found only in the Apocrypha",
    "not_in_bible": "not in the Bible",
    "unclear": "unclear",
}


async def explain(params: Dict[str, Any]) -> str:
    saying = str(params.get("saying") or "").strip()[:MAX_SAYING_CHARS]
    verdict = str(params.get("verdict") or "unclear")
    blocks = []
    for item in (params.get("verses") or [])[:3]:
        verse = bible_corpus.by_ref(str(item.get("ref") or ""))
        if verse is None:
            continue
        lines = "\n".join(f"{v.ref}: {v.text}" for v in bible_corpus.context(verse, radius=2))
        blocks.append(f"[{item.get('role', 'related')}] {verse.ref}\n{lines}")
    ask = (
        f"Saying: \"{saying}\"\n"
        f"Checker's verdict: {_VERDICT_WORDS.get(verdict, 'unclear')}.\n\n"
        + ("Verses with surrounding context:\n\n" + "\n\n".join(blocks) if blocks else "No verses were found.")
        + "\n\nExplain where this saying comes from and what the Bible actually says here."
    )
    try:
        reply = await simple_completion(_EXPLAIN_SYSTEM, ask, max_tokens=900, timeout=60.0)
    except Exception:  # noqa: BLE001
        logger.warning("misquote: explain call failed", exc_info=True)
        reply = ""
    if not reply or not reply.strip():
        return EXPLAIN_FAILED
    return wiki_refs.resolve_scripture_refs(reply.strip())
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pytest tests/chatbot/test_misquote_check.py -v`
Expected: all PASS. `wiki_refs.resolve_scripture_refs` produces links like `[1 Timothy 6:10](/explorer?reference=1TI%206%3A10)`, which is what the `"](/explorer"` assertion expects.

- [ ] **Step 5: Commit**

```bash
git add chatbot/misquote.py tests/chatbot/test_misquote_check.py
git commit -m "feat(chatbot): misquote saying extraction, primer and Explain"
```

---

### Task 6: API wiring — mode branches, primer, freeform detection, status, explain

**Files:**
- Modify: `chatbot/api.py` (imports; `post_chat` and `_stream_chat_response` branches; two new routes)
- Modify: `chatbot/router.py` (`route_deterministic` top; `build_mode_primer` branch)
- Modify: `chatbot/schemas.py` (`MisquoteExplainRequest`, `MisquoteStatusResponse`, `MisquoteExplainResponse`; `ChatRequest.mode` description; `ArtifactLink.type` description)
- Test: `tests/chatbot/test_chat_endpoint_misquote.py`, `tests/chatbot/test_misquote_explain_endpoint.py`

**Interfaces:**
- Consumes: `misquote.check`, `misquote.extract_saying`, `misquote.primer`, `misquote.explain`, `jev_client.is_configured`.
- Produces:
  - `GET /misquote/status` → `{"available": bool}`
  - `POST /misquote/explain` (body `{saying, verdict, sub_label?, confidence_label?, verses[]}`) → `{"message": str}`

- [ ] **Step 1: Write the failing tests**

`tests/chatbot/test_chat_endpoint_misquote.py`:

```python
"""Misquote mode wiring: mode=misquote turns, the primer, freeform detection,
and /misquote/status."""

import json


def _events(raw):
    return [json.loads(c.strip()[len("data: "):]) for c in raw.strip().split("\n\n") if c.strip().startswith("data: ")]


FAKE = {"type": "chat", "message": "[checked]", "data": None, "route": "misquote → test", "follow_up_questions": []}


def _fake_check(monkeypatch, captured):
    import chatbot.misquote as misquote_module

    async def fake(saying):
        captured.append(saying)
        return dict(FAKE)

    monkeypatch.setattr(misquote_module, "check", fake)


def test_misquote_mode_turn_routes_to_check(client, monkeypatch):
    captured = []
    _fake_check(monkeypatch, captured)
    res = client.post("/chat", json={"message": "This too shall pass", "mode": "misquote", "mode_params": {}})
    assert res.status_code == 200
    assert res.json()["message"] == "[checked]"
    assert captured == ["This too shall pass"]


def test_misquote_mode_stream_routes_to_check(client, monkeypatch):
    captured = []
    _fake_check(monkeypatch, captured)
    res = client.post("/chat/stream", json={"message": "This too shall pass", "mode": "misquote", "mode_params": {}})
    final = next(e for e in _events(res.text) if e["type"] == "final")
    assert final["result"]["message"] == "[checked]"
    assert captured == ["This too shall pass"]


def test_misquote_primer(client):
    res = client.post("/chat", json={"message": "", "mode": "misquote", "mode_params": {}})
    body = res.json()
    assert body["message"] == "Type a saying and I'll check whether it's really in the Bible."
    assert body["follow_up_questions"][0] == "Money is the root of all evil"


def test_freeform_detection_runs_the_check_when_configured(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    captured = []
    _fake_check(monkeypatch, captured)
    res = client.post("/chat", json={"message": 'Is "money is the root of all evil" in the Bible?', "mode": "freeform"})
    assert res.json()["message"] == "[checked]"
    assert captured == ["money is the root of all evil"]


def test_freeform_detection_is_skipped_without_a_key(client, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    captured = []
    _fake_check(monkeypatch, captured)
    import chatbot.api as api_module

    async def fake_claude(message, history=None, page_context=None):
        return {"type": "chat", "message": "[llm]", "data": None, "route": "llm"}

    monkeypatch.setattr(api_module, "route_claude", fake_claude)
    res = client.post("/chat", json={"message": 'Is "money is the root of all evil" in the Bible?', "mode": "freeform"})
    assert res.json()["message"] != "[checked]"  # whatever the existing path does, not a check
    assert captured == []


def test_topic_question_is_not_treated_as_a_saying(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    captured = []
    _fake_check(monkeypatch, captured)
    import chatbot.api as api_module

    async def fake_claude(message, history=None, page_context=None):
        return {"type": "chat", "message": "[llm]", "data": None, "route": "llm"}

    monkeypatch.setattr(api_module, "route_claude", fake_claude)
    res = client.post("/chat", json={"message": "Does the Bible say anything about divorce?", "mode": "freeform"})
    assert res.json()["message"] != "[checked]"
    assert captured == []


def test_status_reports_availability(client, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    assert client.get("/misquote/status").json() == {"available": False}
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    assert client.get("/misquote/status").json() == {"available": True}
```

`tests/chatbot/test_misquote_explain_endpoint.py`:

```python
def test_explain_endpoint_returns_the_markdown(client, monkeypatch):
    import chatbot.misquote as misquote_module
    seen = {}

    async def fake(params):
        seen.update(params)
        return "It comes from [1 Timothy 6:10](/explorer?reference=1+Timothy+6%3A10)."

    monkeypatch.setattr(misquote_module, "explain", fake)
    res = client.post("/misquote/explain", json={
        "saying": "Money is the root of all evil", "verdict": "distorted",
        "sub_label": None, "confidence_label": "Confident",
        "verses": [{"ref": "1 Timothy 6:10", "text": "…", "source": "canon", "role": "source"}],
    })
    assert res.status_code == 200
    assert res.json()["message"].startswith("It comes from")
    assert seen["verses"][0]["ref"] == "1 Timothy 6:10"


def test_explain_endpoint_rejects_a_missing_saying(client):
    res = client.post("/misquote/explain", json={"verdict": "unclear", "verses": []})
    assert res.status_code == 422
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pytest tests/chatbot/test_chat_endpoint_misquote.py tests/chatbot/test_misquote_explain_endpoint.py -v`
Expected: FAIL. `/misquote/status` returns 404, mode turns fall through to the LLM, and so on.

- [ ] **Step 3: Add the schemas** in `chatbot/schemas.py`

Update the two description strings. In `ArtifactLink.type`, append `| misquote`. In `ChatRequest.mode`, append `, misquote`. Then add:

```python
class MisquoteVerseParam(BaseModel):
    ref: str
    text: str = ""
    source: str = "canon"
    role: str = "related"


class MisquoteExplainRequest(BaseModel):
    saying: str = Field(..., min_length=1, max_length=300)
    verdict: str
    sub_label: Optional[str] = None
    confidence_label: Optional[str] = None
    verses: List[MisquoteVerseParam] = Field(default_factory=list)


class MisquoteExplainResponse(BaseModel):
    message: str


class MisquoteStatusResponse(BaseModel):
    available: bool
```

(`Optional`, `List`, `Field` and `BaseModel` are already imported in `schemas.py`. If any is missing, add it to the existing `typing`/`pydantic` import line.)

- [ ] **Step 4: Wire `chatbot/api.py`**

Change line 51's import to include the new modules:

```python
from chatbot import wiki_loader, wiki_qa, socratic, hermeneutics, character_chat, character_loader, misquote, jev_client
```

Add `MisquoteExplainRequest, MisquoteExplainResponse, MisquoteStatusResponse` to the existing `from chatbot.schemas import (...)` block.

Add these routes after `list_characters` (around line 233):

```python
@router.get("/misquote/status", response_model=MisquoteStatusResponse)
async def misquote_status():
    """Whether "Is that in the Bible?" can run (a JEV key is configured).
    Never calls JEV itself — the frontend asks once, to show or hide the tile."""
    return MisquoteStatusResponse(available=jev_client.is_configured())


@router.post("/misquote/explain", response_model=MisquoteExplainResponse)
async def post_misquote_explain(request: MisquoteExplainRequest):
    """The optional Explain follow-up for a misquote verdict card. Not a chat
    turn (like /story/illustrations); failures come back as an honest
    message with a 200, never an error status."""
    message = await misquote.explain(request.model_dump())
    return MisquoteExplainResponse(message=message)
```

In `post_chat`, directly after the `if request.mode == "character":` block (before `hermeneutics`), add:

```python
        # Every turn in an "Is that in the Bible?" session is a saying to
        # check — never the generic deterministic/LLM path.
        if request.mode == "misquote":
            result = await misquote.check(request.message)
            return _with_trace(result)
```

In `_stream_chat_response`, directly after its `character` block, add:

```python
        # Same special case as post_chat(): the verdict arrives whole.
        if request.mode == "misquote":
            result = await misquote.check(request.message)
            _note_outcome(result)
            yield await sse_event("final", {"result": result})
            return
```

- [ ] **Step 5: Wire `chatbot/router.py`**

At the very top of `route_deterministic`'s body, before `text_lower = message.lower()`:

```python
    # "Is 'X' in the Bible?" — only when JEV is configured; otherwise the
    # message falls through to ordinary chat exactly as before. Imported
    # here: misquote → bible_corpus → router would otherwise be circular.
    from chatbot import jev_client, misquote

    if jev_client.is_configured():
        saying = misquote.extract_saying(message)
        if saying:
            record_routing("deterministic: misquote check")
            return await misquote.check(saying)
```

In `build_mode_primer`, directly before `if mode == "story":`:

```python
    if mode == "misquote":
        from chatbot import misquote
        return misquote.primer()
```

- [ ] **Step 6: Run the tests and confirm they pass, then run the full backend suite**

Run: `pytest tests/chatbot/test_chat_endpoint_misquote.py tests/chatbot/test_misquote_explain_endpoint.py -v`
Expected: all PASS.

Run: `pytest`
Expected: the whole suite PASSES. Existing router tests must be unaffected, since the new block does nothing without `TYPESAFE_API_KEY`. If a developer's shell exports `TYPESAFE_API_KEY`, existing router tests could route differently. In that case, add `monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)` to an autouse fixture in `tests/chatbot/conftest.py`, and set it explicitly in the misquote tests, as they already do.

- [ ] **Step 7: Commit**

```bash
git add chatbot/api.py chatbot/router.py chatbot/schemas.py tests/chatbot/test_chat_endpoint_misquote.py tests/chatbot/test_misquote_explain_endpoint.py tests/chatbot/conftest.py
git commit -m "feat(chatbot): wire misquote mode, freeform detection, status and explain endpoints"
```

---

### Task 7: Evaluation set, live eval script, and the batched-vs-split decision

This task needs a real `TYPESAFE_API_KEY` in `.env`. Everything except the live run (Step 4) can be done without one. If no key is available, finish Steps 1–3 and 5, and report Step 4 as **pending** in the task summary. Do not invent results.

**Files:**
- Create: `chatbot/data/misquote_eval.py`
- Create: `scripts/eval_misquote.py`
- Test: `tests/chatbot/test_misquote_eval_data.py`

**Interfaces:**
- Consumes: `misquote.check`, `bible_corpus.by_ref`.
- Produces: `EVAL_SAYINGS: List[Tuple[str, FrozenSet[str], Optional[str]]]`, each entry being (saying, acceptable verdicts, expected source ref or `None`).

- [ ] **Step 1: Write the failing data test**

`tests/chatbot/test_misquote_eval_data.py`:

```python
from chatbot import bible_corpus
from chatbot.data.misquote_eval import EVAL_SAYINGS

VERDICTS = {"verbatim", "paraphrase", "distorted", "apocrypha_only", "not_in_bible", "unclear"}


def test_eval_set_is_balanced_and_well_formed():
    assert len(EVAL_SAYINGS) >= 40
    firsts = [sorted(ok)[0] if len(ok) == 1 else "mixed" for _, ok, _ in EVAL_SAYINGS]
    for verdict, minimum in [("verbatim", 8), ("paraphrase", 8), ("distorted", 2), ("not_in_bible", 7), ("apocrypha_only", 4)]:
        assert firsts.count(verdict) >= minimum, verdict
    for saying, ok, ref in EVAL_SAYINGS:
        assert ok <= VERDICTS, saying
        assert len(saying) <= 300


def test_every_expected_source_verse_exists():
    for saying, _, ref in EVAL_SAYINGS:
        if ref:
            assert bible_corpus.by_ref(ref) is not None, (saying, ref)
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pytest tests/chatbot/test_misquote_eval_data.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Create `chatbot/data/misquote_eval.py`**

```python
"""Labelled sayings for scripts/eval_misquote.py — the live JEV evaluation
used to pick batched vs split requests and to tune misquote_verdict's
thresholds. Each entry: (saying, acceptable verdicts, expected source ref).
Genuinely ambiguous sayings list more than one acceptable verdict."""

from typing import FrozenSet, List, Optional, Tuple

V, P, D, A, N, U = "verbatim", "paraphrase", "distorted", "apocrypha_only", "not_in_bible", "unclear"


def ok(*verdicts: str) -> FrozenSet[str]:
    return frozenset(verdicts)


EVAL_SAYINGS: List[Tuple[str, FrozenSet[str], Optional[str]]] = [
    # --- word for word (whole verse or faithful fragment) ---
    ("Jesus wept", ok(V), "John 11:35"),
    ("Pray without ceasing", ok(V), "1 Thessalonians 5:17"),
    ("In the beginning God created the heaven and the earth", ok(V), "Genesis 1:1"),
    ("The fear of the LORD is the beginning of wisdom", ok(V), "Proverbs 9:10"),
    ("God is love", ok(V), "1 John 4:8"),
    ("The truth shall make you free", ok(V), "John 8:32"),
    ("Be still, and know that I am God", ok(V), "Psalm 46:10"),
    ("Physician, heal thyself", ok(V), "Luke 4:23"),
    ("The wages of sin is death", ok(V), "Romans 6:23"),
    ("Be fruitful, and multiply", ok(V), "Genesis 1:28"),
    # --- paraphrase ---
    ("Pride comes before a fall", ok(P), "Proverbs 16:18"),
    ("Spare the rod, spoil the child", ok(P), "Proverbs 13:24"),
    ("An eye for an eye", ok(P, V), "Exodus 21:24"),
    ("Do unto others as you would have them do unto you", ok(P), "Matthew 7:12"),
    ("Man does not live by bread alone", ok(P), "Matthew 4:4"),
    ("There is nothing new under the sun", ok(P), "Ecclesiastes 1:9"),
    ("A house divided against itself cannot stand", ok(P), "Mark 3:25"),
    ("The truth will set you free", ok(P), "John 8:32"),
    ("Train up a child in the way he should go and he will not depart from it", ok(P), "Proverbs 22:6"),
    ("The meek shall inherit the earth", ok(P, V), "Matthew 5:5"),
    ("Where two or three are gathered together in my name, there am I", ok(P, V), "Matthew 18:20"),
    # --- distorted (real verse, meaning changed) ---
    ("Money is the root of all evil", ok(D), "1 Timothy 6:10"),
    ("God won't give you more than you can handle", ok(D, N, U), "1 Corinthians 10:13"),
    ("Lean on your own understanding", ok(D), "Proverbs 3:5"),
    ("Eat, drink and be merry, for tomorrow we die", ok(D, P), None),
    # --- Apocrypha only ---
    ("Great is truth, and mighty above all things", ok(A), "1 Esdras 4:41"),
    ("Wine is as good as life to a man, if it be drunk moderately", ok(A), "Ecclesiasticus 31:27"),
    ("He that toucheth pitch shall be defiled therewith", ok(A), "Ecclesiasticus 13:1"),
    ("Honour a physician with the honour due unto him", ok(A), "Ecclesiasticus 38:1"),
    # --- not in the Bible ---
    ("God helps those who help themselves", ok(N), None),
    ("Cleanliness is next to godliness", ok(N), None),
    ("This too shall pass", ok(N), None),
    ("To thine own self be true", ok(N), None),
    ("Hate the sin, love the sinner", ok(N, U), None),
    ("God works in mysterious ways", ok(N, U), None),
    ("Charity begins at home", ok(N), None),
    ("Let go and let God", ok(N), None),
    ("Blood is thicker than water", ok(N), None),
    ("Everything happens for a reason", ok(N, D, U), None),
    ("Moderation in all things", ok(N, U), None),
]
```

- [ ] **Step 4: Create `scripts/eval_misquote.py`, run it, and record the decision**

```python
"""Live evaluation of the misquote checker against the real JEV.

Manual only (costs API calls; not part of CI), like
validate_devotional_pool.py --runtime. Reads .env for TYPESAFE_API_KEY and
the LLM provider settings.

  python scripts/eval_misquote.py --mode batched
  python scripts/eval_misquote.py --mode split

Prints a confusion matrix, per-saying misses and median latency. Acceptance
bar (spec): zero verbatim/paraphrase verdicts on sayings whose acceptable
set is only not_in_bible, and >= 80% overall."""

import argparse
import asyncio
import os
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from chatbot import bible_corpus, misquote  # noqa: E402
from chatbot.data.misquote_eval import EVAL_SAYINGS  # noqa: E402

VERDICTS = ["verbatim", "paraphrase", "distorted", "apocrypha_only", "not_in_bible", "unclear", "error"]


async def main(mode: str) -> int:
    os.environ["MISQUOTE_JEV_MODE"] = mode
    bible_corpus.load()
    matrix = Counter()
    misses, latencies, false_scripture = [], [], 0
    for saying, acceptable, _ref in EVAL_SAYINGS:
        start = time.perf_counter()
        result = await misquote.check(saying)
        latencies.append(time.perf_counter() - start)
        artifacts = result.get("artifacts") or []
        got = artifacts[0]["params"]["verdict"] if artifacts else "error"
        expected = sorted(acceptable)[0] if len(acceptable) == 1 else "mixed"
        matrix[(expected, got)] += 1
        if got not in acceptable:
            misses.append((saying, sorted(acceptable), got))
            if acceptable == {"not_in_bible"} and got in {"verbatim", "paraphrase"}:
                false_scripture += 1

    rows = ["verbatim", "paraphrase", "distorted", "apocrypha_only", "not_in_bible", "mixed"]
    print(f"\nmode={mode}   rows=expected, cols=got")
    print(" " * 16 + "".join(f"{c[:10]:>11}" for c in VERDICTS))
    for r in rows:
        print(f"{r:<16}" + "".join(f"{matrix[(r, c)]:>11}" for c in VERDICTS))
    correct = len(EVAL_SAYINGS) - len(misses)
    print(f"\ncorrect {correct}/{len(EVAL_SAYINGS)} = {correct / len(EVAL_SAYINGS):.0%}")
    print(f"false scripture (not_in_bible → verbatim/paraphrase): {false_scripture}")
    print(f"median latency {statistics.median(latencies):.2f}s, max {max(latencies):.2f}s")
    for saying, ok, got in misses:
        print(f"  MISS  {saying!r}: expected {ok}, got {got}")
    passed = false_scripture == 0 and correct / len(EVAL_SAYINGS) >= 0.8
    print("\nPASS" if passed else "\nFAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["batched", "split"], default="batched")
    raise SystemExit(asyncio.run(main(parser.parse_args().mode)))
```

Check that `python-dotenv` is importable: run `python -c "import dotenv"`. If it isn't, replace the two `load_dotenv` lines with a tiny loop that parses `.env` (`KEY=VALUE` lines) into `os.environ.setdefault`. Don't add a dependency for a manual script.

Then, with a real key in `.env`:
1. Run `python scripts/eval_misquote.py --mode batched` and `python scripts/eval_misquote.py --mode split`.
2. Pick the mode with more correct verdicts and zero false-scripture results. If they're tied, pick the lower median latency. Set `MISQUOTE_JEV_MODE` in `.env.example` to the winner.
3. If neither mode passes, adjust **only** the constants at the top of `chatbot/misquote_verdict.py`, never the logic, and re-run. Raise `SOURCE_MIN`/`CONFIDENCE_MIN` first if there are false-scripture results. Re-run `pytest tests/chatbot/test_misquote_verdict.py` afterwards, and update any test that pins an old threshold edge so it uses the new constant **by name** (import it) rather than a literal.
4. Paste both final result tables into the commit message body.

- [ ] **Step 5: Run the data test and confirm it passes**

Run: `pytest tests/chatbot/test_misquote_eval_data.py -v`
Expected: PASS. If a `by_ref` lookup fails, fix the reference spelling to match `Complete.db`. For example, the DB uses `Psalm 46:10`, not `Psalms`.

- [ ] **Step 6: Commit**

```bash
git add chatbot/data/misquote_eval.py scripts/eval_misquote.py tests/chatbot/test_misquote_eval_data.py .env.example chatbot/misquote_verdict.py tests/chatbot/test_misquote_verdict.py
git commit -m "feat(chatbot): misquote live eval set + script; choose JEV request mode

<paste both eval result tables here, or 'live eval pending: no TYPESAFE_API_KEY'>"
```

---

### Task 8: Frontend — the `misquote` artifact

**Files:**
- Create: `frontend/src/lib/misquoteDiff.ts`, `frontend/src/lib/misquoteDiff.test.ts`
- Create: `frontend/src/components/artifacts/MisquoteArtifact.tsx`, `frontend/src/components/artifacts/MisquoteArtifact.test.tsx`
- Modify: `frontend/src/types/session.ts`, `frontend/src/lib/chatApi.ts`, `frontend/src/store/useArtifactStore.ts`, `frontend/src/components/shell/ArtifactPane.tsx`

**Interfaces:**
- Consumes: the backend's `POST /misquote/explain`, which returns `{message}`.
- Produces:
  - `MisquoteArtifactParams`, `MisquoteVerdict`, `MisquoteVerse` types in `types/session.ts`; `'misquote'` added to `ArtifactLink['type']` and to `SessionMode`
  - `postMisquoteExplain(params: MisquoteArtifactParams): Promise<string>` and `fetchMisquoteStatus(): Promise<boolean>` in `lib/chatApi.ts`
  - `highlightOmitted(saying: string, verseText: string): { word: string; omitted: boolean }[]` in `lib/misquoteDiff.ts`
  - `<MisquoteArtifact {...params} />`

- [ ] **Step 1: Add the types** in `frontend/src/types/session.ts`

Change the `SessionMode` union to end with `| 'story' | 'misquote'`, and the `ArtifactLink.type` union to end with `| 'story' | 'misquote'`. Then append:

```ts
export type MisquoteVerdict = 'verbatim' | 'paraphrase' | 'distorted' | 'apocrypha_only' | 'not_in_bible' | 'unclear'

export interface MisquoteVerse {
  ref: string
  text: string
  source: 'canon' | 'apocrypha'
  role: 'source' | 'related'
}

/** Params for a `misquote`-type ArtifactLink — the whole verdict card
 * (including verse text) travels inline, so reloads and share links redraw
 * it exactly without re-running the check. */
export interface MisquoteArtifactParams {
  saying: string
  verdict: MisquoteVerdict
  sub_label: 'verbatim' | 'paraphrase' | 'distorted' | null
  confidence_label: 'Confident' | 'Fairly sure' | null
  verses: MisquoteVerse[]
}
```

- [ ] **Step 2: Write the failing diff test**

`frontend/src/lib/misquoteDiff.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { highlightOmitted } from './misquoteDiff'

describe('highlightOmitted', () => {
  it('marks verse words the saying dropped, inside the matched span only', () => {
    const out = highlightOmitted(
      'Money is the root of all evil',
      'For the love of money is the root of all evil: which while some coveted after',
    )
    expect(out.filter((w) => w.omitted).map((w) => w.word)).toEqual(['love'])
    expect(out.map((w) => w.word).join(' ')).toBe(
      'For the love of money is the root of all evil: which while some coveted after',
    )
  })

  it('folds 1611 spelling so matching words are not highlighted', () => {
    const out = highlightOmitted('great is truth', 'Great is trueth, and mightie aboue all things.')
    expect(out.find((w) => w.word === 'Great')?.omitted).toBe(false)
  })

  it('returns nothing highlighted when the saying shares no words', () => {
    const out = highlightOmitted('this too shall pass', 'Jesus wept.')
    expect(out.every((w) => !w.omitted)).toBe(true)
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run (in `frontend/`): `npx vitest run src/lib/misquoteDiff.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 4: Implement `frontend/src/lib/misquoteDiff.ts`**

```ts
/** Word-level "what did the saying leave out?" highlighting for the
 * misquote card — plain set comparison, no model. Only words between the
 * first and last verse word the saying shares are candidates, so
 * "the **love** of money is the root of all evil" lights up "love" rather
 * than the whole rest of the verse. */
function fold(word: string): string {
  return word
    .toLowerCase()
    .replace(/ſ/g, 's')
    .replace(/[^a-z]/g, '')
    .replace(/v/g, 'u')
    .replace(/j/g, 'i')
}

export function highlightOmitted(saying: string, verseText: string): { word: string; omitted: boolean }[] {
  const sayingWords = new Set(saying.split(/\s+/).map(fold).filter(Boolean))
  const words = verseText.split(/\s+/).filter(Boolean)
  const shared = words.map((w) => sayingWords.has(fold(w)))
  const first = shared.indexOf(true)
  const last = shared.lastIndexOf(true)
  return words.map((word, i) => ({
    word,
    omitted: first !== -1 && i > first && i < last && !shared[i] && fold(word) !== '',
  }))
}
```

The 1611 test passes because `Great` and `is` are shared words and `Great` is not inside a gap. "trueth" isn't highlighted either, because it falls outside the span between the first and last shared words (`Great` … `is`).

- [ ] **Step 5: Add the API helpers** in `frontend/src/lib/chatApi.ts`, after `postDevotionalAudio`

```ts
/** Whether "Is that in the Bible?" is available (a JEV key is configured
 * on the server). Any failure reads as unavailable — the tile just hides. */
export async function fetchMisquoteStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${CHAT_API}/misquote/status`)
    if (!res.ok) return false
    const json = (await res.json()) as { available?: boolean }
    return json.available === true
  } catch {
    return false
  }
}

/** The optional Explain follow-up for a misquote card. The backend always
 * answers 200 with an honest message on failure; a transport error throws. */
export async function postMisquoteExplain(params: MisquoteArtifactParams): Promise<string> {
  const res = await fetch(`${CHAT_API}/misquote/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const json = await parseJsonResponse<{ message: string }>(res)
  return json.message
}
```

Add `MisquoteArtifactParams` to `chatApi.ts`'s existing `import type { … } from '@/types/session'`. If there's no such import, add `import type { MisquoteArtifactParams } from '@/types/session'`.

- [ ] **Step 6: Write the failing component test**

`frontend/src/components/artifacts/MisquoteArtifact.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as chatApi from '@/lib/chatApi'
import { useSessionsStore } from '@/store/useSessionsStore'
import { MisquoteArtifact } from './MisquoteArtifact'
import type { MisquoteArtifactParams } from '@/types/session'

const DISTORTED: MisquoteArtifactParams = {
  saying: 'Money is the root of all evil',
  verdict: 'distorted',
  sub_label: null,
  confidence_label: 'Confident',
  verses: [
    {
      ref: '1 Timothy 6:10',
      text: 'For the love of money is the root of all evil: which while some coveted after',
      source: 'canon',
      role: 'source',
    },
  ],
}

describe('MisquoteArtifact', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['verbatim', 'Word for word'],
    ['paraphrase', 'Paraphrase'],
    ['distorted', 'Distorted'],
    ['apocrypha_only', 'In the Apocrypha only'],
    ['not_in_bible', 'Not in the Bible'],
    ['unclear', 'Unclear'],
  ] as const)('shows the %s badge', (verdict, label) => {
    render(<MisquoteArtifact {...DISTORTED} verdict={verdict} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows the saying, confidence label and a verse link into the Explorer', () => {
    render(<MisquoteArtifact {...DISTORTED} />)
    expect(screen.getByText(/Money is the root of all evil/)).toBeInTheDocument()
    expect(screen.getByText('Confident')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '1 Timothy 6:10' })
    expect(link).toHaveAttribute('href', '/explorer?reference=1%20Timothy%206%3A10')
  })

  it('highlights the words the saying left out, for distorted verdicts', () => {
    render(<MisquoteArtifact {...DISTORTED} />)
    expect(screen.getByText('love').tagName).toBe('MARK')
  })

  it('does not highlight for not_in_bible verdicts', () => {
    render(<MisquoteArtifact {...DISTORTED} verdict="not_in_bible" confidence_label={null} />)
    expect(screen.queryByText('love')?.tagName).not.toBe('MARK')
  })

  it('tags Apocrypha verses', () => {
    render(
      <MisquoteArtifact
        {...DISTORTED}
        verdict="apocrypha_only"
        sub_label="verbatim"
        verses={[{ ref: 'Tobit 4:15', text: 'Doe that to no man which thou hatest', source: 'apocrypha', role: 'source' }]}
      />,
    )
    expect(screen.getByText('Apocrypha')).toBeInTheDocument()
  })

  it('Explain appends the explanation to the active session', async () => {
    const session = useSessionsStore.getState().createSession('misquote', {})
    vi.spyOn(chatApi, 'postMisquoteExplain').mockResolvedValue('It comes from Paul.')
    render(<MisquoteArtifact {...DISTORTED} />)
    await userEvent.click(screen.getByRole('button', { name: /explain/i }))
    await waitFor(() => {
      const msgs = useSessionsStore.getState().sessions[session.id].messages
      expect(msgs.at(-1)).toMatchObject({ role: 'assistant', text: 'It comes from Paul.' })
    })
  })

  it('Explain failure shows the honest message instead of throwing', async () => {
    const session = useSessionsStore.getState().createSession('misquote', {})
    vi.spyOn(chatApi, 'postMisquoteExplain').mockRejectedValue(new Error('network'))
    render(<MisquoteArtifact {...DISTORTED} />)
    await userEvent.click(screen.getByRole('button', { name: /explain/i }))
    await waitFor(() => {
      const msgs = useSessionsStore.getState().sessions[session.id].messages
      expect(msgs.at(-1)?.text).toBe("I couldn't explain this one right now.")
    })
  })
})
```

`createSession` also sets `activeSessionId` (see `useSessionsStore.ts`), which is how the component finds the session to add the Explain message to.

- [ ] **Step 7: Run it and confirm it fails**

Run (in `frontend/`): `npx vitest run src/components/artifacts/MisquoteArtifact.test.tsx`
Expected: FAIL, because the module isn't found.

- [ ] **Step 8: Implement `frontend/src/components/artifacts/MisquoteArtifact.tsx`**

```tsx
import { useState } from 'react'
import { BookCheck, BookX, CircleHelp, Loader2, Quote, ScrollText, ShieldAlert, TextQuote } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { postMisquoteExplain } from '@/lib/chatApi'
import { highlightOmitted } from '@/lib/misquoteDiff'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { MisquoteArtifactParams, MisquoteVerdict, MisquoteVerse } from '@/types/session'

const EXPLAIN_FAILED = "I couldn't explain this one right now."

const BADGES: Record<MisquoteVerdict, { label: string; icon: LucideIcon; tone: string }> = {
  verbatim: { label: 'Word for word', icon: BookCheck, tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950' },
  paraphrase: { label: 'Paraphrase', icon: TextQuote, tone: 'text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950' },
  distorted: { label: 'Distorted', icon: ShieldAlert, tone: 'text-amber-800 bg-amber-50 dark:text-amber-300 dark:bg-amber-950' },
  apocrypha_only: { label: 'In the Apocrypha only', icon: ScrollText, tone: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950' },
  not_in_bible: { label: 'Not in the Bible', icon: BookX, tone: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950' },
  unclear: { label: 'Unclear', icon: CircleHelp, tone: 'text-[var(--color-text-secondary)] bg-[var(--color-surface-alt)]' },
}

const HIGHLIGHTS = new Set(['paraphrase', 'distorted'])

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-misquote-${++idCounter}`
}

function VerseCard({ verse, saying, highlight }: { verse: MisquoteVerse; saying: string; highlight: boolean }) {
  const href = `/explorer?reference=${encodeURIComponent(verse.ref)}`
  return (
    <div className="rounded-lg border border-[var(--color-theme-border)] p-3 space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <a href={href} className="font-semibold text-[var(--color-theme-accent)] hover:underline">
          {verse.ref}
        </a>
        {verse.source === 'apocrypha' && (
          <span className="text-xs rounded px-1.5 py-0.5 bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)]">
            Apocrypha
          </span>
        )}
        {verse.role === 'related' && <span className="text-xs text-[var(--color-text-secondary)]">related</span>}
      </div>
      <p className="text-sm leading-relaxed">
        {highlight
          ? highlightOmitted(saying, verse.text).map((w, i) => (
              <span key={i}>
                {i > 0 && ' '}
                {w.omitted ? <mark className="rounded px-0.5">{w.word}</mark> : w.word}
              </span>
            ))
          : verse.text}
      </p>
    </div>
  )
}

export function MisquoteArtifact(params: MisquoteArtifactParams) {
  const { saying, verdict, sub_label, confidence_label, verses } = params
  const [explaining, setExplaining] = useState(false)
  const appendMessage = useSessionsStore((s) => s.appendMessage)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const closeArtifact = useArtifactStore((s) => s.close)
  const badge = BADGES[verdict] ?? BADGES.unclear
  const Icon = badge.icon
  const highlight = HIGHLIGHTS.has(verdict) || (verdict === 'apocrypha_only' && HIGHLIGHTS.has(sub_label ?? ''))

  async function explain() {
    if (!activeSessionId || explaining) return
    setExplaining(true)
    let text: string
    try {
      text = await postMisquoteExplain(params)
    } catch {
      text = EXPLAIN_FAILED
    }
    appendMessage(activeSessionId, { id: genId(), role: 'assistant', text })
    setExplaining(false)
  }

  function checkAnother() {
    closeArtifact()
    // ChatPane's compose input; see data-chat-input there.
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-chat-input]')?.focus())
  }

  return (
    <div className="space-y-4">
      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${badge.tone}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span>{badge.label}</span>
        {verdict === 'apocrypha_only' && sub_label && (
          <span className="font-normal opacity-80">({sub_label === 'verbatim' ? 'word for word' : sub_label})</span>
        )}
      </div>

      <blockquote className="flex gap-2 border-l-4 border-[var(--color-theme-accent)] pl-3 italic">
        <Quote className="h-4 w-4 shrink-0 mt-0.5 opacity-60" aria-hidden="true" />
        <span>{saying}</span>
      </blockquote>

      {confidence_label && <div className="text-xs text-[var(--color-text-secondary)]">{confidence_label}</div>}

      {verses.length > 0 && (
        <div className="space-y-2">
          {verdict === 'not_in_bible' && (
            <div className="text-sm text-[var(--color-text-secondary)]">What the Bible does say on this:</div>
          )}
          {verses.map((v) => (
            <VerseCard key={v.ref} verse={v} saying={saying} highlight={highlight && v.role === 'source'} />
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={explain}
          disabled={explaining || !activeSessionId}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50"
        >
          {explaining && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Explain
        </button>
        <button
          onClick={checkAnother}
          className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
        >
          Check another
        </button>
      </div>
    </div>
  )
}
```

If `BookCheck`, `BookX`, `ScrollText`, `ShieldAlert`, `TextQuote` or `CircleHelp` isn't exported by the installed `lucide-react` (check `frontend/node_modules/lucide-react/dist/lucide-react.d.ts`), swap in the nearest available icon. `HelpCircle` is already used elsewhere in the app.

- [ ] **Step 9: Render it in the pane**

In `frontend/src/store/useArtifactStore.ts` `fetchForLink`, add before `default:`:

```ts
    case 'misquote':
      // The whole verdict card travels inline on the link params (set by
      // the chat message that produced it) — nothing to fetch.
      return link.params
```

In `frontend/src/components/shell/ArtifactPane.tsx`:
- Import `MisquoteArtifact` next to the other artifact imports.
- Add `MisquoteArtifactParams` to the `@/types/session` type import on line 19.
- After the `story` block, add:

```tsx
                {activeArtifact.type === 'misquote' && (
                  <MisquoteArtifact {...(data as MisquoteArtifactParams)} />
                )}
```

- [ ] **Step 10: Run the frontend tests and the type-check**

Run (in `frontend/`): `npx vitest run src/lib/misquoteDiff.test.ts src/components/artifacts/MisquoteArtifact.test.tsx`
Expected: PASS.

Run: `npx tsc -b`
Expected: errors **only** in `SessionsPane.tsx` and `useSessionsStore.ts`, saying that `Record<SessionMode, …>` is missing `misquote`. Task 9 fixes them. Any other error must be fixed now.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/lib/chatApi.ts frontend/src/lib/misquoteDiff.ts frontend/src/lib/misquoteDiff.test.ts frontend/src/components/artifacts/MisquoteArtifact.tsx frontend/src/components/artifacts/MisquoteArtifact.test.tsx frontend/src/store/useArtifactStore.ts frontend/src/components/shell/ArtifactPane.tsx
git commit -m "feat(frontend): misquote verdict card artifact with omitted-word highlighting and Explain"
```

---

### Task 9: Frontend — mode tile and session wiring

**Files:**
- Modify: `frontend/src/store/useSessionsStore.ts` (`MODE_LABELS`)
- Modify: `frontend/src/components/shell/SessionsPane.tsx` (`MODE_ORDER`, `MODE_ICONS`)
- Modify: `frontend/src/components/shell/ChatPane.tsx` (`composePlaceholder`, `data-chat-input`)
- Modify: `frontend/src/components/shell/ModePickerScreen.tsx` (a tile shown when the check is available)
- Test: `frontend/src/components/shell/ModePickerScreen.test.tsx`

**Interfaces:**
- Consumes: `fetchMisquoteStatus` (Task 8), the backend primer (Task 6).
- Produces: a working entry point for the mode.

- [ ] **Step 1: Write the failing tests** (append inside the `describe` in `ModePickerScreen.test.tsx`)

```tsx
  it('hides the "Is that in the Bible?" tile when the checker is unavailable', async () => {
    vi.spyOn(chatApi, 'fetchMisquoteStatus').mockResolvedValue(false)
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await waitFor(() => expect(chatApi.fetchMisquoteStatus).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /is that in the bible/i })).not.toBeInTheDocument()
  })

  it('shows the tile when available and starts a misquote session from the primer', async () => {
    vi.spyOn(chatApi, 'fetchMisquoteStatus').mockResolvedValue(true)
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat',
      message: "Type a saying and I'll check whether it's really in the Bible.",
      data: null,
      follow_up_questions: ['Money is the root of all evil'],
    } as Awaited<ReturnType<typeof chatApi.postChat>>)
    const onStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onStarted} />)
    await userEvent.click(await screen.findByRole('button', { name: /is that in the bible/i }))
    await waitFor(() => expect(onStarted).toHaveBeenCalled())
    expect(chatApi.postChat).toHaveBeenCalledWith({ message: '', mode: 'misquote', mode_params: {} })
    const s = firstSession()
    expect(s.mode).toBe('misquote')
    expect(s.messages.at(-1)?.followUpQuestions).toEqual(['Money is the root of all evil'])
  })
```

Existing tests in this file don't mock `fetchMisquoteStatus`. In jsdom the real one calls `fetch`, fails, and returns `false`, so those tests are unaffected. If jsdom lacks `fetch`, add `vi.spyOn(chatApi, 'fetchMisquoteStatus').mockResolvedValue(false)` to the file's `beforeEach`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run (in `frontend/`): `npx vitest run src/components/shell/ModePickerScreen.test.tsx`
Expected: the two new tests FAIL (no tile, and `fetchMisquoteStatus` is never called).

- [ ] **Step 3: Implement**

`frontend/src/store/useSessionsStore.ts`: add `misquote: 'Is that in the Bible?',` to `MODE_LABELS`.

`frontend/src/components/shell/SessionsPane.tsx`:
- Add `'misquote'` to `MODE_ORDER` just before `'freeform'`.
- Add `misquote: BookCheck,` to `MODE_ICONS`, and add `BookCheck` to that file's `lucide-react` import.

`frontend/src/components/shell/ChatPane.tsx`:
- In `composePlaceholder`'s switch, add before `case 'devotional':`

```ts
    case 'misquote':
      return 'Type a saying to check…'
```

- Add `data-chat-input` to the compose `<input>` (around line 1327), so the artifact's "Check another" can focus it:

```tsx
        <input
          data-chat-input
          value={input}
```

`frontend/src/components/shell/ModePickerScreen.tsx`:
- Change the React import to `import { useEffect, useState } from 'react'`.
- Add `BookCheck` to the `lucide-react` import.
- Change `import { postChat, postChatStream } from '@/lib/chatApi'` to `import { fetchMisquoteStatus, postChat, postChatStream } from '@/lib/chatApi'`.

Inside the component, after the `readingPlanProgress` line:

```tsx
  const [misquoteAvailable, setMisquoteAvailable] = useState(false)
  useEffect(() => {
    let cancelled = false
    void fetchMisquoteStatus().then((available) => {
      if (!cancelled) setMisquoteAvailable(available)
    })
    return () => {
      cancelled = true
    }
  }, [])
```

Directly before the `Ask Anything` button:

```tsx
          {misquoteAvailable && (
            <button
              className={STARTER_BUBBLE}
              onClick={() => startSession('misquote', '🔎 Is that in the Bible?', {})}
            >
              <BookCheck className="h-4 w-4 shrink-0" aria-hidden="true" /> Is that in the Bible?
            </button>
          )}
```

- [ ] **Step 4: Run all frontend tests, the type-check and lint**

Run (in `frontend/`): `npm test`
Expected: all PASS.

Run: `npx tsc -b`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors in the touched files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useSessionsStore.ts frontend/src/components/shell/SessionsPane.tsx frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ModePickerScreen.tsx frontend/src/components/shell/ModePickerScreen.test.tsx
git commit -m "feat(frontend): 'Is that in the Bible?' mode tile, session label/icon and placeholder"
```

---

### Task 10: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md` (new mode section)
- Modify: `DEPLOYMENT.md` (new section after "Devotional audio (Listen) and devotional-of-the-day")

- [ ] **Step 1: Add the CLAUDE.md section** after the "Tell a Story mode" section and before "## Key Conventions":

```markdown
## "Is that in the Bible?" mode (internal id `misquote`)

Checks whether a saying ("Money is the root of all evil") is really in the
Bible, returning one of six verdicts — `verbatim`, `paraphrase`,
`distorted`, `apocrypha_only`, `not_in_bible`, `unclear` — as an inline
`misquote` artifact (verse text copied into the params so reloads/shares
redraw it). It is the app's first use of TypeSafe's **JEV** classifier
(`chatbot/jev_client.py`, plain `httpx` against the documented HTTP API,
`TYPESAFE_API_KEY`). Candidates come from `chatbot/bible_corpus.py` — an
in-memory KJV + 1611 Apocrypha corpus (loaded once from `Complete.db` and
`APOC`; normalization folds 1611 spelling and strips `<f>` footnotes) —
via word-for-word and keyword matching, plus one LLM "which verses?"
suggestion call whose references are verified against the corpus. JEV
judges each candidate (one Choice: `same_meaning` / `meaning_changed` /
`related_only` / `unrelated`); `chatbot/misquote_verdict.py` is a pure
function holding the thresholds. **A partial word-for-word hit is never
trusted alone** — "money is the root of all evil" is a verbatim fragment of
1 Timothy 6:10 and must come back `distorted` — only a whole-verse hit
skips JEV. No verdict is ever given without JEV: with no key the tile is
hidden (`GET /misquote/status`) and freeform detection
(`misquote.extract_saying`, deliberately narrow — quoted sayings or "does
the Bible say *that* …") is skipped. The optional Explain button calls
`POST /misquote/explain` (LLM, grounded on ±2 verses of context). Tune
thresholds only with `scripts/eval_misquote.py` (live, manual) against
`chatbot/data/misquote_eval.py`; the bar is zero made-up sayings called
scripture. See `docs/superpowers/specs/2026-09-26-misquote-mode-design.md`.
```

- [ ] **Step 2: Add the DEPLOYMENT.md section**

```markdown
### "Is that in the Bible?" (TypeSafe JEV)

The mode is off until a JEV key is configured: without `TYPESAFE_API_KEY`
its tile is hidden and freeform "is 'X' in the Bible?" detection is skipped.

1. Create a key at https://console.typesafe.ai/keys and put it in `.env`
   (`TYPESAFE_API_KEY=…`). Optional: `TYPESAFE_MODEL` (default
   `jev-latest`), `MISQUOTE_JEV_TIMEOUT` (default 10 s),
   `MISQUOTE_JEV_MODE` (`batched`/`split`, chosen by the eval script).
2. No new volumes or packages: the verse corpus is built in memory from the
   already-mounted `Complete.db` on the first check (a few seconds, once).
3. Rebuild/restart only the `chatbot` service, then verify:
   `curl -s localhost:<chatbot port>/misquote/status` → `{"available":true}`,
   and in the app, "Is that in the Bible?" → "Money is the root of all evil"
   should come back **Distorted** citing 1 Timothy 6:10.
```

Replace `<chatbot port>` with the chatbot service's actual port from `docker-compose.yml`. Look it up; don't leave the placeholder.

- [ ] **Step 3: End-to-end check**

Run: `pytest`
Expected: all PASS.

Run (in `frontend/`): `npm test && npx tsc -b`
Expected: all PASS, no errors.

If a `TYPESAFE_API_KEY` is available, start the app (`./start-chatbot.sh` plus the frontend dev server, per `CHATBOT_SETUP.md`) and check each of these by hand:
- The tile appears.
- "Money is the root of all evil" → Distorted, with "love" highlighted.
- "Jesus wept" → Word for word.
- "God helps those who help themselves" → Not in the Bible.
- In Ask Anything, `Is "spare the rod, spoil the child" in the Bible?` → a verdict card.
- Explain adds a message.
- A share link shows the card.

Report anything that doesn't match.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md DEPLOYMENT.md
git commit -m "docs: document 'Is that in the Bible?' (misquote) mode and its JEV deployment"
```
