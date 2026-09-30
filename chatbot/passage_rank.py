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
