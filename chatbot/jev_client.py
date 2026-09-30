"""Thin async client for TypeSafe's JEV "System One" classifier
(https://docs.typesafe.ai/api.md), used by "Find passages" to judge whether
a candidate passage addresses the user's query.

Plain httpx against the documented HTTP contract. One Choice request per
candidate (concurrency 8): 30 chunk-sized passages in one request risks
JEV's documented weakness with large unfocused input. A candidate whose
request fails or comes back malformed is skipped; only a missing key or *all*
requests failing raises JevUnavailable — callers then fail open."""

import asyncio
import math
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
        # Check that raw is a dict and contains exactly all OPTIONS as keys
        if not isinstance(raw, dict) or set(raw.keys()) != set(OPTIONS):
            return None

        # Validate and extract probabilities
        probabilities = {}
        prob_sum = 0.0
        for option in OPTIONS:
            value = raw[option]
            # Reject bools and non-numeric types
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return None
            # Reject non-finite values (NaN, inf)
            if not math.isfinite(value):
                return None
            # Reject out-of-range values (allow 1e-6 tolerance)
            if not (-1e-6 <= value <= 1.0 + 1e-6):
                return None
            probabilities[option] = float(value)
            prob_sum += probabilities[option]

        # Reject if probabilities sum to less than 0.5
        if prob_sum < 0.5:
            return None

        # Validate confidence
        conf_value = answer["confidence"]
        # Reject bools and non-numeric types
        if isinstance(conf_value, bool) or not isinstance(conf_value, (int, float)):
            return None
        # Reject non-finite values
        if not math.isfinite(conf_value):
            return None
        # Reject out-of-range values (allow 1e-6 tolerance)
        if not (-1e-6 <= conf_value <= 1.0 + 1e-6):
            return None
        confidence = float(conf_value)
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    return Judgment(key=key, probabilities=probabilities, confidence=confidence)


async def judge_relevance(
    query: str, items: Sequence[Tuple[str, str, str]], timeout: Optional[float] = None
) -> List[Judgment]:
    """items: (key, reference, passage text). Returns one Judgment per item
    that could be judged, in input order. `timeout` (seconds) is an optional
    overall cap: when it elapses the still-pending requests are cancelled and
    the judgments already received are returned; JevUnavailable is raised only
    if none succeeded."""
    if not is_configured():
        raise JevUnavailable("TYPESAFE_API_KEY is not set")
    if not items:
        return []
    url = os.getenv("TYPESAFE_API_URL", "https://api.typesafe.ai/v1/systemone")
    model = os.getenv("TYPESAFE_MODEL", "jev-latest")
    request_timeout = float(os.getenv("PASSAGES_JEV_TIMEOUT", "5"))
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

    async with _client_factory(request_timeout) as client:
        tasks = [asyncio.ensure_future(one(client, k, r, t)) for k, r, t in items]
        try:
            if timeout is None:
                await asyncio.gather(*tasks)
            else:
                await asyncio.wait(tasks, timeout=timeout)
        finally:
            pending = [t for t in tasks if not t.done()]
            for t in pending:
                t.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
    judgments = [
        j for t in tasks
        if t.done() and not t.cancelled() and t.exception() is None
        for j in [t.result()] if j is not None
    ]
    if not judgments:
        raise JevUnavailable("no JEV request succeeded")
    return judgments
