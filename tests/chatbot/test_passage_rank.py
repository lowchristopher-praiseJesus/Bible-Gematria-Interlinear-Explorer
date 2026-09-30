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
