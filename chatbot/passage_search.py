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

_TRIM = " \t\r\n.?!,;:"
_SCOPE_RE = re.compile(r"^([1-3]?[A-Z]{2,3})\s+(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$")
_BARE_CHAPTER_RE = re.compile(r"^((?:[1-3]\s?)?[A-Za-z][A-Za-z.\s]*?)\.?\s+(\d{1,3})$")
_RANGE_RE = re.compile(
    r"^((?:[1-3]\s?)?[A-Za-z][A-Za-z.\s]*?)\.?\s+(\d{1,3}):(\d{1,3})\s*[-\u2013]\s*(\d{1,3})(?::(\d{1,3}))?$")


def _book_usfm(raw: str) -> Optional[str]:
    return _BOOK_ABBREVIATIONS.get(re.sub(r"[.\s]", "", raw).lower())
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
    rng = _RANGE_RE.match(text.strip(_TRIM))
    if rng and _book_usfm(rng.group(1)):
        book = _USFM_TO_BOOK.get(_book_usfm(rng.group(1)), rng.group(1))
        chapter, start, second = int(rng.group(2)), int(rng.group(3)), int(rng.group(4))
        if rng.group(5) is not None:
            return (f"Please give me a range within a single chapter (up to {MAX_PASSAGE_VERSES} "
                    f"verses) — for example \"{book} {chapter}:{start}-{start + 4}\".")
        if second < start:
            return f"That range runs backwards — did you mean {book} {chapter}:{second}-{start}?"
    ref = _as_reference(text)
    if ref is None:
        bare = _BARE_CHAPTER_RE.match(text.strip(_TRIM))
        if bare:
            usfm = _book_usfm(bare.group(1))
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
