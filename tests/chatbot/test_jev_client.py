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


async def test_empty_probabilities_dict_alone_raises(monkeypatch):
    """Empty probabilities dict should cause all items to be skipped."""
    def handler(request: httpx.Request):
        return httpx.Response(200, json={"answers": {"c0": {"probabilities": {}, "confidence": 0.9}}})

    _use(monkeypatch, handler)
    with pytest.raises(JevUnavailable):
        await judge_relevance("q", [("1", "A 1:1", "t")])


async def test_missing_option_skipped_but_valid_returned(monkeypatch):
    """Missing option in one response should skip it; valid responses are kept."""
    def handler(request: httpx.Request):
        import json
        body = json.loads(request.content)
        if "text A" in body["state"]["passage"]:
            # Missing 'partly' option
            return httpx.Response(200, json={"answers": {"c0": {
                "probabilities": {"directly": 0.8, "tangentially": 0.05, "not_relevant": 0.05},
                "confidence": 0.9
            }}})
        else:
            return httpx.Response(200, json={"answers": {"c0": ANSWER}})

    _use(monkeypatch, handler)
    out = await judge_relevance("q", [("1", "A 1:1", "text A"), ("2", "B 1:1", "text B")])
    assert [j.key for j in out] == ["2"]


async def test_all_zero_probabilities_skipped(monkeypatch):
    """All-zero probabilities should be rejected (sum < 0.5)."""
    def handler(request: httpx.Request):
        return httpx.Response(200, json={"answers": {"c0": {
            "probabilities": {"directly": 0.0, "partly": 0.0, "tangentially": 0.0, "not_relevant": 0.0},
            "confidence": 0.9
        }}})

    _use(monkeypatch, handler)
    with pytest.raises(JevUnavailable):
        await judge_relevance("q", [("1", "A 1:1", "t")])


async def test_confidence_nan_skipped(monkeypatch):
    """NaN confidence should be rejected."""
    def handler(request: httpx.Request):
        # Send raw response with NaN (no JSON encoder can produce it, so we use raw content)
        return httpx.Response(200, content=b'{"answers":{"c0":{"probabilities":{"directly":0.8,"partly":0.1,"tangentially":0.05,"not_relevant":0.05},"confidence":NaN}}}')

    _use(monkeypatch, handler)
    with pytest.raises(JevUnavailable):
        await judge_relevance("q", [("1", "A 1:1", "t")])


async def test_out_of_range_probability_skipped(monkeypatch):
    """Probability > 1.0 should be rejected."""
    def handler(request: httpx.Request):
        return httpx.Response(200, json={"answers": {"c0": {
            "probabilities": {"directly": 1.5, "partly": 0.1, "tangentially": 0.05, "not_relevant": 0.05},
            "confidence": 0.9
        }}})

    _use(monkeypatch, handler)
    with pytest.raises(JevUnavailable):
        await judge_relevance("q", [("1", "A 1:1", "t")])


async def test_boolean_probability_skipped(monkeypatch):
    """Boolean as probability should be rejected."""
    def handler(request: httpx.Request):
        return httpx.Response(200, json={"answers": {"c0": {
            "probabilities": {"directly": True, "partly": 0.1, "tangentially": 0.05, "not_relevant": 0.05},
            "confidence": 0.9
        }}})

    _use(monkeypatch, handler)
    with pytest.raises(JevUnavailable):
        await judge_relevance("q", [("1", "A 1:1", "t")])
