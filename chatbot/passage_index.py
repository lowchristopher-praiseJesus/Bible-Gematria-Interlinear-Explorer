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
VERSE_VECTORS_FILE = DATA_DIR / "passage_verse_embeddings.npy"
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
VERSE_WEIGHT = 0.7  # dense score = VERSE_WEIGHT * best verse cosine + CHUNK_WEIGHT * chunk cosine
CHUNK_WEIGHT = 0.3


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
    def __init__(self, chunks: List[Chunk], vectors: np.ndarray, verses: Sequence[Verse],
                 verse_vectors: Optional[np.ndarray] = None):
        self.chunks = chunks
        self.vectors = vectors
        self.verse_vectors = None if verse_vectors is None else np.asarray(verse_vectors, dtype=np.float32)
        self._verse_slices: List[Tuple[int, int]] = []
        if self.verse_vectors is not None:
            position = {v.id: i for i, v in enumerate(verses)}
            self._verse_slices = [(position[c.first_id], position[c.last_id] + 1) for c in chunks]
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
        with np.errstate(all="ignore"):  # numpy/Accelerate on macOS emits spurious matmul warnings
            scores = self.vectors @ vector
            if self.verse_vectors is not None:
                verse_sim = self.verse_vectors @ vector
                best = self._max_over_verses(verse_sim)
                scores = VERSE_WEIGHT * best + CHUNK_WEIGHT * scores
        return [int(i) for i in np.argsort(-scores, kind="stable")[:k]]

    def _max_over_verses(self, verse_sim: np.ndarray) -> np.ndarray:
        slices = self._verse_slices
        tiled = slices[0][0] == 0 and slices[-1][1] == len(verse_sim) and all(
            slices[i][1] == slices[i + 1][0] for i in range(len(slices) - 1))
        if tiled:
            return np.maximum.reduceat(verse_sim, [a for a, _ in slices])
        return np.array([verse_sim[a:b].max() for a, b in slices], dtype=np.float32)

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
    db_file: Path = None, expected_model: Optional[str] = None, verse_vectors_file: Path = None,
) -> Index:
    chunks_file = chunks_file or CHUNKS_FILE
    vectors_file = vectors_file or VECTORS_FILE
    meta_file = meta_file or META_FILE
    verse_vectors_file = verse_vectors_file or VERSE_VECTORS_FILE
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
    verse_vectors = np.load(verse_vectors_file).astype(np.float32)
    if verse_vectors.shape != (len(verses), vectors.shape[1]) or meta.get("verse_rows") != len(verses):
        raise ValueError(
            f"verse vector rows {verse_vectors.shape[0]} != verses {len(verses)} (meta verse_rows {meta.get('verse_rows')})")
    return Index(build_chunks(pairs, verses), vectors, verses, verse_vectors)


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
