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


def test_multiword_and_numbered_bare_chapters_ask_for_a_verse():
    for text in ("Song of Solomon 2", "Song of Solomon 2.", "1 John 3"):
        msg = ps.parse_query(text)
        assert isinstance(msg, str) and "verse" in msg.lower(), text


def test_non_book_phrase_with_a_number_stays_a_statement():
    for text in ("chapter 5", "top 10"):
        assert ps.parse_query(text).kind == "statement", text


def test_cross_chapter_range_asks_for_a_single_chapter():
    for text in ("Romans 8:28-9:3", "Genesis 1:1-2:3"):
        msg = ps.parse_query(text)
        assert isinstance(msg, str) and "single chapter" in msg, text


def test_reversed_range_is_not_silently_swapped():
    for text in ("Romans 8:30-28", "Romans 8:28-9"):
        msg = ps.parse_query(text)
        assert isinstance(msg, str) and "backwards" in msg, text


def test_25_verse_boundary():
    q = ps.parse_query("Psalm 119:1-25")
    assert q.kind == "passage" and len(q.verse_ids) == 25
    msg = ps.parse_query("Psalm 119:1-26")
    assert isinstance(msg, str) and "25" in msg


def test_en_dash_and_em_dash_ranges_are_passages():
    for text, label, count in (("John 3:16–21", "John 3:16-21", 6),
                               ("Matthew 5:3–12", "Matthew 5:3-12", 10),
                               ("John 3:16—21", "John 3:16-21", 6),
                               ("John 3:16−21", "John 3:16-21", 6)):
        q = ps.parse_query(text)
        assert not isinstance(q, str) and q.kind == "passage", text
        assert q.label == label and len(q.verse_ids) == count, text


def test_dashed_cross_chapter_and_reversed_ranges_keep_their_messages():
    msg = ps.parse_query("Romans 8:28–9:3")
    assert isinstance(msg, str) and "single chapter" in msg
    msg = ps.parse_query("Romans 8:30–28")
    assert isinstance(msg, str) and "backwards" in msg


def test_single_chapter_books_treat_a_bare_number_as_a_verse():
    for text, label in (("Jude 3", "Jude 1:3"), ("3 John 4", "3 John 1:4"),
                        ("Philemon 6", "Philemon 1:6"), ("Obadiah 1", "Obadiah 1:1"),
                        ("2 John 5", "2 John 1:5")):
        q = ps.parse_query(text)
        assert not isinstance(q, str) and q.kind == "passage", text
        assert q.label == label and len(q.verse_ids) == 1, text


def test_single_chapter_book_bare_number_out_of_range_and_multichapter_books():
    msg = ps.parse_query("Jude 99")
    assert isinstance(msg, str) and "couldn't find" in msg.lower()
    msg = ps.parse_query("Romans 8")
    assert isinstance(msg, str) and "whole chapter" in msg


def test_parse_phrasings_keeps_leading_numbers_but_strips_list_markers():
    out = ps.parse_phrasings("1 Corinthians 13\n12 baskets full\n1. caught up together\n2) twinkling of an eye\n- the trump of God")
    assert out == ["1 Corinthians 13", "12 baskets full", "caught up together",
                   "twinkling of an eye", "the trump of God"]
