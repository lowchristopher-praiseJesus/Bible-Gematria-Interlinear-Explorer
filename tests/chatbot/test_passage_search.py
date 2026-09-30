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

    async def fake(query, items, timeout=None):
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

    async def down(query, items, timeout=None):
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

    async def down(query, items, timeout=None):
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


async def test_junk_jev_key_is_skipped_and_the_good_judgment_still_filters(index, monkeypatch):
    _llm(monkeypatch)
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")

    async def fake(query, items, timeout=None):
        good = {o: 0.0 for o in jev_client.OPTIONS}
        good["directly"] = 0.9
        return [Judgment("abc", dict(good), 0.9), Judgment("0", good, 0.9)]
    monkeypatch.setattr(ps.jev_client, "judge_relevance", fake)
    result = await ps.search("the rapture")
    params = result["artifacts"][0]["params"]
    assert params["verified"] is True
    assert [p["ref"] for p in params["passages"]] == ["1 Thessalonians 4:16-17"]


async def test_jev_timeout_fails_open_to_unverified(index, monkeypatch):
    import asyncio
    _llm(monkeypatch)
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    monkeypatch.setattr(ps, "JEV_TIMEOUT", 0.05)
    monkeypatch.setattr(ps, "MIN_STAGE_SECONDS", 0.05)
    monkeypatch.setattr(ps, "JEV_BACKSTOP_GRACE", 0.05)

    async def slow(query, items, timeout=None):
        await asyncio.sleep(1)
        return []
    monkeypatch.setattr(ps.jev_client, "judge_relevance", slow)
    started = asyncio.get_running_loop().time()
    result = await ps.search("the sabbath day")
    assert asyncio.get_running_loop().time() - started < 0.9
    params = result["artifacts"][0]["params"]
    assert params["verified"] is False and params["passages"]


async def test_reasons_follow_the_ranked_order_not_the_candidate_order(index, monkeypatch):
    _llm(monkeypatch, rewrite="", reasons="1. Reason for the first shown.\n2. Reason for the second shown.")
    monkeypatch.setattr(ps.passage_embed, "embed_queries",
                        lambda texts: np.array([[1, 0, 0]] * len(texts), dtype=np.float32))

    async def fake_rewrite(*a, **k):
        return []
    monkeypatch.setattr(ps, "rewrite_queries", fake_rewrite)
    seen = {}
    real = ps.retrieve

    async def spy(idx, query, phrasings):
        cands, sem = await real(idx, query, phrasings)
        seen["order"] = [c.chunk_id for c in cands]
        return cands, sem
    monkeypatch.setattr(ps, "retrieve", spy)
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")

    async def fake(query, items, timeout=None):
        out = []
        for key, _r, _t in items:
            probs = {o: 0.0 for o in jev_client.OPTIONS}
            probs["directly"] = 0.95 if key == str(seen["order"][1]) else 0.6
            out.append(Judgment(key, probs, 0.9))
        return out
    monkeypatch.setattr(ps.jev_client, "judge_relevance", fake)
    result = await ps.search("the sabbath day light")
    passages = result["artifacts"][0]["params"]["passages"]
    a, b = seen["order"][0], seen["order"][1]
    assert [p["ref"] for p in passages][:2] == [index.chunks[b].ref, index.chunks[a].ref]
    assert passages[0]["reason"] == "Reason for the first shown."
    assert passages[1]["reason"] == "Reason for the second shown."


async def test_jev_stage_cap_keeps_the_judgments_already_received(index, monkeypatch):
    import asyncio
    _llm(monkeypatch, reasons="1. Reason.")
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    seen = {}

    async def partial(query, items, timeout=None):
        seen["timeout"] = timeout
        await asyncio.sleep(0.01)                  # the cap hits: only one judgment arrived
        probs = {o: 0.0 for o in jev_client.OPTIONS}
        probs["partly"] = 0.9
        return [Judgment(items[0][0], probs, 0.8)]
    monkeypatch.setattr(ps.jev_client, "judge_relevance", partial)
    result = await ps.search("the rapture")
    params = result["artifacts"][0]["params"]
    assert params["verified"] is True and len(params["passages"]) == 1
    assert seen["timeout"] is not None and 0 < seen["timeout"] <= ps.JEV_TIMEOUT


async def test_both_llm_stages_disable_reasoning(index, monkeypatch):
    calls = []

    async def fake(system, user, **kw):
        calls.append(kw)
        if "search phrases" in system:
            return "caught up together"
        return "1. Describes the Lord gathering believers."
    monkeypatch.setattr(ps, "simple_completion", fake)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    await ps.search("Where is the rapture talked about in the Bible?")
    assert len(calls) == 2 and all(kw.get("no_reasoning") is True for kw in calls)
