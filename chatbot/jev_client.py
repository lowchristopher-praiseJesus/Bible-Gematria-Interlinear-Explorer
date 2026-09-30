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
