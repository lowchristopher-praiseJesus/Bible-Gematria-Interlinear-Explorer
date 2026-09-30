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
