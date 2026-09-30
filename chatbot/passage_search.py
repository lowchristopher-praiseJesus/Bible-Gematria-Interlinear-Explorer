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
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple, Union

from chatbot import passage_embed, passage_tsk
from chatbot.bible_search import list_passage_verses_sync
from chatbot.ollama_client import simple_completion
from chatbot.passage_index import Index
from chatbot.passage_rank import Candidate, rrf_merge
from chatbot.router import (
    _BOOK_ABBREVIATIONS, _USFM_TO_BOOK, _find_flexible_verse_refs, _format_reference,
)

logger = logging.getLogger(__name__)

MAX_QUERY_CHARS = 500
MAX_PASSAGE_VERSES = 25      # same cap as Deep Study
TOP_PER_QUERY = 20
MAX_PHRASINGS = 5

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
