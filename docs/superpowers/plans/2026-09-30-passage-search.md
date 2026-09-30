# "Find passages" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new chat mode, "Find passages" (`passages`): given a verse reference or a plain-English statement, return ranked Bible passages, each with a one-sentence reason and a link, as an inline `passage_search` artifact.

**Architecture:** Offline: JEV-cut chunks of the KJV (4,284, already computed) are embedded once with a small local ONNX model and committed as data. Runtime: classify the input → (statement only) LLM rewrites it into KJV-style phrases → embedding search + in-memory BM25 over the chunks (+ TSK cross-references for passage input) → reciprocal-rank fusion → JEV judges each candidate's relevance → LLM writes one sentence per survivor. Every stage after retrieval fails open.

**Tech Stack:** Python (FastAPI chatbot, numpy, `fastembed` + `BAAI/bge-small-en-v1.5`, plain `httpx` for JEV), React/TypeScript/Zustand/Vitest frontend, SQLite `Complete.db` (read-only).

**Spec:** `docs/superpowers/specs/2026-09-30-passage-search-design.md` (amended by the "Spec amendments" section below — the plan wins where they differ).

## Spec amendments made while planning

1. **Keyword arm is an in-memory BM25 over the chunks**, not the existing English full-text search. `search_english_sync` is a `LIKE '%query%'` full-table scan of one literal substring — wrong for multi-phrase, multi-word queries and too slow to call several times per search.
2. **JEV is called once per candidate (concurrency 8), not as one batched request.** 30 chunk-sized passages in one request risks JEV's documented weakness with large, unfocused inputs; the boundary experiment used per-question requests (≈0.26 s each, 0 failures in 34,000 calls) and this reuses that proven shape. A per-candidate failure drops that candidate; only *all* failing counts as JEV unavailable.
3. **The tile does not need JEV.** Availability = the index files load (`GET /passages/status`). No JEV key → the feature runs, results marked "relevance not verified".
4. **TSK numbering was verified** against `Complete.db`: every cross-reference verse maps except `3John.1.15` (skipped). The file is `https://a.openbible.info/data/cross-references.zip` (CC-BY, tab-separated `From Verse / To Verse / Votes`, refs like `Gen.1.1`, `Prov.8.22-Prov.8.30`).
5. **Embedding model verified:** `BAAI/bge-small-en-v1.5` is MIT-licensed, 384-d, about 67 MB quantized in `fastembed` 0.8.1 (`query_embed` / `passage_embed` exist; needs numpy ≥ 2.1 on Python 3.13, which the dev environment has).

## Global Constraints

- Search input: at most **500 characters**; a passage input of at most **25 verses** (`MAX_PASSAGE_VERSES = 25`, same as Deep Study).
- Candidates: top **20** per (query × arm); merged list capped at **30**; result list capped at **10**.
- JEV question options, in this order: `directly`, `partly`, `tangentially`, `not_relevant`. A candidate is kept only when its most probable label is `directly` or `partly` **and** confidence ≥ **0.5**. Score = `P(directly) + 0.6 × P(partly)`.
- Reciprocal-rank fusion constant **60**.
- Chunk data: **4,284** chunks covering all **31,102** canonical verses exactly once; sizes 2–16 verses. Committed as `chatbot/data/passage_chunks.json` (`[[first_verse_id, last_verse_id], …]`).
- Embedding model name is stored in `chatbot/data/passage_index_meta.json`; a mismatch with `passage_embed.MODEL_NAME` makes the index unavailable.
- Overall search budget **15 s**; stage caps: rewrite 8 s, JEV 5 s, reasons 15 s. A stage never gets less than 0.5 s.
- Fail open: JEV error/timeout/no key → unverified top 10; rewrite fails → original statement only; reasons fail → cards with empty `reason`; embedder fails → keyword-only + `semantic: false`; index missing/mismatched → `available: false`.
- Reasons prompt: state only what the passage says; take no doctrinal position; never invent.
- Never modify `Complete.db`.
- Attribution: when any result came from a cross-reference, the artifact shows "Cross-references: OpenBible.info (CC-BY), from the Treasury of Scripture Knowledge".
- Artifact type name `passage_search`; mode id `passages`; mode label "Find passages"; route strings begin `passages →`.
- No new frontend dependencies.

## Review Focus

1. **Empty or over-long input** ("" / spaces / 501+ characters) must give a friendly message and make no LLM, JEV or embedding call (Task 8).
2. **A bare chapter ("Romans 8") or a range over 25 verses** must ask for a narrower passage, not run an unbounded search or crash (Task 7).
3. **A passage query must never return its own passage** — including when the passage spans several chunks (Task 7).
4. **JEV answers only some candidates, returns malformed answers, or every request fails** — partial → the rest are dropped; all fail → unverified results with a visible note (Tasks 6 and 8).
5. **Every optional stage failing at once** (embedder returns nothing, LLM returns "", JEV unavailable) must still return keyword results, never raise (Task 8).

---

## File Structure

| File | Responsibility |
|---|---|
| `chatbot/data/passage_chunks.json` | Committed chunk boundaries (verse-id pairs). |
| `chatbot/data/passage_embeddings.npy` | Committed float32 vectors, one row per chunk, L2-normalised. |
| `chatbot/data/passage_index_meta.json` | Model name, dimension, chunk count. |
| `chatbot/data/tsk_crossrefs.json` | Committed TSK cross-references (verse id → `[target_verse_id, votes]`). |
| `chatbot/data/passage_eval.py` | ≈42 labelled eval queries. |
| `chatbot/passage_rank.py` | **Pure** ranking: RRF merge, JEV filter. |
| `chatbot/passage_index.py` | Verse/chunk loading, in-memory index: `nearest`, BM25 `keyword`, verse→chunk lookup. |
| `chatbot/passage_embed.py` | Local query/passage embedding (fastembed). |
| `chatbot/passage_tsk.py` | TSK cross-reference lookup. |
| `chatbot/jev_client.py` | `judge_relevance` — per-candidate JEV Choice requests. |
| `chatbot/passage_search.py` | Orchestrator: parse, rewrite, retrieve, filter, reasons, assemble. |
| `scripts/build_passage_index.py` | Offline: embed chunks → `.npy` + meta. |
| `scripts/build_tsk_crossrefs.py` | Offline: OpenBible file → `tsk_crossrefs.json`. |
| `scripts/eval_passages.py` | Live manual eval (recall, off-topic, JEV on/off). |
| `experiments/chunking/*.py` | Provenance of the chunk boundaries (scripts only; results stay gitignored). |
| Frontend: `PassageSearchArtifact.tsx` (+test), types, `chatApi.ts`, `useArtifactStore.ts`, `useSessionsStore.ts`, `ArtifactPane.tsx`, `ModePickerScreen.tsx`, `SessionsPane.tsx`, `ChatPane.tsx` | New artifact + mode wiring, same pattern as the other modes. |

---

### Task 1: Commit the chunk data and its provenance

**Files:**
- Create: `chatbot/data/passage_chunks.json` (copy of `experiments/chunking/results/chunks_all.json`)
- Create: `tests/chatbot/test_passage_chunks_data.py`
- Add to git (already written, currently untracked): `experiments/chunking/common.py`, `fetch_ground_truth.py`, `make_sample.py`, `run_experiment.py`, `score_books.py`, `build_chunks.py`, `.gitignore`

**Interfaces:**
- Produces: `chatbot/data/passage_chunks.json` — a JSON list of `[first_verse_id, last_verse_id]` pairs (ints, `Complete.db` `id` values), sorted, contiguous, covering ids 1–31102.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_passage_chunks_data.py
"""The committed chunk table must cover every canonical verse exactly once."""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHUNKS = ROOT / "chatbot" / "data" / "passage_chunks.json"


def _verse_books():
    con = sqlite3.connect(f"file:{ROOT / 'Complete.db'}?mode=ro", uri=True)
    rows = con.execute("SELECT id, bnum FROM Complete ORDER BY id").fetchall()
    con.close()
    return dict(rows)


def test_chunks_cover_every_verse_exactly_once():
    pairs = json.loads(CHUNKS.read_text())
    books = _verse_books()
    assert len(books) == 31102
    assert pairs[0][0] == 1
    assert pairs[-1][1] == 31102
    for (a, b), nxt in zip(pairs, pairs[1:] + [None]):
        assert a <= b
        if nxt is not None:
            assert nxt[0] == b + 1, f"gap or overlap after {b}"


def test_chunks_are_two_to_sixteen_verses_and_stay_inside_one_book():
    pairs = json.loads(CHUNKS.read_text())
    books = _verse_books()
    assert len(pairs) == 4284
    for a, b in pairs:
        assert 2 <= b - a + 1 <= 16, (a, b)
        assert books[a] == books[b], f"chunk {a}-{b} crosses a book"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest tests/chatbot/test_passage_chunks_data.py -v`
Expected: FAIL (`FileNotFoundError` for `passage_chunks.json`).

- [ ] **Step 3: Copy the data and commit the provenance scripts**

```bash
cp experiments/chunking/results/chunks_all.json chatbot/data/passage_chunks.json
```

`experiments/chunking/.gitignore` already ignores `results/` and `__pycache__/`. Create `experiments/chunking/README.md`:

```markdown
# Chunk-boundary experiment

Produced `chatbot/data/passage_chunks.json`.

1. `fetch_ground_truth.py` — BSB section headings (public domain, bible.helloao.org) → `ground_truth.json`.
2. `make_sample.py` + `run_experiment.py` — 300 balanced boundaries; JEV vs a TF-IDF baseline (JEV AUC 0.924 vs 0.635).
3. `score_books.py --all` — JEV P(new_section) for every boundary (≈30,800 calls) → `results/boundary_scores.json` (gitignored; re-cutting needs no new calls).
4. `build_chunks.py --all` — threshold 0.7, min 2 / max 16 verses, no cut after a speech introduction ("…saying,") → `results/chunks_all.json`, copied to `chatbot/data/passage_chunks.json`.

Needs `TYPESAFE_API_KEY` (`set -a; . ../../.env; set +a`).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/chatbot/test_passage_chunks_data.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add chatbot/data/passage_chunks.json tests/chatbot/test_passage_chunks_data.py experiments/chunking/*.py experiments/chunking/README.md experiments/chunking/.gitignore
git commit -m "feat(passages): commit JEV-cut chunk table and its provenance scripts"
```

---

### Task 2: Pure ranking functions

**Files:**
- Create: `chatbot/passage_rank.py`
- Test: `tests/chatbot/test_passage_rank.py`

**Interfaces:**
- Produces (used by Tasks 7, 8):
  - `Candidate(chunk_id: int, sources: Tuple[str, ...], rrf: float)` frozen dataclass
  - `Relevance(chunk_id: int, probabilities: Dict[str, float], confidence: float)` frozen dataclass
  - `Ranked(candidate: Candidate, label: str, score: float)` frozen dataclass
  - `rrf_merge(ranked_lists: Sequence[Tuple[str, Sequence[int]]], limit: int = CANDIDATE_LIMIT) -> List[Candidate]`
  - `jev_filter(candidates: Sequence[Candidate], relevance: Dict[int, Relevance], limit: int = RESULT_LIMIT) -> List[Ranked]`
  - `unverified(candidates: Sequence[Candidate], limit: int = RESULT_LIMIT) -> List[Ranked]` (label `"unverified"`, score 0.0)
  - constants `RRF_K = 60`, `CANDIDATE_LIMIT = 30`, `RESULT_LIMIT = 10`, `LABELS`, `KEEP_LABELS`, `CONFIDENCE_FLOOR = 0.5`, `PARTLY_WEIGHT = 0.6`

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_passage_rank.py
from chatbot.passage_rank import (
    CANDIDATE_LIMIT, RESULT_LIMIT, Candidate, Relevance,
    jev_filter, rrf_merge, unverified,
)


def rel(cid, directly=0.0, partly=0.0, tangentially=0.0, not_relevant=0.0, confidence=0.9):
    return Relevance(cid, {"directly": directly, "partly": partly,
                           "tangentially": tangentially, "not_relevant": not_relevant}, confidence)


def test_rrf_ranks_items_present_in_several_lists_first():
    merged = rrf_merge([("embedding", [1, 2, 3]), ("keyword", [3, 1, 9])])
    assert [c.chunk_id for c in merged][:2] == [1, 3]        # both lists rank 1 and 3 high
    assert merged[0].sources == ("embedding", "keyword")


def test_rrf_dedupes_within_a_list_and_records_sources_once():
    merged = rrf_merge([("keyword", [5, 5, 5]), ("keyword", [5])])
    assert len(merged) == 1 and merged[0].sources == ("keyword",)


def test_rrf_limit_and_stable_tie_break_by_chunk_id():
    merged = rrf_merge([("a", [10]), ("b", [3])])           # equal scores
    assert [c.chunk_id for c in merged] == [3, 10]
    big = rrf_merge([("a", list(range(100)))])
    assert len(big) == CANDIDATE_LIMIT


def test_rrf_empty_input():
    assert rrf_merge([]) == []
    assert rrf_merge([("a", [])]) == []


def test_filter_keeps_directly_and_partly_only():
    cands = rrf_merge([("a", [1, 2, 3, 4])])
    relevance = {
        1: rel(1, directly=0.8, not_relevant=0.2),
        2: rel(2, partly=0.7, tangentially=0.3),
        3: rel(3, tangentially=0.8, partly=0.2),
        4: rel(4, not_relevant=0.9, directly=0.1),
    }
    kept = jev_filter(cands, relevance)
    assert [r.candidate.chunk_id for r in kept] == [1, 2]
    assert [r.label for r in kept] == ["directly", "partly"]


def test_filter_drops_low_confidence_and_missing_answers():
    cands = rrf_merge([("a", [1, 2, 3])])
    relevance = {1: rel(1, directly=0.9, confidence=0.3), 2: rel(2, directly=0.9)}   # 3 unanswered
    assert [r.candidate.chunk_id for r in jev_filter(cands, relevance)] == [2]


def test_filter_orders_by_score_then_retrieval_rank_and_caps():
    cands = rrf_merge([("a", list(range(1, 16)))])
    relevance = {i: rel(i, directly=0.9) for i in range(1, 16)}
    relevance[15] = rel(15, directly=0.99)                   # best score, worst retrieval rank
    kept = jev_filter(cands, relevance)
    assert len(kept) == RESULT_LIMIT
    assert kept[0].candidate.chunk_id == 15
    assert [r.candidate.chunk_id for r in kept[1:4]] == [1, 2, 3]   # ties keep retrieval order


def test_filter_returns_empty_when_nothing_is_relevant():
    cands = rrf_merge([("a", [1, 2])])
    relevance = {1: rel(1, not_relevant=0.95), 2: rel(2, tangentially=0.9)}
    assert jev_filter(cands, relevance) == []


def test_unverified_keeps_retrieval_order_and_caps():
    cands = rrf_merge([("a", list(range(1, 25)))])
    out = unverified(cands)
    assert [r.candidate.chunk_id for r in out] == list(range(1, RESULT_LIMIT + 1))
    assert {r.label for r in out} == {"unverified"}
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/chatbot/test_passage_rank.py -v`
Expected: FAIL (`ModuleNotFoundError: chatbot.passage_rank`).

- [ ] **Step 3: Implement**

```python
# chatbot/passage_rank.py
"""Pure ranking functions for "Find passages" — no I/O, no clocks.

rrf_merge fuses several ranked chunk lists (embedding, keyword, TSK
cross-reference); jev_filter turns JEV's per-candidate relevance answers
into the final ordered list. Thresholds are named constants: tune them only
with scripts/eval_passages.py. See
docs/superpowers/specs/2026-09-30-passage-search-design.md."""

from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

RRF_K = 60
CANDIDATE_LIMIT = 30
RESULT_LIMIT = 10
LABELS: Tuple[str, ...] = ("directly", "partly", "tangentially", "not_relevant")
KEEP_LABELS: Tuple[str, ...] = ("directly", "partly")
CONFIDENCE_FLOOR = 0.5
PARTLY_WEIGHT = 0.6


@dataclass(frozen=True)
class Candidate:
    chunk_id: int
    sources: Tuple[str, ...]
    rrf: float


@dataclass(frozen=True)
class Relevance:
    chunk_id: int
    probabilities: Dict[str, float]
    confidence: float


@dataclass(frozen=True)
class Ranked:
    candidate: Candidate
    label: str
    score: float


def rrf_merge(
    ranked_lists: Sequence[Tuple[str, Sequence[int]]], limit: int = CANDIDATE_LIMIT
) -> List[Candidate]:
    scores: Dict[int, float] = {}
    sources: Dict[int, List[str]] = {}
    for source, ids in ranked_lists:
        seen = set()
        for rank, chunk_id in enumerate(ids):
            if chunk_id in seen:
                continue
            seen.add(chunk_id)
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank + 1)
            named = sources.setdefault(chunk_id, [])
            if source not in named:
                named.append(source)
    ordered = sorted(scores, key=lambda c: (-scores[c], c))[:limit]
    return [Candidate(c, tuple(sources[c]), scores[c]) for c in ordered]


def _label(probabilities: Dict[str, float]) -> str:
    return max(LABELS, key=lambda name: (probabilities.get(name, 0.0), -LABELS.index(name)))


def jev_filter(
    candidates: Sequence[Candidate], relevance: Dict[int, Relevance], limit: int = RESULT_LIMIT
) -> List[Ranked]:
    kept: List[Ranked] = []
    for candidate in candidates:
        answer = relevance.get(candidate.chunk_id)
        if answer is None or answer.confidence < CONFIDENCE_FLOOR:
            continue
        label = _label(answer.probabilities)
        if label not in KEEP_LABELS:
            continue
        score = answer.probabilities.get("directly", 0.0) + PARTLY_WEIGHT * answer.probabilities.get("partly", 0.0)
        kept.append(Ranked(candidate, label, score))
    kept.sort(key=lambda r: (-r.score, -r.candidate.rrf, r.candidate.chunk_id))
    return kept[:limit]


def unverified(candidates: Sequence[Candidate], limit: int = RESULT_LIMIT) -> List[Ranked]:
    return [Ranked(c, "unverified", 0.0) for c in candidates[:limit]]
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/chatbot/test_passage_rank.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add chatbot/passage_rank.py tests/chatbot/test_passage_rank.py
git commit -m "feat(passages): pure RRF merge and JEV relevance filter"
```

---

### Task 3: The chunk index (verses, chunks, nearest, BM25)

**Files:**
- Create: `chatbot/passage_index.py`
- Test: `tests/chatbot/test_passage_index.py`

**Interfaces:**
- Consumes: `chatbot/data/passage_chunks.json` (Task 1). `passage_embed.MODEL_NAME` (Task 4) is imported lazily inside the loader only, so this task is testable first: until Task 4 exists, the loader test passes `expected_model` explicitly.
- Produces (used by Tasks 4, 5, 7, 8):
  - `Verse(id: int, ref: str, chapter: int, verse: int, text: str)` frozen dataclass
  - `Chunk(id: int, first_id: int, last_id: int, ref: str, first_ref: str, text: str, plain: str, embed_text: str)` frozen dataclass — `text` shows verse numbers (`"[1] … [2] …"`), `plain` is bare text, `embed_text` is `"<Book> <chapter> — <plain>"`
  - `load_verses(db_file: Path = DB_FILE) -> List[Verse]`
  - `build_chunks(pairs: Sequence[Sequence[int]], verses: Sequence[Verse]) -> List[Chunk]`
  - `class Index`: `Index(chunks: List[Chunk], vectors: np.ndarray, verses: List[Verse])`; `.chunks`; `.nearest(vector, k) -> List[int]`; `.keyword(query, k) -> List[int]`; `.chunk_ids_for_verses(verse_ids) -> List[int]` (ordered by first appearance, deduped); `.verse_id_for_ref(ref) -> Optional[int]`; `.chunk_span(chunk_id) -> Tuple[int, int]`
  - `get_index() -> Optional[Index]` (lazy, thread-safe, cached incl. failure), `_reset() -> None` (tests), `load_index(...) -> Index` (raises on any problem)
  - `tokenize(text: str) -> List[str]`

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_passage_index.py
import json

import numpy as np
import pytest

from chatbot import passage_index
from chatbot.passage_index import Chunk, Index, Verse, build_chunks, load_verses, tokenize


def _verses():
    texts = [
        ("Genesis 1:1", 1, 1, "In the beginning God created the heaven and the earth."),
        ("Genesis 1:2", 1, 2, "And the earth was without form, and void."),
        ("Genesis 1:3", 1, 3, "And God said, Let there be light: and there was light."),
        ("Genesis 2:1", 2, 1, "Thus the heavens and the earth were finished."),
        ("Genesis 2:2", 2, 2, "And on the seventh day God ended his work which he had made."),
    ]
    return [Verse(i + 1, r, c, v, t) for i, (r, c, v, t) in enumerate(texts)]


def test_build_chunks_refs_and_texts():
    chunks = build_chunks([[1, 3], [4, 5]], _verses())
    assert [c.ref for c in chunks] == ["Genesis 1:1-3", "Genesis 2:1-2"]
    assert chunks[0].first_ref == "Genesis 1:1"
    assert chunks[0].text.startswith("[1] In the beginning")
    assert "[2] And the earth" in chunks[0].text
    assert chunks[0].plain.startswith("In the beginning God created")
    assert chunks[0].embed_text.startswith("Genesis 1 — In the beginning")


def test_build_chunks_cross_chapter_ref():
    chunks = build_chunks([[2, 4]], _verses())
    assert chunks[0].ref == "Genesis 1:2-2:1"


def _index():
    verses = _verses()
    chunks = build_chunks([[1, 3], [4, 5]], verses)
    vectors = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    return Index(chunks, vectors, verses)


def test_nearest_orders_by_cosine():
    idx = _index()
    assert idx.nearest(np.array([0.1, 0.9], dtype=np.float32), 2) == [1, 0]
    assert idx.nearest(np.array([1.0, 0.0], dtype=np.float32), 1) == [0]


def test_keyword_ranks_matching_chunk_first_and_ignores_stopwords():
    idx = _index()
    assert idx.keyword("the seventh day", 5) == [1]
    assert idx.keyword("light", 5) == [0]
    assert idx.keyword("the and of", 5) == []          # only stopwords
    assert idx.keyword("zzzz", 5) == []


def test_keyword_stems_kjv_endings():
    idx = _index()
    assert idx.keyword("creating", 5) == [0]           # created / creating share a stem


def test_chunk_ids_for_verses_dedupes_and_orders():
    idx = _index()
    assert idx.chunk_ids_for_verses([2, 3]) == [0]
    assert idx.chunk_ids_for_verses([5, 1, 2]) == [1, 0]
    assert idx.chunk_ids_for_verses([999]) == []


def test_verse_id_for_ref_and_chunk_span():
    idx = _index()
    assert idx.verse_id_for_ref("Genesis 2:2") == 5
    assert idx.verse_id_for_ref("Nope 1:1") is None
    assert idx.chunk_span(1) == (4, 5)


def test_tokenize_folds_case_apostrophes_and_stopwords():
    assert tokenize("The LORD'S servants") == ["lord", "servant"]


def test_real_verses_and_chunks_load():
    verses = load_verses()
    assert len(verses) == 31102
    assert verses[0].ref == "Genesis 1:1"
    assert "<" not in verses[0].text
    pairs = json.loads((passage_index.DATA_DIR / "passage_chunks.json").read_text())
    chunks = build_chunks(pairs, verses)
    assert len(chunks) == 4284
    assert chunks[0].ref.startswith("Genesis 1:1-")


def test_load_index_rejects_a_model_mismatch(tmp_path):
    meta = tmp_path / "meta.json"
    meta.write_text(json.dumps({"model": "other", "dim": 2, "chunks": 4284}))
    vecs = tmp_path / "v.npy"
    np.save(vecs, np.zeros((4284, 2), dtype=np.float32))
    with pytest.raises(ValueError, match="model"):
        passage_index.load_index(vectors_file=vecs, meta_file=meta, expected_model="expected")


def test_load_index_rejects_a_row_count_mismatch(tmp_path):
    meta = tmp_path / "meta.json"
    meta.write_text(json.dumps({"model": "m", "dim": 2, "chunks": 4284}))
    vecs = tmp_path / "v.npy"
    np.save(vecs, np.zeros((10, 2), dtype=np.float32))
    with pytest.raises(ValueError, match="rows"):
        passage_index.load_index(vectors_file=vecs, meta_file=meta, expected_model="m")


def test_get_index_returns_none_when_files_are_missing(monkeypatch, tmp_path):
    passage_index._reset()
    monkeypatch.setattr(passage_index, "VECTORS_FILE", tmp_path / "missing.npy")
    assert passage_index.get_index() is None
    passage_index._reset()
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/chatbot/test_passage_index.py -v`
Expected: FAIL (`ModuleNotFoundError: chatbot.passage_index`).

- [ ] **Step 3: Implement**

```python
# chatbot/passage_index.py
"""In-memory index over the JEV-cut Bible chunks for "Find passages".

Loads the 31,102 KJV verses from Complete.db (read-only) and the committed
chunk table, builds chunk texts, and serves two retrieval arms: cosine
`nearest` over the committed embeddings and an in-memory BM25 `keyword`
search. Loaded once, lazily and thread-safely. A missing/mismatched index
makes get_index() return None (the mode then reports unavailable).
See docs/superpowers/specs/2026-09-30-passage-search-design.md."""

import json
import logging
import math
import re
import sqlite3
import threading
from bisect import bisect_right
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.parse import quote

import numpy as np

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent / "data"
CHUNKS_FILE = DATA_DIR / "passage_chunks.json"
VECTORS_FILE = DATA_DIR / "passage_embeddings.npy"
META_FILE = DATA_DIR / "passage_index_meta.json"
DB_FILE = Path(__file__).resolve().parent.parent / "Complete.db"

_FOOTNOTE_RE = re.compile(r"<f\b[^>]*>.*?</f>", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")
_WORD_RE = re.compile(r"[a-z']+")
_SUFFIXES = ("eth", "est", "ing", "ed", "es", "s")
STOPWORDS = frozenset("""
a an the and or but nor of to in on at by for with from as into unto upon is are was were be been
being am it its this that these those there here he she they them his her their him i me my we us
our you your ye thee thou thy thine not no so if then than when which who whom whose what shall
will would should can could may might must do does did doth hath have has had let all also
""".split())
BM25_K1 = 1.5
BM25_B = 0.75


@dataclass(frozen=True)
class Verse:
    id: int
    ref: str
    chapter: int
    verse: int
    text: str


@dataclass(frozen=True)
class Chunk:
    id: int
    first_id: int
    last_id: int
    ref: str
    first_ref: str
    text: str
    plain: str
    embed_text: str


def clean_text(raw: str) -> str:
    text = _FOOTNOTE_RE.sub("", raw or "")
    text = _TAG_RE.sub("", text)
    return _SPACE_RE.sub(" ", text).strip()


def load_verses(db_file: Path = DB_FILE) -> List[Verse]:
    con = sqlite3.connect(f"file:{quote(str(db_file))}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT id, ref, cnum, vnum, text_1769 FROM Complete ORDER BY id").fetchall()
    finally:
        con.close()
    return [Verse(r[0], r[1], int(r[2]), int(r[3]), clean_text(r[4])) for r in rows]


def _book_label(ref: str) -> str:
    return ref.rsplit(" ", 1)[0]


def build_chunks(pairs: Sequence[Sequence[int]], verses: Sequence[Verse]) -> List[Chunk]:
    position = {v.id: i for i, v in enumerate(verses)}
    chunks: List[Chunk] = []
    for n, (first_id, last_id) in enumerate(pairs):
        span = verses[position[first_id]: position[last_id] + 1]
        first, last = span[0], span[-1]
        if last.id == first.id:
            ref = first.ref
        elif last.chapter == first.chapter:
            ref = f"{first.ref}-{last.verse}"
        else:
            ref = f"{first.ref}-{last.chapter}:{last.verse}"
        plain = " ".join(v.text for v in span)
        chunks.append(Chunk(
            id=n, first_id=first_id, last_id=last_id, ref=ref, first_ref=first.ref,
            text=" ".join(f"[{v.verse}] {v.text}" for v in span), plain=plain,
            embed_text=f"{_book_label(first.ref)} {first.chapter} — {plain}",
        ))
    return chunks


def _stem(word: str) -> str:
    word = word.replace("'", "")
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


def tokenize(text: str) -> List[str]:
    words = _WORD_RE.findall(text.lower().replace("’", "'"))
    return [_stem(w) for w in words if w.replace("'", "") not in STOPWORDS and len(w.replace("'", "")) > 1]


class Index:
    def __init__(self, chunks: List[Chunk], vectors: np.ndarray, verses: Sequence[Verse]):
        self.chunks = chunks
        self.vectors = vectors
        self._first_ids = [c.first_id for c in chunks]
        self._ref_to_id = {v.ref: v.id for v in verses}
        self._postings: Dict[str, List[Tuple[int, int]]] = defaultdict(list)
        self._lengths: List[int] = []
        for chunk in chunks:
            tokens = tokenize(chunk.plain)
            self._lengths.append(len(tokens))
            for term, count in Counter(tokens).items():
                self._postings[term].append((chunk.id, count))
        self._avg_len = (sum(self._lengths) / len(self._lengths)) if self._lengths else 1.0

    def nearest(self, vector: np.ndarray, k: int) -> List[int]:
        if not len(self.chunks):
            return []
        scores = self.vectors @ vector
        return [int(i) for i in np.argsort(-scores, kind="stable")[:k]]

    def keyword(self, query: str, k: int) -> List[int]:
        n = len(self.chunks)
        scores: Dict[int, float] = defaultdict(float)
        for term in set(tokenize(query)):
            postings = self._postings.get(term)
            if not postings:
                continue
            idf = math.log(1 + (n - len(postings) + 0.5) / (len(postings) + 0.5))
            for chunk_id, tf in postings:
                norm = tf + BM25_K1 * (1 - BM25_B + BM25_B * self._lengths[chunk_id] / self._avg_len)
                scores[chunk_id] += idf * tf * (BM25_K1 + 1) / norm
        ordered = sorted(scores, key=lambda c: (-scores[c], c))
        return ordered[:k]

    def chunk_ids_for_verses(self, verse_ids: Sequence[int]) -> List[int]:
        out: List[int] = []
        for verse_id in verse_ids:
            i = bisect_right(self._first_ids, verse_id) - 1
            if i >= 0 and self.chunks[i].last_id >= verse_id and i not in out:
                out.append(i)
        return out

    def verse_id_for_ref(self, ref: str) -> Optional[int]:
        return self._ref_to_id.get(ref)

    def chunk_span(self, chunk_id: int) -> Tuple[int, int]:
        chunk = self.chunks[chunk_id]
        return chunk.first_id, chunk.last_id


def load_index(
    chunks_file: Path = None, vectors_file: Path = None, meta_file: Path = None,
    db_file: Path = None, expected_model: Optional[str] = None,
) -> Index:
    chunks_file = chunks_file or CHUNKS_FILE
    vectors_file = vectors_file or VECTORS_FILE
    meta_file = meta_file or META_FILE
    if expected_model is None:
        from chatbot.passage_embed import MODEL_NAME as expected_model
    meta = json.loads(meta_file.read_text())
    if meta.get("model") != expected_model:
        raise ValueError(f"index built with model {meta.get('model')!r}, runtime uses {expected_model!r}")
    vectors = np.load(vectors_file).astype(np.float32)
    pairs = json.loads(chunks_file.read_text())
    if vectors.shape[0] != len(pairs) or meta.get("chunks") != len(pairs):
        raise ValueError(f"vector rows {vectors.shape[0]} != chunks {len(pairs)}")
    if vectors.ndim != 2 or vectors.shape[1] != meta.get("dim"):
        raise ValueError("vector dimension does not match the meta file")
    verses = load_verses(db_file or DB_FILE)
    return Index(build_chunks(pairs, verses), vectors, verses)


_INDEX: Optional[Index] = None
_LOADED = False
_LOCK = threading.Lock()


def get_index() -> Optional[Index]:
    global _INDEX, _LOADED
    if _LOADED:
        return _INDEX
    with _LOCK:
        if not _LOADED:
            try:
                _INDEX = load_index()
            except Exception:  # noqa: BLE001 — a missing/mismatched index means "unavailable"
                logger.warning("passage index unavailable", exc_info=True)
                _INDEX = None
            _LOADED = True
    return _INDEX


def _reset() -> None:
    global _INDEX, _LOADED
    with _LOCK:
        _INDEX, _LOADED = None, False
```

Note: `test_get_index_returns_none_when_files_are_missing` monkeypatches `VECTORS_FILE`; `load_index` reads the module constants at call time (`vectors_file or VECTORS_FILE`), so the patched value is used.

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/chatbot/test_passage_index.py -v`
Expected: 12 passed. (`test_real_verses_and_chunks_load` reads the real `Complete.db`.)

- [ ] **Step 5: Commit**

```bash
git add chatbot/passage_index.py tests/chatbot/test_passage_index.py
git commit -m "feat(passages): in-memory chunk index with cosine and BM25 retrieval"
```

---

### Task 4: Local embeddings, the index build script, and the committed vectors

**Files:**
- Create: `chatbot/passage_embed.py`
- Create: `scripts/build_passage_index.py`
- Create: `chatbot/data/passage_embeddings.npy`, `chatbot/data/passage_index_meta.json` (generated, then committed)
- Modify: `requirements.txt` (add `fastembed`), `Dockerfile.chatbot` (pre-fetch the model)
- Test: `tests/chatbot/test_passage_embed.py`

**Interfaces:**
- Consumes: `passage_index.load_verses`, `passage_index.build_chunks`, `CHUNKS_FILE`, `VECTORS_FILE`, `META_FILE` (Task 3).
- Produces (used by Tasks 3's loader, 7, 8):
  - `MODEL_NAME = "BAAI/bge-small-en-v1.5"`, `EMBED_DIM = 384`
  - `embed_queries(texts: Sequence[str]) -> Optional[np.ndarray]` — shape `(len(texts), 384)`, L2-normalised float32, or `None` on any failure / empty input
  - `embed_passages(texts: Sequence[str]) -> np.ndarray` — same shape/normalisation; raises on failure (build-time only)

- [ ] **Step 1: Install and verify the model (the spec's pre-planning check)**

```bash
pip install "fastembed>=0.4,<1"
python - <<'EOF'
import time
t=time.time()
from fastembed import TextEmbedding
m = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
print("load s:", round(time.time()-t,1))
t=time.time()
for _ in range(20): list(m.query_embed(["Where is the rapture talked about in the Bible?"]))
print("per-query ms:", round((time.time()-t)/20*1000,1))
print(len(list(m.query_embed(["x"]))[0]))
EOF
```
Expected: load under ~30 s on first run (downloads ≈67 MB), per-query under ~300 ms, dimension `384`. **Record the three numbers in the task report** (Task 12 puts them in DEPLOYMENT.md). If per-query exceeds 1 s or load exceeds 60 s, stop and report BLOCKED.

- [ ] **Step 2: Write the failing tests**

```python
# tests/chatbot/test_passage_embed.py
import numpy as np
import pytest

from chatbot import passage_embed

pytest.importorskip("fastembed")


def test_embed_queries_shape_and_unit_norm():
    out = passage_embed.embed_queries(["caught up in the clouds", "light"])
    assert out.shape == (2, passage_embed.EMBED_DIM)
    assert out.dtype == np.float32
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-4)


def test_related_text_scores_higher_than_unrelated():
    q = passage_embed.embed_queries(["believers will be caught up together in the clouds to meet the Lord"])[0]
    near, far = passage_embed.embed_passages([
        "Then we which are alive and remain shall be caught up together with them in the clouds, to meet the Lord in the air",
        "And God said, Let there be light: and there was light.",
    ])
    assert float(q @ near) > float(q @ far)


def test_embed_queries_returns_none_on_failure(monkeypatch):
    def boom():
        raise RuntimeError("model missing")
    monkeypatch.setattr(passage_embed, "_model", boom)
    assert passage_embed.embed_queries(["x"]) is None


def test_embed_queries_returns_none_for_no_text():
    assert passage_embed.embed_queries([]) is None
```

- [ ] **Step 3: Run to verify failure**

Run: `pytest tests/chatbot/test_passage_embed.py -v`
Expected: FAIL (`ModuleNotFoundError: chatbot.passage_embed`).

- [ ] **Step 4: Implement `chatbot/passage_embed.py`**

```python
# chatbot/passage_embed.py
"""Local query/passage embeddings for "Find passages" — a small ONNX model
run through fastembed, so the chatbot image needs no PyTorch. The model
name is stored in passage_index_meta.json; a mismatch makes the index
unavailable (see passage_index.load_index)."""

import logging
import threading
from typing import Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)

MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384

_MODEL = None
_LOCK = threading.Lock()


def _model():
    global _MODEL
    with _LOCK:
        if _MODEL is None:
            from fastembed import TextEmbedding
            _MODEL = TextEmbedding(model_name=MODEL_NAME)
        return _MODEL


def _normalise(rows) -> np.ndarray:
    array = np.asarray(list(rows), dtype=np.float32)
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    return array / np.maximum(norms, 1e-9)


def embed_queries(texts: Sequence[str]) -> Optional[np.ndarray]:
    if not texts:
        return None
    try:
        return _normalise(_model().query_embed(list(texts)))
    except Exception:  # noqa: BLE001 — semantic search is optional; callers fall back to keywords
        logger.warning("passages: query embedding failed", exc_info=True)
        return None


def embed_passages(texts: Sequence[str]) -> np.ndarray:
    return _normalise(_model().passage_embed(list(texts)))
```

- [ ] **Step 5: Run to verify pass**

Run: `pytest tests/chatbot/test_passage_embed.py -v`
Expected: 4 passed.

- [ ] **Step 6: Write the build script**

```python
# scripts/build_passage_index.py
"""Embed every chunk (book/chapter prepended) and write the committed index
files. Run once, or whenever passage_chunks.json or the model changes:

    python scripts/build_passage_index.py

Outputs chatbot/data/passage_embeddings.npy (float32, one row per chunk,
L2-normalised) and passage_index_meta.json (model, dim, chunk count)."""
import json
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chatbot import passage_embed, passage_index  # noqa: E402

BATCH = 256


def main() -> None:
    verses = passage_index.load_verses()
    pairs = json.loads(passage_index.CHUNKS_FILE.read_text())
    chunks = passage_index.build_chunks(pairs, verses)
    print(f"embedding {len(chunks)} chunks with {passage_embed.MODEL_NAME}")
    started = time.time()
    parts = []
    for i in range(0, len(chunks), BATCH):
        parts.append(passage_embed.embed_passages([c.embed_text for c in chunks[i:i + BATCH]]))
        print(f"  {min(i + BATCH, len(chunks))}/{len(chunks)}")
    vectors = np.concatenate(parts).astype(np.float32)
    assert vectors.shape == (len(chunks), passage_embed.EMBED_DIM), vectors.shape
    np.save(passage_index.VECTORS_FILE, vectors)
    passage_index.META_FILE.write_text(json.dumps({
        "model": passage_embed.MODEL_NAME,
        "dim": int(vectors.shape[1]),
        "chunks": len(chunks),
        "built": date.today().isoformat(),
    }, indent=1))
    print(f"done in {time.time() - started:.0f}s → {passage_index.VECTORS_FILE.name} "
          f"({passage_index.VECTORS_FILE.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Run the build**

Run: `python scripts/build_passage_index.py`
Expected: prints progress to `4284/4284`, then `done in …s → passage_embeddings.npy (≈6.6 MB)`. Then a sanity check that the index loads and answers a real query:

```bash
python - <<'EOF'
from chatbot import passage_index, passage_embed
idx = passage_index.get_index(); assert idx is not None
q = passage_embed.embed_queries(["believers caught up together in the clouds to meet the Lord in the air"])[0]
for c in idx.nearest(q, 5): print(idx.chunks[c].ref)
EOF
```
Expected: `1 Thessalonians 4:…` appears among the five refs. If it does not, stop and report — the embeddings or chunk texts are wrong.

- [ ] **Step 8: Add the dependency and the Docker model pre-fetch**

In `requirements.txt`, under the chatbot dependencies (after the `google-genai` line) add:

```
fastembed>=0.4.0,<1                 # chatbot/passage_embed.py: local ONNX embeddings (Find passages)
```

In `Dockerfile.chatbot`, replace the line `RUN pip install --no-cache-dir -r requirements.txt "pyyaml>=6.0"` with:

```dockerfile
RUN pip install --no-cache-dir -r requirements.txt "pyyaml>=6.0"

# Find passages: fastembed downloads its ONNX model on first use. Fetch it at
# build time into a fixed path so the container never downloads at request
# time (and the model survives restarts). Must match chatbot/passage_embed.py.
ENV FASTEMBED_CACHE_PATH=/opt/fastembed_cache
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='BAAI/bge-small-en-v1.5')"
```

If Docker is available, run `docker compose build chatbot` and report the resulting image size; if it is not available, say so in the report (do not guess).

- [ ] **Step 9: Commit**

```bash
git add chatbot/passage_embed.py scripts/build_passage_index.py chatbot/data/passage_embeddings.npy chatbot/data/passage_index_meta.json requirements.txt Dockerfile.chatbot tests/chatbot/test_passage_embed.py
git commit -m "feat(passages): local ONNX embeddings and the committed chunk vectors"
```

---

### Task 5: TSK cross-references

**Files:**
- Create: `scripts/build_tsk_crossrefs.py`
- Create: `chatbot/passage_tsk.py`
- Create: `chatbot/data/tsk_crossrefs.json` (generated, then committed)
- Test: `tests/chatbot/test_passage_tsk.py`

**Interfaces:**
- Produces (used by Task 7):
  - `passage_tsk.related_verse_ids(verse_ids: Sequence[int], limit: int = 60) -> List[int]` — target verse ids ordered by summed votes across the given source verses, highest first; `[]` when the data file is missing
  - `passage_tsk.ATTRIBUTION: str = "Cross-references: OpenBible.info (CC-BY), from the Treasury of Scripture Knowledge"`
  - In `scripts/build_tsk_crossrefs.py`: `parse_ref(text: str) -> Optional[Tuple[int, int, int]]` returning `(book_number, chapter, verse)`; `ABBREVIATIONS` (66 entries in canonical order)

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_passage_tsk.py
import importlib.util
import json
from pathlib import Path

from chatbot import passage_tsk

ROOT = Path(__file__).resolve().parents[2]


def _script():
    spec = importlib.util.spec_from_file_location("build_tsk", ROOT / "scripts" / "build_tsk_crossrefs.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_parse_ref_handles_plain_and_range_starts():
    build = _script()
    assert build.parse_ref("Gen.1.1") == (1, 1, 1)
    assert build.parse_ref("Prov.8.22-Prov.8.30") == (20, 8, 22)     # range → its first verse
    assert build.parse_ref("1Thess.4.17") == (52, 4, 17)
    assert build.parse_ref("Rev.22.21") == (66, 22, 21)
    assert build.parse_ref("Nonsense.1.1") is None
    assert len(build.ABBREVIATIONS) == 66


def test_related_verse_ids_sums_votes_and_orders(monkeypatch):
    monkeypatch.setattr(passage_tsk, "_TABLE", {"1": [[10, 5], [20, 9]], "2": [[10, 7], [30, 1]]})
    monkeypatch.setattr(passage_tsk, "_LOADED", True)
    assert passage_tsk.related_verse_ids([1, 2]) == [10, 20, 30]        # 10 → 12 votes
    assert passage_tsk.related_verse_ids([1, 2], limit=1) == [10]
    assert passage_tsk.related_verse_ids([99]) == []


def test_related_verse_ids_is_empty_when_the_file_is_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(passage_tsk, "TSK_FILE", tmp_path / "nope.json")
    monkeypatch.setattr(passage_tsk, "_LOADED", False)
    monkeypatch.setattr(passage_tsk, "_TABLE", {})
    assert passage_tsk.related_verse_ids([1]) == []


def test_committed_table_is_well_formed():
    table = json.loads((ROOT / "chatbot" / "data" / "tsk_crossrefs.json").read_text())
    assert len(table) > 15000
    for key, targets in list(table.items())[:500]:
        assert 1 <= int(key) <= 31102
        assert 1 <= len(targets) <= 25
        for target_id, votes in targets:
            assert 1 <= target_id <= 31102 and votes >= 5
    assert len(table["1"]) >= 5            # Genesis 1:1 is heavily cross-referenced
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/chatbot/test_passage_tsk.py -v`
Expected: FAIL (module/script not found).

- [ ] **Step 3: Implement the build script**

```python
# scripts/build_tsk_crossrefs.py
"""Build chatbot/data/tsk_crossrefs.json from OpenBible.info's cross-reference
data (CC-BY; Treasury of Scripture Knowledge with community votes).

    python scripts/build_tsk_crossrefs.py [path/to/cross_references.txt]

With no argument the zip is downloaded from https://a.openbible.info/data/.
Keeps, for each source verse, up to 25 targets with votes >= 5, highest
first. A range target ("Prov.8.22-Prov.8.30") is stored as its first verse.
Output: {"<source verse id>": [[target verse id, votes], ...]}."""
import io
import json
import re
import sqlite3
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "chatbot" / "data" / "tsk_crossrefs.json"
URL = "https://a.openbible.info/data/cross-references.zip"
MIN_VOTES = 5
PER_VERSE = 25

ABBREVIATIONS = (
    "Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov "
    "Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal "
    "Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm "
    "Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev"
).split()
_BOOK_NUMBER = {a: i + 1 for i, a in enumerate(ABBREVIATIONS)}
_REF_RE = re.compile(r"^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$")


def parse_ref(text: str):
    """(book_number, chapter, verse) of a ref or of a range's first verse."""
    match = _REF_RE.match(text.split("-")[0])
    if not match or match.group(1) not in _BOOK_NUMBER:
        return None
    return _BOOK_NUMBER[match.group(1)], int(match.group(2)), int(match.group(3))


def _read_source(path: str = None) -> str:
    if path:
        return Path(path).read_text(encoding="utf-8")
    data = httpx.get(URL, timeout=60, follow_redirects=True).content
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return z.read("cross_references.txt").decode("utf-8")


def main() -> None:
    con = sqlite3.connect(f"file:{ROOT / 'Complete.db'}?mode=ro", uri=True)
    verse_id = {(b, c, v): i for i, b, c, v in con.execute("SELECT id, bnum, cnum, vnum FROM Complete")}
    con.close()
    table = defaultdict(dict)
    skipped = 0
    for line in _read_source(sys.argv[1] if len(sys.argv) > 1 else None).splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        source, target, votes = parse_ref(parts[0]), parse_ref(parts[1]), int(parts[2])
        if votes < MIN_VOTES or source is None or target is None:
            continue
        s_id, t_id = verse_id.get(source), verse_id.get(target)
        if s_id is None or t_id is None or s_id == t_id:
            skipped += 1
            continue
        table[s_id][t_id] = max(votes, table[s_id].get(t_id, 0))
    result = {
        str(s): [[t, v] for t, v in sorted(targets.items(), key=lambda kv: -kv[1])[:PER_VERSE]]
        for s, targets in sorted(table.items())
    }
    OUT.write_text(json.dumps(result, separators=(",", ":")))
    print(f"{len(result)} source verses, {sum(len(v) for v in result.values())} links, "
          f"{skipped} unmappable skipped → {OUT.name} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Implement the lookup module**

```python
# chatbot/passage_tsk.py
"""TSK cross-reference lookup for "Find passages" passage queries.

Data: chatbot/data/tsk_crossrefs.json, built by scripts/build_tsk_crossrefs.py
from OpenBible.info's cross-references (CC-BY), themselves derived from the
Treasury of Scripture Knowledge. A missing file simply means no
cross-reference arm (fail open)."""

import json
import logging
import threading
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Sequence

logger = logging.getLogger(__name__)

TSK_FILE = Path(__file__).resolve().parent / "data" / "tsk_crossrefs.json"
ATTRIBUTION = "Cross-references: OpenBible.info (CC-BY), from the Treasury of Scripture Knowledge"

_TABLE: Dict[str, List[List[int]]] = {}
_LOADED = False
_LOCK = threading.Lock()


def _table() -> Dict[str, List[List[int]]]:
    global _TABLE, _LOADED
    if _LOADED:
        return _TABLE
    with _LOCK:
        if not _LOADED:
            try:
                _TABLE = json.loads(TSK_FILE.read_text())
            except Exception:  # noqa: BLE001 — optional data; no cross-reference arm without it
                logger.warning("passages: TSK cross-references unavailable", exc_info=True)
                _TABLE = {}
            _LOADED = True
    return _TABLE


def related_verse_ids(verse_ids: Sequence[int], limit: int = 60) -> List[int]:
    table = _table()
    votes: Dict[int, int] = defaultdict(int)
    for verse_id in verse_ids:
        for target, count in table.get(str(verse_id), []):
            votes[target] += count
    return sorted(votes, key=lambda t: (-votes[t], t))[:limit]
```

- [ ] **Step 5: Generate the data and run the tests**

Run: `python scripts/build_tsk_crossrefs.py && pytest tests/chatbot/test_passage_tsk.py -v`
Expected: the script prints roughly `>20000 source verses … links` and a size around 1–3 MB; 4 tests pass. If the download fails (offline), fetch the zip manually and pass the extracted `cross_references.txt` path as the argument.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_tsk_crossrefs.py chatbot/passage_tsk.py chatbot/data/tsk_crossrefs.json tests/chatbot/test_passage_tsk.py
git commit -m "feat(passages): TSK cross-reference data (OpenBible.info, CC-BY) and lookup"
```

---

### Task 6: JEV relevance client

**Files:**
- Create: `chatbot/jev_client.py`
- Test: `tests/chatbot/test_jev_client.py`

**Interfaces:**
- Produces (used by Task 8):
  - `JevUnavailable(Exception)`
  - `Judgment(key: str, probabilities: Dict[str, float], confidence: float)` frozen dataclass
  - `is_configured() -> bool` (`TYPESAFE_API_KEY` non-empty)
  - `OPTIONS = ("directly", "partly", "tangentially", "not_relevant")`
  - `async judge_relevance(query: str, items: Sequence[Tuple[str, str, str]]) -> List[Judgment]` — items are `(key, ref, text)`; one request per item, concurrency 8; returns judgments for the items that succeeded, in input order; per-item failures are skipped; raises `JevUnavailable` when there is no key or **every** request failed
  - `_client_factory(timeout: float) -> httpx.AsyncClient` (test seam)

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_jev_client.py
import httpx
import pytest

from chatbot import jev_client
from chatbot.jev_client import JevUnavailable, judge_relevance

ANSWER = {"probabilities": {"directly": 0.8, "partly": 0.1, "tangentially": 0.05, "not_relevant": 0.05}, "confidence": 0.9}


def _use(monkeypatch, handler):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    monkeypatch.setattr(jev_client, "_client_factory",
                        lambda timeout: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def test_returns_a_judgment_per_item_in_input_order(monkeypatch):
    seen = []

    def handler(request: httpx.Request):
        import json
        body = json.loads(request.content)
        seen.append(body["state"]["passage"])
        assert request.headers["authorization"] == "Bearer test-key"
        assert body["questions"]["c0"]["type"] == "choice"
        assert set(body["questions"]["c0"]["criteria"]) == set(jev_client.OPTIONS)
        assert body["state"]["query"] == "the rapture"
        return httpx.Response(200, json={"answers": {"c0": ANSWER}})

    _use(monkeypatch, handler)
    out = await judge_relevance("the rapture", [("7", "1 Thessalonians 4:13-18", "text A"), ("9", "John 14:1-3", "text B")])
    assert [j.key for j in out] == ["7", "9"]
    assert out[0].probabilities["directly"] == 0.8 and out[0].confidence == 0.9
    assert sorted(seen) == ["1 Thessalonians 4:13-18: text A", "John 14:1-3: text B"]


async def test_a_failed_item_is_skipped_but_the_rest_return(monkeypatch):
    def handler(request: httpx.Request):
        import json
        if "text B" in json.loads(request.content)["state"]["passage"]:
            return httpx.Response(500)
        return httpx.Response(200, json={"answers": {"c0": ANSWER}})

    _use(monkeypatch, handler)
    out = await judge_relevance("q", [("1", "A 1:1", "text A"), ("2", "B 1:1", "text B")])
    assert [j.key for j in out] == ["1"]


async def test_a_malformed_only_answer_counts_as_unavailable(monkeypatch):
    def handler(request: httpx.Request):
        return httpx.Response(200, json={"answers": {"c0": {"probabilities": "nope"}}})

    _use(monkeypatch, handler)
    with pytest.raises(JevUnavailable):                      # the only item was malformed → nothing usable
        await judge_relevance("q", [("1", "A 1:1", "t")])


async def test_all_requests_failing_raises(monkeypatch):
    _use(monkeypatch, lambda request: httpx.Response(429))
    with pytest.raises(JevUnavailable):
        await judge_relevance("q", [("1", "A 1:1", "t"), ("2", "B 1:1", "t")])


async def test_no_key_raises_before_any_request(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(JevUnavailable):
        await judge_relevance("q", [("1", "A 1:1", "t")])


async def test_no_items_returns_empty(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    assert await judge_relevance("q", []) == []


def test_is_configured(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "  ")
    assert jev_client.is_configured() is False
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    assert jev_client.is_configured() is True
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/chatbot/test_jev_client.py -v`
Expected: FAIL (`ModuleNotFoundError: chatbot.jev_client`).

- [ ] **Step 3: Implement**

```python
# chatbot/jev_client.py
"""Thin async client for TypeSafe's JEV "System One" classifier
(https://docs.typesafe.ai/api.md), used by "Find passages" to judge whether
a candidate passage addresses the user's query.

Plain httpx against the documented HTTP contract. One Choice request per
candidate (concurrency 8): 30 chunk-sized passages in one request risks
JEV's documented weakness with large unfocused input. A candidate whose
request fails or comes back malformed is skipped; only a missing key or *all*
requests failing raises JevUnavailable — callers then fail open."""

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

OPTIONS: Tuple[str, ...] = ("directly", "partly", "tangentially", "not_relevant")
_CONCURRENCY = 8

CRITERIA: Dict[str, Any] = {
    "directly": {
        "what": "The passage is squarely about what the query asks: it states, describes or teaches it.",
        "examples": ["Query 'the rapture' vs a passage describing believers being caught up to meet the Lord."],
    },
    "partly": {
        "what": "The passage bears on the query in part: one aspect of it, or a closely related teaching.",
        "examples": ["Query 'the rapture' vs a passage on the resurrection of believers at Christ's coming."],
    },
    "tangentially": {
        "what": "The passage shares a word or a general theme with the query but does not really address it.",
        "examples": ["Query 'the rapture' vs a passage where someone is carried away by a spirit."],
    },
    "not_relevant": {
        "what": "The passage has no real connection to the query.",
        "examples": [],
    },
}


class JevUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Judgment:
    key: str
    probabilities: Dict[str, float]
    confidence: float


def is_configured() -> bool:
    return bool(os.getenv("TYPESAFE_API_KEY", "").strip())


def _client_factory(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout)


def _parse(answer: Any, key: str) -> Optional[Judgment]:
    try:
        raw = answer["probabilities"]
        probabilities = {option: float(raw.get(option, 0.0)) for option in OPTIONS}
        confidence = float(answer["confidence"])
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    return Judgment(key=key, probabilities=probabilities, confidence=confidence)


async def judge_relevance(query: str, items: Sequence[Tuple[str, str, str]]) -> List[Judgment]:
    """items: (key, reference, passage text). Returns one Judgment per item
    that could be judged, in input order."""
    if not is_configured():
        raise JevUnavailable("TYPESAFE_API_KEY is not set")
    if not items:
        return []
    url = os.getenv("TYPESAFE_API_URL", "https://api.typesafe.ai/v1/systemone")
    model = os.getenv("TYPESAFE_MODEL", "jev-latest")
    timeout = float(os.getenv("PASSAGES_JEV_TIMEOUT", "5"))
    headers = {"Authorization": f"Bearer {os.getenv('TYPESAFE_API_KEY', '').strip()}"}
    semaphore = asyncio.Semaphore(_CONCURRENCY)

    async def one(client: httpx.AsyncClient, key: str, ref: str, text: str) -> Optional[Judgment]:
        body = {
            "state": {"query": query, "passage": f"{ref}: {text}"},
            "model": model,
            "questions": {"c0": {
                "type": "choice",
                "instructions": "How well does the passage address the query?",
                "criteria": CRITERIA,
            }},
        }
        async with semaphore:
            try:
                response = await client.post(url, json=body, headers=headers)
                response.raise_for_status()
                return _parse(response.json()["answers"]["c0"], key)
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                return None

    async with _client_factory(timeout) as client:
        results = await asyncio.gather(*(one(client, k, r, t) for k, r, t in items))
    judgments = [j for j in results if j is not None]
    if not judgments:
        raise JevUnavailable("no JEV request succeeded")
    return judgments
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/chatbot/test_jev_client.py -v`
Expected: 7 passed.

- [ ] **Step 5: Live smoke test (uses `TYPESAFE_API_KEY` from `.env`; 2 API calls)**

```bash
set -a; . ./.env; set +a
python - <<'EOF'
import asyncio
from chatbot.jev_client import judge_relevance
items = [
 ("a", "1 Thessalonians 4:15-17", "Then we which are alive and remain shall be caught up together with them in the clouds, to meet the Lord in the air: and so shall we ever be with the Lord."),
 ("b", "Genesis 1:3", "And God said, Let there be light: and there was light."),
]
for j in asyncio.run(judge_relevance("Where is the rapture talked about in the Bible?", items)):
    print(j.key, max(j.probabilities, key=j.probabilities.get), round(j.confidence, 2))
EOF
```
Expected: `a` → `directly` or `partly`; `b` → `not_relevant` (or `tangentially`). Put the printed output in the task report. If `a` comes back `not_relevant`, report it — the criteria text needs revisiting before Task 8.

- [ ] **Step 6: Commit**

```bash
git add chatbot/jev_client.py tests/chatbot/test_jev_client.py
git commit -m "feat(passages): JEV relevance client (per-candidate Choice requests, fail-open)"
```

---

### Task 7: Query parsing, phrase rewriting and retrieval

**Files:**
- Create: `chatbot/passage_search.py` (first half; Task 8 completes it)
- Test: `tests/chatbot/test_passage_search_retrieval.py`

**Interfaces:**
- Consumes: `passage_index.Index/get_index` (Task 3), `passage_embed.embed_queries` (Task 4), `passage_tsk.related_verse_ids` (Task 5), `passage_rank.rrf_merge/Candidate` (Task 2), `router._find_flexible_verse_refs`, `router._BOOK_ABBREVIATIONS`, `router._USFM_TO_BOOK`, `bible_search.list_passage_verses_sync`, `ollama_client.simple_completion`.
- Produces (used by Task 8):
  - `Query(kind: str, text: str, verse_ids: Tuple[int, ...] = (), label: str = "")` frozen dataclass — `kind` is `"passage"` or `"statement"`
  - `parse_query(text: str) -> Union[Query, str]` — a `Query`, or a user-facing message string for a scope problem / unknown passage. Sync (touches `Complete.db`); call via `asyncio.to_thread`
  - `parse_phrasings(reply: str) -> List[str]`
  - `async rewrite_queries(statement: str, timeout: float) -> List[str]`
  - `async retrieve(index: Index, query: Query, phrasings: Sequence[str]) -> Tuple[List[Candidate], bool]` — candidates and `semantic` (whether the embedding arm ran)
  - constants `MAX_QUERY_CHARS = 500`, `MAX_PASSAGE_VERSES = 25`, `TOP_PER_QUERY = 20`

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_passage_search_retrieval.py
import numpy as np

from chatbot import passage_search as ps
from chatbot.passage_index import Index, Verse, build_chunks


def test_reference_input_becomes_a_passage_query():
    q = ps.parse_query("Romans 8:28")
    assert q.kind == "passage"
    assert q.label == "Romans 8:28"
    assert len(q.verse_ids) == 1 and "all things work together" in q.text


def test_reference_range_and_trailing_punctuation():
    q = ps.parse_query("1 Thessalonians 4:13-18.")
    assert q.kind == "passage" and q.label == "1 Thessalonians 4:13-18"
    assert len(q.verse_ids) == 6


def test_statement_input_stays_a_statement():
    q = ps.parse_query("Where is the rapture talked about in the Bible?")
    assert q.kind == "statement" and q.verse_ids == ()


def test_reference_inside_a_sentence_is_a_statement():
    q = ps.parse_query("what does Romans 8:28 mean for suffering")
    assert q.kind == "statement"


def test_over_25_verses_asks_for_a_narrower_passage():
    msg = ps.parse_query("Psalm 119:1-60")
    assert isinstance(msg, str) and "25" in msg


def test_bare_chapter_asks_for_a_verse_or_range():
    msg = ps.parse_query("Romans 8")
    assert isinstance(msg, str) and "verse" in msg.lower()


def test_unknown_verse_in_a_real_book_is_reported():
    msg = ps.parse_query("Romans 8:999")
    assert isinstance(msg, str) and "couldn't find" in msg.lower()


def test_parse_phrasings_cleans_and_caps():
    reply = '1. "caught up together"\n- the trump of God\n* twinkling of an eye\n\n"caught up together"\nx\n' + "\n".join(f"phrase number {i}" for i in range(9))
    out = ps.parse_phrasings(reply)
    assert out[:3] == ["caught up together", "the trump of God", "twinkling of an eye"]
    assert len(out) == 5 and len(set(p.lower() for p in out)) == 5      # deduped, "x" (too short) dropped


async def test_rewrite_queries_uses_the_llm_and_fails_open(monkeypatch):
    async def ok(system, user, **kw):
        assert "rapture" in user
        return "caught up together\nthe trump of God"
    monkeypatch.setattr(ps, "simple_completion", ok)
    assert await ps.rewrite_queries("the rapture", 5.0) == ["caught up together", "the trump of God"]

    async def boom(system, user, **kw):
        raise RuntimeError("provider down")
    monkeypatch.setattr(ps, "simple_completion", boom)
    assert await ps.rewrite_queries("the rapture", 5.0) == []

    async def empty(system, user, **kw):
        return ""
    monkeypatch.setattr(ps, "simple_completion", empty)
    assert await ps.rewrite_queries("the rapture", 5.0) == []


def _small_index():
    texts = [
        ("Genesis 1:1", 1, 1, "In the beginning God created the heaven and the earth."),
        ("Genesis 1:2", 1, 2, "And the earth was without form and void."),
        ("Genesis 1:3", 1, 3, "And God said Let there be light."),
        ("Genesis 1:4", 1, 4, "And God saw the light that it was good."),
        ("Exodus 20:8", 20, 8, "Remember the sabbath day to keep it holy."),
        ("Exodus 20:9", 20, 9, "Six days shalt thou labour and do all thy work."),
    ]
    verses = [Verse(i + 1, r, c, v, t) for i, (r, c, v, t) in enumerate(texts)]
    chunks = build_chunks([[1, 2], [3, 4], [5, 6]], verses)
    vectors = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=np.float32)
    return Index(chunks, vectors, verses)


async def test_retrieve_statement_merges_embedding_and_keyword_arms(monkeypatch):
    idx = _small_index()
    monkeypatch.setattr(ps.passage_embed, "embed_queries",
                        lambda texts: np.array([[0, 0, 1]] * len(texts), dtype=np.float32))
    cands, semantic = await ps.retrieve(idx, ps.Query("statement", "light"), [])
    assert semantic is True
    by_id = {c.chunk_id: c for c in cands}
    assert set(by_id[1].sources) == {"embedding", "keyword"}         # ranked by both arms → fused first
    assert by_id[2].sources == ("embedding",)                        # nearest vector, no keyword match
    assert cands[0].chunk_id == 1


async def test_retrieve_without_an_embedder_is_keyword_only(monkeypatch):
    idx = _small_index()
    monkeypatch.setattr(ps.passage_embed, "embed_queries", lambda texts: None)
    cands, semantic = await ps.retrieve(idx, ps.Query("statement", "sabbath day"), [])
    assert semantic is False
    assert [c.chunk_id for c in cands] == [2] and cands[0].sources == ("keyword",)


async def test_retrieve_uses_phrasings_as_extra_queries(monkeypatch):
    idx = _small_index()
    seen = {}

    def fake_embed(texts):
        seen["texts"] = list(texts)
        return np.array([[1, 0, 0]] * len(texts), dtype=np.float32)
    monkeypatch.setattr(ps.passage_embed, "embed_queries", fake_embed)
    await ps.retrieve(idx, ps.Query("statement", "rest day"), ["keep it holy"])
    assert seen["texts"] == ["rest day", "keep it holy"]


async def test_passage_query_never_returns_its_own_chunk(monkeypatch):
    idx = _small_index()
    monkeypatch.setattr(ps.passage_embed, "embed_queries",
                        lambda texts: np.array([[1, 0, 0]] * len(texts), dtype=np.float32))
    monkeypatch.setattr(ps.passage_tsk, "related_verse_ids", lambda ids, limit=60: [1, 5])
    query = ps.Query("passage", "In the beginning God created", verse_ids=(1, 2), label="Genesis 1:1-2")
    cands, _ = await ps.retrieve(idx, query, [])
    assert 0 not in {c.chunk_id for c in cands}                      # its own chunk is excluded from every arm
    assert 2 in {c.chunk_id for c in cands}                          # the cross-referenced chunk survives
    assert "cross_reference" in next(c for c in cands if c.chunk_id == 2).sources


async def test_passage_spanning_two_chunks_excludes_both(monkeypatch):
    idx = _small_index()
    monkeypatch.setattr(ps.passage_embed, "embed_queries",
                        lambda texts: np.array([[1, 1, 0]] * len(texts), dtype=np.float32))
    monkeypatch.setattr(ps.passage_tsk, "related_verse_ids", lambda ids, limit=60: [])
    query = ps.Query("passage", "text", verse_ids=(2, 3), label="Genesis 1:2-3")
    cands, _ = await ps.retrieve(idx, query, [])
    assert {0, 1}.isdisjoint({c.chunk_id for c in cands})
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/chatbot/test_passage_search_retrieval.py -v`
Expected: FAIL (`ModuleNotFoundError: chatbot.passage_search`).

- [ ] **Step 3: Implement the first half of `chatbot/passage_search.py`**

```python
# chatbot/passage_search.py
""""Find passages" (internal id `passages`): ranked Bible passages for a
verse reference or a plain-English statement, each with a one-sentence
reason. See docs/superpowers/specs/2026-09-30-passage-search-design.md.

Pipeline: parse_query → (statement) rewrite_queries → retrieve (embedding +
BM25 [+ TSK]) → RRF → JEV filter → reasons → result. Only retrieval is
required; every later stage fails open."""

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple, Union

from chatbot import passage_embed, passage_tsk
from chatbot.bible_search import list_passage_verses_sync
from chatbot.ollama_client import simple_completion
from chatbot.passage_index import Index
from chatbot.passage_rank import Candidate, rrf_merge
from chatbot.router import (
    _BOOK_ABBREVIATIONS, _USFM_TO_BOOK, _find_flexible_verse_refs, _format_reference,
)

logger = logging.getLogger(__name__)

MAX_QUERY_CHARS = 500
MAX_PASSAGE_VERSES = 25      # same cap as Deep Study
TOP_PER_QUERY = 20
MAX_PHRASINGS = 5

_TRIM = " \t\r\n.?!,;:"
_SCOPE_RE = re.compile(r"^([1-3]?[A-Z]{2,3})\s+(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$")
_BARE_CHAPTER_RE = re.compile(r"^([1-3]?\s?[A-Za-z]{2,})\.?\s+(\d{1,3})$")
_BULLET_RE = re.compile(r"^[\s\-\*•\d.)]+")

_REWRITE_SYSTEM = "You help search the King James Bible. You reply with search phrases only."


@dataclass(frozen=True)
class Query:
    kind: str                       # "passage" | "statement"
    text: str
    verse_ids: Tuple[int, ...] = ()
    label: str = ""


def _as_reference(text: str) -> Optional[str]:
    """"ROM 8:28" / "1TH 4:13-18" when the whole message is one reference."""
    trimmed = text.strip(_TRIM)
    refs = _find_flexible_verse_refs(trimmed)
    if len(refs) != 1 or refs[0][0].strip() != trimmed:
        return None
    return _format_reference(*refs[0])


def parse_query(text: str) -> Union[Query, str]:
    text = text.strip()
    ref = _as_reference(text)
    if ref is None:
        bare = _BARE_CHAPTER_RE.match(text.strip(_TRIM))
        if bare:
            usfm = _BOOK_ABBREVIATIONS.get(re.sub(r"[.\s]", "", bare.group(1)).lower())
            if usfm:
                book = _USFM_TO_BOOK.get(usfm, usfm)
                return (f"That's a whole chapter. Give me a verse or a short range from {book} "
                        f"{bare.group(2)} (up to {MAX_PASSAGE_VERSES} verses) — for example "
                        f"\"{book} {bare.group(2)}:1-5\".")
        return Query("statement", text)
    match = _SCOPE_RE.match(ref)
    if not match:
        return Query("statement", text)
    usfm, chapter = match.group(1), int(match.group(2))
    start = int(match.group(3))
    end = int(match.group(4)) if match.group(4) else start
    if end < start:
        start, end = end, start
    book = _USFM_TO_BOOK.get(usfm, usfm)
    if end - start + 1 > MAX_PASSAGE_VERSES:
        return (f"That's {end - start + 1} verses. Please give me {MAX_PASSAGE_VERSES} or fewer "
                f"from {book} {chapter} — which part should I look at?")
    rows = list_passage_verses_sync(book, chapter, start, end)
    if not rows:
        return f"I couldn't find {book} {chapter}:{start}{'-' + str(end) if end != start else ''} in the Bible."
    label = f"{book} {chapter}:{start}" + (f"-{end}" if end != start else "")
    return Query("passage", " ".join(r["kjv"] or "" for r in rows).strip(),
                 tuple(r["versenumber"] for r in rows), label)


def parse_phrasings(reply: str) -> List[str]:
    out: List[str] = []
    seen = set()
    for line in (reply or "").splitlines():
        phrase = _BULLET_RE.sub("", line).strip().strip("\"'“”‘’").strip()
        if not 2 < len(phrase) <= 80 or phrase.lower() in seen:
            continue
        seen.add(phrase.lower())
        out.append(phrase)
        if len(out) == MAX_PHRASINGS:
            break
    return out


async def rewrite_queries(statement: str, timeout: float) -> List[str]:
    prompt = (
        f"Question: {statement}\n\n"
        "List 3 to 5 short phrases (2 to 6 words each), worded as in the King James Bible, that a "
        "passage answering this question would likely contain. One phrase per line, no numbering, "
        "no commentary."
    )
    try:
        reply = await simple_completion(_REWRITE_SYSTEM, prompt, max_tokens=120, timeout=timeout)
    except Exception:  # noqa: BLE001 — optional; the original statement still searches
        logger.warning("passages: phrase rewrite failed", exc_info=True)
        return []
    return parse_phrasings(reply)


async def retrieve(
    index: Index, query: Query, phrasings: Sequence[str]
) -> Tuple[List[Candidate], bool]:
    texts = [query.text, *phrasings]
    vectors = await asyncio.to_thread(passage_embed.embed_queries, texts)
    semantic = vectors is not None
    lists: List[Tuple[str, List[int]]] = []
    for i, text in enumerate(texts):
        if semantic:
            lists.append(("embedding", index.nearest(vectors[i], TOP_PER_QUERY)))
        lists.append(("keyword", index.keyword(text, TOP_PER_QUERY)))
    own: set = set()
    if query.verse_ids:
        own = set(index.chunk_ids_for_verses(query.verse_ids))
        related = passage_tsk.related_verse_ids(query.verse_ids)
        lists.append(("cross_reference", index.chunk_ids_for_verses(related)[:TOP_PER_QUERY]))
    lists = [(source, [c for c in ids if c not in own]) for source, ids in lists]
    return rrf_merge(lists), semantic
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/chatbot/test_passage_search_retrieval.py -v`
Expected: 14 passed. (`test_reference_input…`, `…range…`, `…over_25…`, `…unknown_verse…` read the real `Complete.db`.) If `parse_query("Romans 8:999")` does not return the "couldn't find" message because `list_passage_verses_sync` returns rows for the chapter, fix the range filter — it must return `[]` when no verse in the requested range exists.

- [ ] **Step 5: Commit**

```bash
git add chatbot/passage_search.py tests/chatbot/test_passage_search_retrieval.py
git commit -m "feat(passages): query parsing, phrase rewriting and hybrid retrieval"
```

---

### Task 8: Filtering, reasons and the assembled result

**Files:**
- Modify: `chatbot/passage_search.py` (append)
- Test: `tests/chatbot/test_passage_search.py`

**Interfaces:**
- Consumes: everything from Tasks 2, 3, 6, 7.
- Produces (used by Task 9):
  - `async search(text: str) -> Dict[str, Any]` — a chat-style result dict (`type`, `message`, `data`, `route`, `follow_up_questions`, and `artifacts` when there are passages)
  - `primer() -> Dict[str, Any]`
  - `is_available() -> bool`
  - `parse_reasons(reply: str, count: int) -> Dict[int, str]`
  - Artifact params shape (`type: "passage_search"`): `{"query": str, "kind": "passage"|"statement", "label": str, "phrasings": [str], "verified": bool, "semantic": bool, "credits": [str], "passages": [{"ref": str, "first_ref": str, "text": str, "reason": str, "sources": [str]}]}`
  - message constants `EMPTY_MESSAGE`, `LENGTH_MESSAGE`, `UNAVAILABLE_MESSAGE`, `NO_RESULTS_MESSAGE`, `EXAMPLE_QUERIES`

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_passage_search.py
import numpy as np
import pytest

from chatbot import jev_client, passage_index, passage_search as ps
from chatbot.jev_client import JevUnavailable, Judgment
from chatbot.passage_index import Index, Verse, build_chunks


@pytest.fixture
def index(monkeypatch):
    texts = [
        ("1 Thessalonians 4:16", 4, 16, "The Lord himself shall descend from heaven with a shout, with the voice of the archangel, and with the trump of God."),
        ("1 Thessalonians 4:17", 4, 17, "Then we which are alive and remain shall be caught up together with them in the clouds, to meet the Lord in the air."),
        ("Genesis 1:3", 1, 3, "And God said, Let there be light: and there was light."),
        ("Genesis 1:4", 1, 4, "And God saw the light, that it was good."),
        ("Exodus 20:8", 20, 8, "Remember the sabbath day, to keep it holy."),
        ("Exodus 20:9", 20, 9, "Six days shalt thou labour, and do all thy work."),
    ]
    verses = [Verse(i + 1, r, c, v, t) for i, (r, c, v, t) in enumerate(texts)]
    idx = Index(build_chunks([[1, 2], [3, 4], [5, 6]], verses),
                np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=np.float32), verses)
    monkeypatch.setattr(passage_index, "get_index", lambda: idx)
    monkeypatch.setattr(ps.passage_index, "get_index", lambda: idx)
    monkeypatch.setattr(ps.passage_embed, "embed_queries",
                        lambda texts: np.array([[1, 0, 0]] * len(texts), dtype=np.float32))
    monkeypatch.setattr(ps.passage_tsk, "related_verse_ids", lambda ids, limit=60: [])
    return idx


def _llm(monkeypatch, rewrite="caught up together", reasons=None):
    async def fake(system, user, **kw):
        if "search phrases" in system:          # the rewrite call; the reasons call has a different system prompt
            return rewrite
        return reasons if reasons is not None else "1. Describes the Lord gathering believers.\n2. Another sentence."
    monkeypatch.setattr(ps, "simple_completion", fake)


def _jev(monkeypatch, answers):
    """answers: {chunk key: (label, confidence)} — anything missing is not answered."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")

    async def fake(query, items):
        out = []
        for key, _ref, _text in items:
            if key in answers:
                label, conf = answers[key]
                probs = {o: 0.0 for o in jev_client.OPTIONS}
                probs[label] = 0.9
                out.append(Judgment(key, probs, conf))
        return out
    monkeypatch.setattr(ps.jev_client, "judge_relevance", fake)


async def test_full_pipeline_returns_ranked_cards_with_reasons(index, monkeypatch):
    _llm(monkeypatch)
    _jev(monkeypatch, {"0": ("directly", 0.9), "1": ("not_relevant", 0.9), "2": ("not_relevant", 0.9)})
    result = await ps.search("Where is the rapture talked about in the Bible?")
    params = result["artifacts"][0]["params"]
    assert result["artifacts"][0]["type"] == "passage_search"
    assert params["verified"] is True and params["semantic"] is True and params["kind"] == "statement"
    assert [p["ref"] for p in params["passages"]] == ["1 Thessalonians 4:16-17"]
    assert params["passages"][0]["reason"] == "Describes the Lord gathering believers."
    assert params["passages"][0]["first_ref"] == "1 Thessalonians 4:16"
    assert params["phrasings"] == ["caught up together"]
    assert "1 passage" in result["message"]


async def test_nothing_relevant_says_so_and_returns_no_artifact(index, monkeypatch):
    _llm(monkeypatch)
    _jev(monkeypatch, {"0": ("not_relevant", 0.9), "1": ("tangentially", 0.9), "2": ("not_relevant", 0.9)})
    result = await ps.search("best pizza recipe")
    assert "artifacts" not in result
    assert result["message"] == ps.NO_RESULTS_MESSAGE


async def test_jev_unavailable_falls_back_to_unverified_results(index, monkeypatch):
    _llm(monkeypatch)
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")

    async def down(query, items):
        raise JevUnavailable("down")
    monkeypatch.setattr(ps.jev_client, "judge_relevance", down)
    result = await ps.search("the sabbath day")
    params = result["artifacts"][0]["params"]
    assert params["verified"] is False and params["passages"]
    assert "not verified" in result["message"]


async def test_no_jev_key_is_treated_as_unverified(index, monkeypatch):
    _llm(monkeypatch)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    result = await ps.search("the sabbath day")
    assert result["artifacts"][0]["params"]["verified"] is False


async def test_partial_jev_answers_drop_the_unanswered_candidates(index, monkeypatch):
    _llm(monkeypatch, reasons="1. Reason.")
    _jev(monkeypatch, {"0": ("partly", 0.8)})                # chunks 1 and 2 not answered
    result = await ps.search("the rapture")
    refs = [p["ref"] for p in result["artifacts"][0]["params"]["passages"]]
    assert refs == ["1 Thessalonians 4:16-17"]


async def test_everything_optional_failing_still_returns_keyword_results(index, monkeypatch):
    monkeypatch.setattr(ps.passage_embed, "embed_queries", lambda texts: None)
    _llm(monkeypatch, rewrite="", reasons="")
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")

    async def down(query, items):
        raise JevUnavailable("down")
    monkeypatch.setattr(ps.jev_client, "judge_relevance", down)
    result = await ps.search("the sabbath day")
    params = result["artifacts"][0]["params"]
    assert params["semantic"] is False and params["verified"] is False
    assert params["passages"][0]["ref"] == "Exodus 20:8-9"
    assert params["passages"][0]["reason"] == ""


async def test_reasons_failure_leaves_cards_without_a_reason(index, monkeypatch):
    async def fake(system, user, **kw):
        if "search phrases" in system:
            return ""
        raise RuntimeError("provider down")
    monkeypatch.setattr(ps, "simple_completion", fake)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    result = await ps.search("the sabbath day")
    assert result["artifacts"][0]["params"]["passages"][0]["reason"] == ""


async def test_passage_input_reports_a_passage_kind_and_credits_tsk(index, monkeypatch):
    _llm(monkeypatch)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.setattr(ps, "parse_query", lambda text: ps.Query("passage", "Remember the sabbath", (5,), "Exodus 20:8"))
    monkeypatch.setattr(ps.passage_tsk, "related_verse_ids", lambda ids, limit=60: [1])
    result = await ps.search("Exodus 20:8")
    params = result["artifacts"][0]["params"]
    assert params["kind"] == "passage" and params["label"] == "Exodus 20:8"
    assert ps.passage_tsk.ATTRIBUTION in params["credits"]
    assert all(p["ref"] != "Exodus 20:8-9" for p in params["passages"])          # own chunk excluded


@pytest.mark.parametrize("text", ["", "   \n "])
async def test_empty_input_makes_no_calls(text, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not be called")
    monkeypatch.setattr(ps, "simple_completion", boom)
    monkeypatch.setattr(ps.passage_embed, "embed_queries", boom)
    monkeypatch.setattr(ps.jev_client, "judge_relevance", boom)
    result = await ps.search(text)
    assert result["message"] == ps.EMPTY_MESSAGE and "artifacts" not in result


async def test_over_long_input_makes_no_calls(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not be called")
    monkeypatch.setattr(ps, "simple_completion", boom)
    monkeypatch.setattr(ps.passage_embed, "embed_queries", boom)
    result = await ps.search("x" * (ps.MAX_QUERY_CHARS + 1))
    assert result["message"] == ps.LENGTH_MESSAGE


async def test_scope_message_is_returned_as_is(index):
    result = await ps.search("Romans 8")
    assert "verse" in result["message"].lower() and "artifacts" not in result


async def test_unavailable_index(monkeypatch):
    monkeypatch.setattr(ps.passage_index, "get_index", lambda: None)
    result = await ps.search("the sabbath")
    assert result["message"] == ps.UNAVAILABLE_MESSAGE
    assert ps.is_available() is False


def test_parse_reasons_handles_gaps_and_junk():
    reply = "Here you go:\n1. First reason.\n3) Third reason.\nnot numbered\n2. Second reason."
    assert ps.parse_reasons(reply, 3) == {1: "First reason.", 2: "Second reason.", 3: "Third reason."}
    assert ps.parse_reasons("1. only one", 3) == {1: "only one"}
    assert ps.parse_reasons("", 3) == {}
    assert ps.parse_reasons("9. out of range", 3) == {}


def test_primer_offers_examples():
    result = ps.primer()
    assert result["type"] == "chat" and result["route"] == "Mode primer → passages"
    assert result["follow_up_questions"] == ps.EXAMPLE_QUERIES
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/chatbot/test_passage_search.py -v`
Expected: FAIL (`AttributeError`/missing `search`, `primer`, …).

- [ ] **Step 3: Implement — first extend the imports and constants at the top of `chatbot/passage_search.py`**

Replace the import block and constants section with:

```python
import asyncio
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from chatbot import jev_client, passage_embed, passage_index, passage_tsk
from chatbot.bible_search import list_passage_verses_sync
from chatbot.ollama_client import simple_completion
from chatbot.passage_index import Index
from chatbot.passage_rank import (
    Candidate, Ranked, Relevance, jev_filter, rrf_merge, unverified,
)
from chatbot.router import (
    _BOOK_ABBREVIATIONS, _USFM_TO_BOOK, _find_flexible_verse_refs, _format_reference,
)

logger = logging.getLogger(__name__)

MAX_QUERY_CHARS = 500
MAX_PASSAGE_VERSES = 25      # same cap as Deep Study
TOP_PER_QUERY = 20
MAX_PHRASINGS = 5
BUDGET_SECONDS = 15.0
REWRITE_TIMEOUT = 8.0
JEV_TIMEOUT = 5.0
REASONS_TIMEOUT = 15.0
MIN_STAGE_SECONDS = 0.5
REASON_TEXT_CHARS = 600
JEV_TEXT_CHARS = 1500

EMPTY_MESSAGE = "Type a verse (like Romans 8:28) or ask where a topic appears in the Bible."
LENGTH_MESSAGE = "Please keep it under about 500 characters."
UNAVAILABLE_MESSAGE = "Passage search is unavailable right now. Please try again later."
NO_RESULTS_MESSAGE = "I couldn't find passages that address this."
EXAMPLE_QUERIES = [
    "Where is the rapture talked about in the Bible?",
    "Romans 8:28",
    "What does the Bible say about forgiving others?",
    "Where does the Bible talk about the Holy Spirit as a guide?",
]
```

(This block is a superset of Task 7's imports and constants — it replaces them; nothing else in Task 7's code changes.)

- [ ] **Step 4: Implement — append to `chatbot/passage_search.py`**

```python
_REASONS_SYSTEM = (
    "You write one-sentence reasons for search results from the King James Bible. "
    "State only what each passage says and how it bears on the query. Take no doctrinal "
    "position and never add anything the passage does not say."
)
_REASON_LINE_RE = re.compile(r"^\s*(\d+)[.)]\s+(.+?)\s*$", re.MULTILINE)


def _chat(message: str, route: str) -> Dict[str, Any]:
    return {"type": "chat", "message": message, "data": None, "route": route, "follow_up_questions": []}


def primer() -> Dict[str, Any]:
    result = _chat(
        "Type a verse, or ask where a topic appears in the Bible, and I'll find the relevant passages.",
        "Mode primer → passages",
    )
    result["follow_up_questions"] = list(EXAMPLE_QUERIES)
    return result


def is_available() -> bool:
    return passage_index.get_index() is not None


def _remaining(deadline: float, cap: float) -> float:
    return max(MIN_STAGE_SECONDS, min(cap, deadline - time.monotonic()))


def parse_reasons(reply: str, count: int) -> Dict[int, str]:
    out: Dict[int, str] = {}
    for number, sentence in _REASON_LINE_RE.findall(reply or ""):
        n = int(number)
        if 1 <= n <= count and n not in out:
            out[n] = sentence.strip()
    return out


def _query_for_judging(query: Query) -> str:
    if query.kind == "passage":
        return f"{query.label}: {query.text}"[:JEV_TEXT_CHARS]
    return query.text


async def _filter(
    index: Index, query: Query, candidates: List[Candidate], deadline: float
) -> Tuple[List[Ranked], bool]:
    """(ranked, verified). Any JEV problem returns the unverified top of the list."""
    if not jev_client.is_configured():
        return unverified(candidates), False
    items = [
        (str(c.chunk_id), index.chunks[c.chunk_id].ref, index.chunks[c.chunk_id].plain[:JEV_TEXT_CHARS])
        for c in candidates
    ]
    try:
        judgments = await asyncio.wait_for(
            jev_client.judge_relevance(_query_for_judging(query), items),
            timeout=_remaining(deadline, JEV_TIMEOUT),
        )
    except Exception:  # noqa: BLE001 — JevUnavailable, timeout, anything: fail open
        logger.warning("passages: JEV filter unavailable", exc_info=True)
        return unverified(candidates), False
    relevance = {
        int(j.key): Relevance(int(j.key), j.probabilities, j.confidence) for j in judgments
    }
    return jev_filter(candidates, relevance), True


async def _reasons(
    index: Index, query: Query, ranked: List[Ranked], deadline: float
) -> Dict[int, str]:
    numbered = "\n\n".join(
        f"{n}. {index.chunks[r.candidate.chunk_id].ref}: "
        f"{index.chunks[r.candidate.chunk_id].plain[:REASON_TEXT_CHARS]}"
        for n, r in enumerate(ranked, start=1)
    )
    subject = f"Bible passage {query.label}" if query.kind == "passage" else f"Question: {query.text}"
    prompt = (
        f"{subject}\n\nPassages:\n{numbered}\n\n"
        "For each numbered passage write one sentence saying how it relates to the above. "
        "Reply as a numbered list, one line per passage, in the same numbering."
    )
    try:
        reply = await simple_completion(
            _REASONS_SYSTEM, prompt, max_tokens=900, timeout=_remaining(deadline, REASONS_TIMEOUT)
        )
    except Exception:  # noqa: BLE001 — reasons are optional
        logger.warning("passages: reasons call failed", exc_info=True)
        return {}
    return parse_reasons(reply, len(ranked))


def _result(
    query: Query, phrasings: List[str], ranked: List[Ranked], reasons: Dict[int, str],
    index: Index, verified: bool, semantic: bool, route: str,
) -> Dict[str, Any]:
    passages = []
    for n, item in enumerate(ranked, start=1):
        chunk = index.chunks[item.candidate.chunk_id]
        passages.append({
            "ref": chunk.ref, "first_ref": chunk.first_ref, "text": chunk.text,
            "reason": reasons.get(n, ""), "sources": list(item.candidate.sources),
        })
    credits = (
        [passage_tsk.ATTRIBUTION]
        if any("cross_reference" in p["sources"] for p in passages) else []
    )
    subject = query.label if query.kind == "passage" else query.text
    message = f"Found {len(passages)} passage{'s' if len(passages) != 1 else ''} for “{subject}”."
    if not verified:
        message += " (relevance not verified)"
    result = _chat(message, route)
    result["artifacts"] = [{
        "type": "passage_search", "label": "View passages ▸",
        "params": {
            "query": query.text if query.kind == "statement" else query.label,
            "kind": query.kind, "label": query.label, "phrasings": phrasings,
            "verified": verified, "semantic": semantic, "credits": credits, "passages": passages,
        },
    }]
    return result


async def search(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if not text:
        return _chat(EMPTY_MESSAGE, "passages → empty input")
    if len(text) > MAX_QUERY_CHARS:
        return _chat(LENGTH_MESSAGE, "passages → input too long")
    index = await asyncio.to_thread(passage_index.get_index)
    if index is None:
        return _chat(UNAVAILABLE_MESSAGE, "passages → unavailable")
    deadline = time.monotonic() + BUDGET_SECONDS

    parsed = await asyncio.to_thread(parse_query, text)
    if isinstance(parsed, str):
        return _chat(parsed, "passages → scope")
    query = parsed

    phrasings: List[str] = []
    if query.kind == "statement":
        phrasings = await rewrite_queries(query.text, _remaining(deadline, REWRITE_TIMEOUT))
    candidates, semantic = await retrieve(index, query, phrasings)
    if not candidates:
        return _chat(NO_RESULTS_MESSAGE, "passages → no candidates")

    ranked, verified = await _filter(index, query, candidates, deadline)
    if not ranked:
        return _chat(NO_RESULTS_MESSAGE, f"passages → JEV filtered all ({len(candidates)} candidates)")
    reasons = await _reasons(index, query, ranked, deadline)
    route = f"passages → {'JEV' if verified else 'retrieval only'} ({len(candidates)} candidates)"
    return _result(query, phrasings, ranked, reasons, index, verified, semantic, route)
```

- [ ] **Step 5: Run to verify pass**

Run: `pytest tests/chatbot/test_passage_search.py tests/chatbot/test_passage_search_retrieval.py -v`
Expected: all pass (15 + 14). If `test_passage_input_reports_a_passage_kind_and_credits_tsk` fails because `search` calls `parse_query` through `asyncio.to_thread(parse_query, …)` and the monkeypatch targets the module attribute, confirm `search` looks `parse_query` up on the module at call time (it does: it is referenced by global name inside `search`).

- [ ] **Step 6: Commit**

```bash
git add chatbot/passage_search.py tests/chatbot/test_passage_search.py
git commit -m "feat(passages): JEV filter, reasons and assembled result with fail-open stages"
```

---

### Task 9: API wiring

**Files:**
- Modify: `chatbot/schemas.py`
- Modify: `chatbot/api.py`
- Modify: `chatbot/router.py` (`build_mode_primer`)
- Test: `tests/chatbot/test_chat_endpoint_passages.py`

**Interfaces:**
- Consumes: `passage_search.search`, `passage_search.primer`, `passage_search.is_available` (Task 8).
- Produces: `GET /passages/status` → `{"available": bool}`; `mode == "passages"` handled in both `post_chat` and `_stream_chat_response`; `build_mode_primer("passages", …)` → `passage_search.primer()`; `ArtifactLink.type` and `ChatRequest.mode` descriptions mention `passage_search` / `passages`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_chat_endpoint_passages.py
"""Find passages wiring: mode=passages turns, the primer, and /passages/status."""
import json


def _events(raw):
    return [json.loads(c.strip()[len("data: "):]) for c in raw.strip().split("\n\n") if c.strip().startswith("data: ")]


FAKE = {"type": "chat", "message": "[found]", "data": None, "route": "passages → test", "follow_up_questions": []}


def _fake_search(monkeypatch, captured):
    import chatbot.passage_search as ps

    async def fake(text):
        captured.append(text)
        return dict(FAKE)

    monkeypatch.setattr(ps, "search", fake)


def test_passages_mode_turn_routes_to_search(client, monkeypatch):
    captured = []
    _fake_search(monkeypatch, captured)
    res = client.post("/chat", json={"message": "Where is the rapture?", "mode": "passages", "mode_params": {}})
    assert res.status_code == 200
    assert res.json()["message"] == "[found]"
    assert captured == ["Where is the rapture?"]


def test_passages_mode_stream_routes_to_search(client, monkeypatch):
    captured = []
    _fake_search(monkeypatch, captured)
    res = client.post("/chat/stream", json={"message": "Romans 8:28", "mode": "passages", "mode_params": {}})
    final = next(e for e in _events(res.text) if e["type"] == "final")
    assert final["result"]["message"] == "[found]"
    assert captured == ["Romans 8:28"]


def test_passages_primer(client):
    res = client.post("/chat", json={"message": "", "mode": "passages", "mode_params": {}})
    body = res.json()
    assert "find the relevant passages" in body["message"]
    assert body["follow_up_questions"][0] == "Where is the rapture talked about in the Bible?"


def test_status_reports_availability(client, monkeypatch):
    import chatbot.passage_search as ps
    monkeypatch.setattr(ps, "is_available", lambda: True)
    assert client.get("/passages/status").json() == {"available": True}
    monkeypatch.setattr(ps, "is_available", lambda: False)
    assert client.get("/passages/status").json() == {"available": False}
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/chatbot/test_chat_endpoint_passages.py -v`
Expected: FAIL (404 for `/passages/status`; the mode falls through to generic chat).

- [ ] **Step 3: Schemas**

In `chatbot/schemas.py`: extend the `ArtifactLink.type` description string by appending ` | passage_search`, extend the `ChatRequest.mode` description by appending `, passages`, and append at the end of the file:

```python
class PassagesStatusResponse(BaseModel):
    available: bool
```

- [ ] **Step 4: API**

In `chatbot/api.py`:

1. Add `PassagesStatusResponse,` to the `from chatbot.schemas import (…)` list (keep alphabetical, after `ParablesResponse,`).
2. Change the line `from chatbot import wiki_loader, wiki_qa, socratic, hermeneutics, character_chat, character_loader` to append `, passage_search`.
3. After the `list_characters` route (immediately before `@router.post("/devotional/audio", …)`) add:

```python
@router.get("/passages/status", response_model=PassagesStatusResponse)
async def passages_status():
    """Whether "Find passages" can run (the chunk index loaded). Never calls
    JEV or the LLM — the frontend asks once, to show or hide the tile."""
    return PassagesStatusResponse(available=await asyncio.to_thread(passage_search.is_available))
```

(`asyncio` is already imported in `api.py`; if it is not, add `import asyncio` at the top.)

4. In `post_chat`, immediately after the character block —

```python
            result = await character_chat.answer(character_id, request.message, history)
            return _with_trace(result)
```
— insert:

```python
        # Every turn in a "Find passages" session is a query to search for —
        # never the generic deterministic/LLM path.
        if request.mode == "passages":
            result = await passage_search.search(request.message)
            return _with_trace(result)
```

5. In `_stream_chat_response`, immediately after the character block —

```python
            result = await character_chat.answer(character_id, request.message, history)
            _note_outcome(result)
            yield await sse_event("final", {"result": result})
            return
```
— insert:

```python
        # Same special case as post_chat(): the result arrives whole.
        if request.mode == "passages":
            result = await passage_search.search(request.message)
            _note_outcome(result)
            yield await sse_event("final", {"result": result})
            return
```

- [ ] **Step 5: Router primer**

In `chatbot/router.py`, in `build_mode_primer`, immediately before `if mode == "story":` add:

```python
    if mode == "passages":
        from chatbot import passage_search
        return passage_search.primer()
```

(imported inside the function: `passage_search` imports `router`, so a top-level import would be circular.)

- [ ] **Step 6: Run to verify pass, then the surrounding suites**

Run: `pytest tests/chatbot/test_chat_endpoint_passages.py tests/chatbot/test_mode_primers.py tests/chatbot/test_chat_endpoint_character.py -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add chatbot/schemas.py chatbot/api.py chatbot/router.py tests/chatbot/test_chat_endpoint_passages.py
git commit -m "feat(passages): wire mode=passages, the primer and /passages/status into the chatbot API"
```

---

### Task 10: Frontend — the artifact and mode wiring

**Files:**
- Create: `frontend/src/components/artifacts/PassageSearchArtifact.tsx`
- Create: `frontend/src/components/artifacts/PassageSearchArtifact.test.tsx`
- Modify: `frontend/src/types/session.ts`, `frontend/src/lib/chatApi.ts`, `frontend/src/store/useArtifactStore.ts`, `frontend/src/store/useSessionsStore.ts`, `frontend/src/components/shell/ArtifactPane.tsx`, `frontend/src/components/shell/ModePickerScreen.tsx` (+ its test), `frontend/src/components/shell/SessionsPane.tsx`, `frontend/src/components/shell/ChatPane.tsx`

**Interfaces:**
- Consumes: the `passage_search` artifact params and `GET /api/bible-chat/passages/status` from Tasks 8–9.
- Produces: `PassageSearchArtifactParams` and `PassageResult` types; `fetchPassagesStatus(): Promise<boolean>`; `SessionMode` includes `'passages'`; `ArtifactLink['type']` includes `'passage_search'`; `MODE_LABELS.passages = 'Find passages'`.

- [ ] **Step 1: Types, API helper, store cases**

`frontend/src/types/session.ts`:
- append `| 'passages'` to `SessionMode`;
- append `| 'passage_search'` to `ArtifactLink['type']`;
- add after `StoryArtifactParams`:

```ts
export interface PassageResult {
  ref: string
  first_ref: string
  text: string
  reason: string
  sources: Array<'embedding' | 'keyword' | 'cross_reference'>
}

/** Params for a `passage_search`-type ArtifactLink — the whole result list
 * (passage text included) travels inline, so reloads and share links redraw
 * it without re-running the search. */
export interface PassageSearchArtifactParams {
  query: string
  kind: 'passage' | 'statement'
  label: string
  phrasings: string[]
  verified: boolean
  semantic: boolean
  credits: string[]
  passages: PassageResult[]
}
```

`frontend/src/lib/chatApi.ts`: add after `fetchMisquoteStatus`'s equivalent location (anywhere among the exported helpers):

```ts
/** Whether "Find passages" is available (the chunk index loaded on the
 * server). Any failure reads as unavailable — the tile just hides. */
export async function fetchPassagesStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${CHAT_API}/passages/status`)
    if (!res.ok) return false
    const json = (await res.json()) as { available?: boolean }
    return json.available === true
  } catch {
    return false
  }
}
```

`frontend/src/store/useArtifactStore.ts`: in `fetchForLink`, immediately before `default:` add

```ts
    case 'passage_search':
      // The whole result list travels inline on the link params (set by the
      // chat message that produced it) — nothing to fetch.
      return link.params
```

`frontend/src/store/useSessionsStore.ts`: add `passages: 'Find passages',` to `MODE_LABELS`.

`frontend/src/components/shell/SessionsPane.tsx`: import `BookMarked` from `lucide-react` (in the existing import list, alphabetical), add `'passages'` to `MODE_ORDER` right before `'freeform'`, and add `passages: BookMarked,` to `MODE_ICONS`.

`frontend/src/components/shell/ChatPane.tsx`: in `composePlaceholder`'s switch, before `case 'freeform':`, add

```ts
    case 'passages':
      return 'Type a verse, or ask where a topic appears…'
```

- [ ] **Step 2: Write the failing artifact test**

```tsx
// frontend/src/components/artifacts/PassageSearchArtifact.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useArtifactStore } from '@/store/useArtifactStore'
import { PassageSearchArtifact } from './PassageSearchArtifact'
import type { PassageSearchArtifactParams } from '@/types/session'

const BASE: PassageSearchArtifactParams = {
  query: 'Where is the rapture talked about in the Bible?',
  kind: 'statement',
  label: '',
  phrasings: ['caught up together'],
  verified: true,
  semantic: true,
  credits: [],
  passages: [
    {
      ref: '1 Thessalonians 4:16-17',
      first_ref: '1 Thessalonians 4:16',
      text: '[16] For the Lord himself shall descend from heaven [17] Then we which are alive and remain shall be caught up',
      reason: 'Describes believers being caught up to meet the Lord.',
      sources: ['embedding', 'keyword'],
    },
    { ref: 'John 14:1-3', first_ref: 'John 14:1', text: '[3] I will come again', reason: '', sources: ['embedding'] },
  ],
}

describe('PassageSearchArtifact', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, history: [], status: 'idle', data: null, error: null })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the query, each passage, its reason and text', () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.getByText(/Where is the rapture talked about/)).toBeInTheDocument()
    expect(screen.getByText('Describes believers being caught up to meet the Lord.')).toBeInTheDocument()
    expect(screen.getByText(/shall descend from heaven/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1 Thessalonians 4:16-17' })).toHaveAttribute(
      'href', '/explorer?reference=1%20Thessalonians%204%3A16',
    )
  })

  it('omits the reason line when a passage has none', () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.getAllByTestId('passage-reason')).toHaveLength(1)
  })

  it('opens a passage in-app instead of navigating to the dead legacy route', async () => {
    render(<PassageSearchArtifact {...BASE} />)
    await userEvent.click(screen.getByRole('link', { name: 'John 14:1-3' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'chapter', label: 'John 14:1-3 ▸', params: { reference: 'John 14:1-3' },
    })
  })

  it('notes when relevance was not verified and when semantic search was unavailable', () => {
    render(<PassageSearchArtifact {...BASE} verified={false} semantic={false} />)
    expect(screen.getByText(/relevance not verified/i)).toBeInTheDocument()
    expect(screen.getByText(/semantic search unavailable/i)).toBeInTheDocument()
  })

  it('shows neither note for a verified semantic result', () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.queryByText(/relevance not verified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/semantic search unavailable/i)).not.toBeInTheDocument()
  })

  it('shows the search phrasings used and any credits', () => {
    render(<PassageSearchArtifact {...BASE} credits={['Cross-references: OpenBible.info (CC-BY)']} />)
    expect(screen.getByText(/caught up together/)).toBeInTheDocument()
    expect(screen.getByText(/OpenBible.info/)).toBeInTheDocument()
  })

  it('frames a passage query by its label and marks cross-reference hits', () => {
    render(
      <PassageSearchArtifact
        {...BASE}
        kind="passage"
        label="Romans 8:28"
        query="Romans 8:28"
        phrasings={[]}
        passages={[{ ...BASE.passages[0], sources: ['cross_reference'] }]}
      />,
    )
    expect(screen.getByText(/related to Romans 8:28/i)).toBeInTheDocument()
    expect(screen.getByText(/cross-reference/i)).toBeInTheDocument()
  })

  it('renders an empty or malformed card (old or imported) without crashing', () => {
    render(<PassageSearchArtifact {...(BASE as PassageSearchArtifactParams)} passages={undefined as never} phrasings={undefined as never} credits={undefined as never} />)
    expect(screen.getByText(/Where is the rapture talked about/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run (from `frontend/`): `npx vitest run src/components/artifacts/PassageSearchArtifact.test.tsx`
Expected: FAIL (cannot resolve `./PassageSearchArtifact`).

- [ ] **Step 4: Implement the artifact**

```tsx
// frontend/src/components/artifacts/PassageSearchArtifact.tsx
import type { MouseEvent } from 'react'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { PassageResult, PassageSearchArtifactParams } from '@/types/session'

function PassageCard({ passage }: { passage: PassageResult }) {
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const href = `/explorer?reference=${encodeURIComponent(passage.first_ref)}`

  // This SPA doesn't serve `/explorer` as a real route — open the passage
  // in-app instead (same interception the other artifacts apply). The href
  // stays for keyboard/middle-click/a11y.
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    openArtifact({ type: 'chapter', label: `${passage.ref} ▸`, params: { reference: passage.ref } })
  }

  return (
    <div className="rounded-lg border border-[var(--color-theme-border)] p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <a href={href} onClick={handleClick} className="font-semibold text-[var(--color-theme-accent)] hover:underline">
          {passage.ref}
        </a>
        {passage.sources.includes('cross_reference') && (
          <span className="text-xs rounded px-1.5 py-0.5 bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)]">
            cross-reference
          </span>
        )}
      </div>
      {passage.reason && (
        <p data-testid="passage-reason" className="text-sm font-medium leading-relaxed">
          {passage.reason}
        </p>
      )}
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{passage.text}</p>
    </div>
  )
}

export function PassageSearchArtifact(params: PassageSearchArtifactParams) {
  // `passages`, `phrasings` and `credits` can arrive via an imported/shared
  // or older card — default them so the card still renders.
  const { query, kind, label, verified, semantic, passages = [], phrasings = [], credits = [] } = params
  const title = kind === 'passage' ? `Passages related to ${label}` : `Passages for “${query}”`

  return (
    <div className="space-y-3 p-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {!verified && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Relevance not verified — these are the closest matches found.
        </p>
      )}
      {!semantic && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Semantic search unavailable — matched on keywords only.
        </p>
      )}
      {phrasings.length > 0 && (
        <p className="text-xs text-[var(--color-text-secondary)]">Also searched: {phrasings.join(' · ')}</p>
      )}
      <div className="space-y-2">
        {passages.map((passage) => (
          <PassageCard key={passage.ref} passage={passage} />
        ))}
      </div>
      {credits.map((credit) => (
        <p key={credit} className="text-xs text-[var(--color-text-secondary)]">{credit}</p>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Wire it into the artifact pane and the mode picker**

`frontend/src/components/shell/ArtifactPane.tsx`: import `PassageSearchArtifact` (alphabetical among the artifact imports) and `PassageSearchArtifactParams` (add to the existing `import type { … } from '@/types/session'` list); after the `story` block add

```tsx
                {activeArtifact.type === 'passage_search' && (
                  <PassageSearchArtifact {...(data as PassageSearchArtifactParams)} />
                )}
```

`frontend/src/components/shell/ModePickerScreen.tsx`: add `BookMarked` to the `lucide-react` import; change `import { postChat, postChatStream } from '@/lib/chatApi'` to `import { fetchPassagesStatus, postChat, postChatStream } from '@/lib/chatApi'`; change `import { useState } from 'react'` to `import { useEffect, useState } from 'react'` if it is not already; inside the component, after the `updateMessage`/`readingPlanProgress` selectors add

```tsx
  const [passagesAvailable, setPassagesAvailable] = useState(false)
  useEffect(() => {
    let cancelled = false
    void fetchPassagesStatus().then((available) => {
      if (!cancelled) setPassagesAvailable(available)
    })
    return () => {
      cancelled = true
    }
  }, [])
```

and in the tile list, immediately before the `Ask Anything` button (`onClick={() => startSession('freeform', '💬 Ask Anything', {})}`), add

```tsx
          {passagesAvailable && (
            <button
              className={STARTER_BUBBLE}
              onClick={() => startSession('passages', '📖 Find passages', {})}
            >
              <BookMarked className="h-4 w-4 shrink-0" aria-hidden="true" /> Find passages
            </button>
          )}
```

Append to `ModePickerScreen.test.tsx` (inside the `describe`, mirroring the existing tile tests):

```tsx
  it('hides the "Find passages" tile when the index is unavailable', async () => {
    vi.spyOn(chatApi, 'fetchPassagesStatus').mockResolvedValue(false)
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await waitFor(() => expect(chatApi.fetchPassagesStatus).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /find passages/i })).not.toBeInTheDocument()
  })

  it('shows the tile when available and starts a passages session from the primer', async () => {
    vi.spyOn(chatApi, 'fetchPassagesStatus').mockResolvedValue(true)
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat',
      message: "Type a verse, or ask where a topic appears in the Bible, and I'll find the relevant passages.",
      data: null,
      follow_up_questions: ['Romans 8:28'],
    } as Awaited<ReturnType<typeof chatApi.postChat>>)
    const onStarted = vi.fn()
    render(<ModePickerScreen onSessionStarted={onStarted} />)
    await userEvent.click(await screen.findByRole('button', { name: /find passages/i }))
    await waitFor(() => expect(onStarted).toHaveBeenCalled())
    expect(chatApi.postChat).toHaveBeenCalledWith({ message: '', mode: 'passages', mode_params: {} })
    const s = firstSession()
    expect(s.mode).toBe('passages')
    expect(s.messages.at(-1)?.followUpQuestions).toEqual(['Romans 8:28'])
  })
```

- [ ] **Step 6: Run the frontend checks**

Run (from `frontend/`): `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all tests pass, no type errors, no lint errors. If the repo has no `lint` script, run only the first two and say so.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(passages): Find passages artifact, mode tile and session wiring"
```

---

### Task 11: Eval set and the manual eval script

**Files:**
- Create: `chatbot/data/passage_eval.py`
- Create: `scripts/eval_passages.py`
- Test: `tests/chatbot/test_passage_eval_data.py`

**Interfaces:**
- Consumes: `passage_search` (Task 8), `passage_index` (Task 3), `jev_client`.
- Produces: `CONCEPT` (30), `PASSAGE` (6): lists of `{"query": str, "must_see": [ref, …]}`; `OFF_TOPIC` (6): list of query strings.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_passage_eval_data.py
"""Every must-see reference in the eval set must be a real verse in Complete.db,
and the set must have its intended shape."""
import sqlite3
from pathlib import Path

from chatbot.data.passage_eval import CONCEPT, OFF_TOPIC, PASSAGE

ROOT = Path(__file__).resolve().parents[2]


def _refs():
    con = sqlite3.connect(f"file:{ROOT / 'Complete.db'}?mode=ro", uri=True)
    refs = {r[0] for r in con.execute("SELECT ref FROM Complete")}
    con.close()
    return refs


def test_shape():
    assert len(CONCEPT) == 30 and len(PASSAGE) == 6 and len(OFF_TOPIC) == 6
    for item in CONCEPT + PASSAGE:
        assert item["query"].strip() and len(item["must_see"]) >= 3
    assert len({i["query"] for i in CONCEPT + PASSAGE}) == 36


def test_every_must_see_reference_exists():
    refs = _refs()
    missing = [(i["query"], r) for i in CONCEPT + PASSAGE for r in i["must_see"] if r not in refs]
    assert missing == []


def test_passage_queries_parse_as_passages():
    from chatbot.passage_search import Query, parse_query
    for item in PASSAGE:
        assert isinstance(parse_query(item["query"]), Query), item["query"]
        assert parse_query(item["query"]).kind == "passage"
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/chatbot/test_passage_eval_data.py -v`
Expected: FAIL (`ModuleNotFoundError: chatbot.data.passage_eval`).

- [ ] **Step 3: Write the eval data**

```python
# chatbot/data/passage_eval.py
"""Labelled queries for scripts/eval_passages.py (live, manual).

`must_see` lists KJV verses a reasonable reader expects among a query's top
10 results; a hit is any returned passage whose verse span contains one of
them. These labels are subjective for contested topics — the point is a
stable yardstick for tuning thresholds, not a verdict on doctrine. Every
reference is verified against Complete.db by
tests/chatbot/test_passage_eval_data.py."""

CONCEPT = [
    {"query": "Where is the rapture talked about in the Bible?", "must_see": ["1 Thessalonians 4:17", "1 Corinthians 15:52", "John 14:3"]},
    {"query": "What does the Bible say about speaking in tongues?", "must_see": ["1 Corinthians 14:2", "Acts 2:4", "1 Corinthians 12:10"]},
    {"query": "Who is the antichrist?", "must_see": ["1 John 2:18", "2 Thessalonians 2:3", "1 John 4:3"]},
    {"query": "Where does the Bible talk about the new birth?", "must_see": ["John 3:3", "1 Peter 1:23", "Titus 3:5"]},
    {"query": "What does the Bible say about forgiving others?", "must_see": ["Matthew 6:14", "Colossians 3:13", "Matthew 18:21"]},
    {"query": "Where is the Trinity taught?", "must_see": ["Matthew 28:19", "2 Corinthians 13:14", "1 John 5:7"]},
    {"query": "What does the Bible say about tithing?", "must_see": ["Malachi 3:10", "Genesis 14:20", "Leviticus 27:30"]},
    {"query": "Passages about the second coming of Christ", "must_see": ["Acts 1:11", "Matthew 24:30", "Revelation 1:7"]},
    {"query": "Where does it talk about the resurrection of the dead?", "must_see": ["1 Corinthians 15:20", "John 11:25", "Daniel 12:2"]},
    {"query": "What does the Bible say about divorce?", "must_see": ["Matthew 19:9", "Malachi 2:16", "1 Corinthians 7:15"]},
    {"query": "Verses about anxiety and worry", "must_see": ["Philippians 4:6", "Matthew 6:25", "1 Peter 5:7"]},
    {"query": "What does the Bible say about the Sabbath?", "must_see": ["Exodus 20:8", "Mark 2:27", "Colossians 2:16"]},
    {"query": "Where is baptism explained?", "must_see": ["Romans 6:4", "Matthew 28:19", "Acts 2:38"]},
    {"query": "What does the Bible say about the end times tribulation?", "must_see": ["Matthew 24:21", "Daniel 12:1", "Revelation 7:14"]},
    {"query": "Where does the Bible describe heaven?", "must_see": ["Revelation 21:4", "John 14:2", "2 Corinthians 5:1"]},
    {"query": "What does the Bible say about hell?", "must_see": ["Mark 9:44", "Revelation 20:15", "Matthew 25:41"]},
    {"query": "How is a person saved?", "must_see": ["Ephesians 2:8", "Romans 10:9", "Acts 16:31"]},
    {"query": "What does the Bible say about the Holy Spirit as a guide?", "must_see": ["John 16:13", "Romans 8:14", "John 14:26"]},
    {"query": "Verses about the armor of God", "must_see": ["Ephesians 6:11", "Ephesians 6:14", "1 Thessalonians 5:8"]},
    {"query": "What does the Bible say about giving to the poor?", "must_see": ["Proverbs 19:17", "Matthew 25:40", "Deuteronomy 15:11"]},
    {"query": "Where does the Bible talk about fasting?", "must_see": ["Matthew 6:16", "Isaiah 58:6", "Joel 2:12"]},
    {"query": "What does the Bible say about the tongue and speech?", "must_see": ["James 3:5", "Proverbs 18:21", "Ephesians 4:29"]},
    {"query": "Passages about angels", "must_see": ["Hebrews 1:14", "Psalm 91:11", "Luke 1:26"]},
    {"query": "What does the Bible say about the last judgment?", "must_see": ["Revelation 20:12", "2 Corinthians 5:10", "Matthew 25:32"]},
    {"query": "Where is the millennial reign of Christ described?", "must_see": ["Revelation 20:4", "Isaiah 11:6", "Zechariah 14:9"]},
    {"query": "What does the Bible say about false prophets?", "must_see": ["Matthew 7:15", "Deuteronomy 13:1", "2 Peter 2:1"]},
    {"query": "Where does the Bible talk about the fear of the Lord?", "must_see": ["Proverbs 9:10", "Ecclesiastes 12:13", "Psalm 111:10"]},
    {"query": "What does the Bible say about marriage?", "must_see": ["Genesis 2:24", "Ephesians 5:25", "Hebrews 13:4"]},
    {"query": "Passages about the covenant with Abraham", "must_see": ["Genesis 12:2", "Genesis 15:18", "Genesis 17:7"]},
    {"query": "What does the Bible say about the Lord's Supper?", "must_see": ["1 Corinthians 11:24", "Matthew 26:26", "Luke 22:19"]},
]

PASSAGE = [
    {"query": "Romans 8:28", "must_see": ["Genesis 50:20", "Jeremiah 29:11", "Ephesians 1:11"]},
    {"query": "John 3:16", "must_see": ["Romans 5:8", "1 John 4:9", "Ephesians 2:4"]},
    {"query": "Psalm 23:1", "must_see": ["John 10:11", "Isaiah 40:11", "Ezekiel 34:11"]},
    {"query": "Isaiah 53:5", "must_see": ["1 Peter 2:24", "Romans 4:25", "Matthew 8:17"]},
    {"query": "Genesis 1:1", "must_see": ["John 1:1", "Hebrews 11:3", "Colossians 1:16"]},
    {"query": "Philippians 4:13", "must_see": ["2 Corinthians 12:9", "John 15:5", "Ephesians 3:16"]},
]

OFF_TOPIC = [
    "best pizza recipe",
    "how do I change a car tire",
    "who won the 2018 world cup",
    "python list comprehension syntax",
    "what is the capital of Australia",
    "how to lower my mortgage interest rate",
]
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/chatbot/test_passage_eval_data.py -v`
Expected: 3 passed. (`Psalm 23:1` parses as a passage because the router's abbreviation table resolves "Psalm"; if `test_passage_queries_parse_as_passages` fails for one query, fix the query's spelling, not the parser.)

- [ ] **Step 5: Write the manual eval script**

```python
# scripts/eval_passages.py
"""Live retrieval eval for "Find passages" (uses the real embedder, LLM and
JEV — costs real API calls, so it is manual):

    set -a; . ./.env; set +a
    python scripts/eval_passages.py [--no-jev] [--limit N]

Reports, over chatbot/data/passage_eval.py:
  recall@10   share of must-see verses that fall inside a returned passage
  off-topic   share of off-topic queries that correctly return nothing
for the full pipeline and (unless --no-jev) again with JEV removed, so the
comparison shows whether the JEV filter earns its place. Tune the
thresholds in chatbot/passage_rank.py only with this script."""
import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chatbot import passage_index, passage_search  # noqa: E402
from chatbot.data.passage_eval import CONCEPT, OFF_TOPIC, PASSAGE  # noqa: E402


def _covered(index, passages, must_see) -> int:
    span_of = {c.ref: (c.first_id, c.last_id) for c in index.chunks}      # chunk refs are unique
    spans = [span_of[p["ref"]] for p in passages if p["ref"] in span_of]
    hits = 0
    for ref in must_see:
        vid = index.verse_id_for_ref(ref)
        if vid and any(a <= vid <= b for a, b in spans):
            hits += 1
    return hits


async def _run(label: str, limit) -> None:
    index = passage_index.get_index()
    assert index is not None, "passage index is unavailable"
    total = hit = 0
    per_group = {}
    for group, items in (("concept", CONCEPT), ("passage", PASSAGE)):
        g_total = g_hit = 0
        for item in items[:limit]:
            result = await passage_search.search(item["query"])
            passages = (result.get("artifacts") or [{"params": {"passages": []}}])[0]["params"]["passages"]
            g_total += len(item["must_see"])
            g_hit += _covered(index, passages, item["must_see"])
        per_group[group] = (g_hit, g_total)
        total, hit = total + g_total, hit + g_hit
    quiet = 0
    for query in OFF_TOPIC[:limit]:
        result = await passage_search.search(query)
        quiet += 0 if result.get("artifacts") else 1
    print(f"[{label}] recall@10 overall {hit}/{total} = {hit / max(total, 1):.0%}; "
          + ", ".join(f"{g} {h}/{t}" for g, (h, t) in per_group.items())
          + f"; off-topic returning nothing {quiet}/{len(OFF_TOPIC[:limit])}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-jev", action="store_true", help="only run the without-JEV arm")
    parser.add_argument("--limit", type=int, default=None, help="first N queries per group (cheap smoke run)")
    args = parser.parse_args()
    if not args.no_jev and os.getenv("TYPESAFE_API_KEY", "").strip():
        asyncio.run(_run("with JEV", args.limit))
    saved = os.environ.pop("TYPESAFE_API_KEY", None)
    try:
        asyncio.run(_run("without JEV", args.limit))
    finally:
        if saved is not None:
            os.environ["TYPESAFE_API_KEY"] = saved


if __name__ == "__main__":
    main()
```

`_covered` maps each returned passage back to its chunk by `ref` (chunk refs are unique) and checks each must-see verse id against the chunk's exact verse span.

- [ ] **Step 6: Smoke-run the script**

Run: `set -a; . ./.env; set +a; python scripts/eval_passages.py --limit 3`
Expected: two summary lines (`[with JEV] …` and `[without JEV] …`) and no traceback. **Do not tune anything in this task** — the full run and any threshold tuning are Task 12's manual gate. Put both lines in the report.

- [ ] **Step 7: Commit**

```bash
git add chatbot/data/passage_eval.py scripts/eval_passages.py tests/chatbot/test_passage_eval_data.py
git commit -m "feat(passages): labelled eval set and manual retrieval eval script"
```

---

### Task 12: Documentation and the calibration gate

**Files:**
- Modify: `CLAUDE.md`, `DEPLOYMENT.md`, `.env.example`, `README.md` (attribution)

**Interfaces:** none (documentation only). Values recorded in Task 4 (model load time, per-query latency, Docker image size if measured) and Task 11's smoke output are inserted verbatim.

- [ ] **Step 1: `CLAUDE.md`** — add a section after the Tell a Story section:

```markdown
## "Find passages" mode (internal id `passages`)

Given a verse reference ("Romans 8:28") or a plain-English statement ("Where
is the rapture talked about in the Bible?"), returns up to 10 ranked passages,
each with a one-sentence reason and a link, as an inline `passage_search`
artifact (passage text copied into the params so reloads/shares redraw it).
The corpus is 4,284 KJV chunks (2–16 verses) cut at topic boundaries by JEV
(`experiments/chunking/`, committed as `chatbot/data/passage_chunks.json`),
embedded once with a local ONNX model (`BAAI/bge-small-en-v1.5` via
`fastembed`; vectors in `chatbot/data/passage_embeddings.npy`, rebuilt with
`scripts/build_passage_index.py` — **changing the model or chunks requires a
rebuild**, and a model-name mismatch makes the mode report unavailable).
Retrieval is embedding search + in-memory BM25 (`chatbot/passage_index.py`)
+ TSK cross-references for passage input (`chatbot/passage_tsk.py`, OpenBible.info
data, CC-BY — attribution shown in the artifact); statement queries are first
rewritten by one LLM call into KJV-style phrases (the KJV never says
"rapture" — it says "caught up"). Lists merge by reciprocal-rank fusion, then
JEV judges each candidate (`chatbot/jev_client.py`, one Choice per candidate:
`directly`/`partly`/`tangentially`/`not_relevant`), and `chatbot/passage_rank.py`
— a pure module holding every threshold — keeps the relevant ones. One
batched LLM call writes the reasons. Every stage after retrieval fails open:
no JEV → results marked "relevance not verified"; no embedder → keyword-only.
The tile shows when the index loads (`GET /passages/status`), independent of
JEV. Tune thresholds only with `scripts/eval_passages.py` (live, manual)
against `chatbot/data/passage_eval.py`. See
`docs/superpowers/specs/2026-09-30-passage-search-design.md`.
```

- [ ] **Step 2: `DEPLOYMENT.md`** — add a section "Find passages" containing:
  - the data files that must ship (`chatbot/data/passage_*.{json,npy}`, `tsk_crossrefs.json` — they are inside `chatbot/`, which `Dockerfile.chatbot` already copies);
  - the `fastembed` model pre-fetch line added to `Dockerfile.chatbot` and `FASTEMBED_CACHE_PATH=/opt/fastembed_cache`, and that the first image build downloads about 67 MB;
  - the measured numbers from Task 4 (model load seconds, per-query milliseconds, image size or "not measured");
  - `TYPESAFE_API_KEY` is **optional** for this mode (without it results are unverified) and `PASSAGES_JEV_TIMEOUT` (default 5);
  - **a required pre-production step:** run `python scripts/eval_passages.py` with a real key, record recall@10 and the off-topic rate with and without JEV in this section, and only tune `chatbot/passage_rank.py` constants from those numbers;
  - the verify command through the proxy: `curl -s http://localhost:8000/api/bible-chat/passages/status` (use the host-reachable path the other verify commands in this file use, not the Docker-internal port).

- [ ] **Step 3: `.env.example`** — append:

```
# ─── Find passages ─────────────────────────────────────────────────────────
# Optional: TypeSafe JEV filters results for relevance (TYPESAFE_API_KEY, above
# in the misquote-era JEV block if present, otherwise add it here). Without
# a key the mode still works and marks results "relevance not verified".
#   TYPESAFE_API_KEY=
#   PASSAGES_JEV_TIMEOUT=5
```

If `.env.example` has no `TYPESAFE_API_KEY` line, keep the wording above as written (it already covers that case).

- [ ] **Step 4: `README.md`** — add a short "Data credits" note: cross-reference data from OpenBible.info (CC-BY), derived from the Treasury of Scripture Knowledge; section headings used only to evaluate chunk boundaries came from the Berean Standard Bible (public domain) via helloao.org.

- [ ] **Step 5: Run the full backend and frontend suites**

Run: `pytest tests/ -q` and, from `frontend/`, `npx vitest run && npx tsc --noEmit`
Expected: everything passes with pristine output. Any pre-existing failure unrelated to these files must be named in the report with evidence it fails on `master` too.

- [ ] **Step 6: Run the live eval once and record it (the calibration gate)**

Run: `set -a; . ./.env; set +a; python scripts/eval_passages.py`
Expected: two summary lines. Copy them into the DEPLOYMENT.md section from Step 2. **Do not change any threshold in this task.** If recall@10 with JEV is more than 5 points *below* recall without JEV, or any off-topic query returns results with JEV on, say so prominently in the report — that is the signal to open a tuning task, and it is the user's decision.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md DEPLOYMENT.md .env.example README.md
git commit -m "docs(passages): document Find passages, deployment steps and the first eval run"
```

---

## Self-Review

**Spec coverage.** Purpose/scope → Tasks 8–10. Chunk table → Task 1. Offline build (chunks JSON, embeddings, meta) → Tasks 1, 4. Runtime units: `passage_index` → 3, `passage_embed` → 4, `jev_client` → 6, `passage_rank` → 2, `passage_search` → 7–8. Pipeline steps 1–6 → 7 (classify, rewrite, retrieve) and 8 (JEV filter, reasons, assemble). Failure table: JEV → Task 8 tests `test_jev_unavailable…`, `test_no_jev_key…`; rewrite fails → Task 7 `test_rewrite_queries…`; reasons fail → Task 8 `test_reasons_failure…`; embedder → Tasks 7 and 8; index missing/mismatch → Task 3 tests + Task 8 `test_unavailable_index` + Task 9 status endpoint. Limits (500 chars, 25 verses, caps) → Tasks 7–8. TSK → Task 5. Testing/eval → Tasks 2–11 unit tests, Task 11 eval set/script. Known gaps → carried into Task 12's calibration gate. Frontend → Task 10. Docs/attribution → Task 12.

**Placeholder scan.** No TBD/TODO; every code step carries code; the two edits inside Task 7 and Task 11 that tell the implementer to delete an unused line are explicit about what to delete.

**Type consistency.** `Candidate/Relevance/Ranked` (Task 2) are used unchanged in Tasks 7–8; `Index` methods (Task 3) match their uses (`nearest`, `keyword`, `chunk_ids_for_verses`, `verse_id_for_ref`, `chunk_span`, `.chunks`); `Judgment(key, probabilities, confidence)` (Task 6) is converted to `Relevance` in Task 8; `Query` and `parse_query` (Task 7) are used in Tasks 8 and 11; artifact params (Task 8) match `PassageSearchArtifactParams` (Task 10) field for field (`query, kind, label, phrasings, verified, semantic, credits, passages[ref, first_ref, text, reason, sources]`); `passage_tsk.related_verse_ids` and `ATTRIBUTION` (Task 5) match their uses.

**Review Focus coverage.** (1) empty/over-long → Task 8 `test_empty_input…`, `test_over_long_input…`; (2) bare chapter / >25 verses → Task 7 tests; (3) own chunk excluded, including spanning two chunks → Task 7 tests; (4) partial/malformed/all-failing JEV → Task 6 tests + Task 8 `test_partial_jev…`, `test_jev_unavailable…`; (5) everything failing at once → Task 8 `test_everything_optional_failing…`.
