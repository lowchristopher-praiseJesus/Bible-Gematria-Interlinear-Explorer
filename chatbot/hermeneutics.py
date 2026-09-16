"""Hermeneutics mode: run a passage through a fixed 8-phase interpretive
methodology, one LLM call per phase, emitting each phase as it completes.

Grounding is real for Phases 2, 4 and 7 (interlinear words, Strong's
entries, English full-text search, witness verification against
Complete.db); the remaining phases run on model knowledge over the passage
and the phases already completed. See
docs/superpowers/specs/2026-09-16-hermeneutics-mode-design.md.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

from chatbot.bible_search import list_passage_verses_sync
from chatbot.router import _USFM_TO_BOOK, _resolve_verse_reference
from chatbot.socratic import _detect_reference, _reference_from_history

MAX_PASSAGE_VERSES = 25

_SCOPE_RE = re.compile(r"^([1-3]?[A-Z]{2,3})\s+(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$")


class ScopeError(Exception):
    """A passage too large (or too vague) to run. `.message` is the
    user-facing narrowing reply, not a diagnostic."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _chapter_length(usfm: str, chapter: int) -> Optional[int]:
    book_name = _USFM_TO_BOOK.get(usfm.upper())
    if not book_name:
        return None
    return len(list_passage_verses_sync(book_name, chapter)) or None


def parse_scope(reference: str) -> Tuple[str, int, int, int]:
    """(usfm, chapter, start_verse, end_verse) for a runnable passage.

    Raises ScopeError, carrying the reply to send the user, for a bare
    chapter or a range longer than MAX_PASSAGE_VERSES.
    """
    match = _SCOPE_RE.match(reference.strip().upper())
    if not match:
        # A bare chapter ("GEN 1") is the common case here.
        bare = re.match(r"^([1-3]?[A-Z]{2,3})\s+(\d{1,3})$", reference.strip().upper())
        if bare:
            usfm, chapter = bare.group(1), int(bare.group(2))
            length = _chapter_length(usfm, chapter)
            book = _USFM_TO_BOOK.get(usfm, usfm)
            if length:
                raise ScopeError(
                    f"That's {book} {chapter} — {length} verses. A full run goes deep on "
                    "every word, so it works best on the passage that carries the point. "
                    "Which part would you like me to take?"
                )
            raise ScopeError(
                f"I need a verse or a short range to run — which part of {book} {chapter} "
                "would you like me to take?"
            )
        raise ScopeError(
            "Give me a verse or a short range to run — for example "
            "\"Romans 8:1\" or \"1 Thessalonians 4:15-18\"."
        )

    usfm, chapter = match.group(1), int(match.group(2))
    start = int(match.group(3))
    end = int(match.group(4)) if match.group(4) else start
    if end < start:
        start, end = end, start
    span = end - start + 1
    if span > MAX_PASSAGE_VERSES:
        book = _USFM_TO_BOOK.get(usfm, usfm)
        raise ScopeError(
            f"That's {span} verses. A full run goes deep on every word, so I cap it at "
            f"{MAX_PASSAGE_VERSES} — which part of {book} {chapter} carries the point "
            "you're after?"
        )
    return usfm, chapter, start, end


async def resolve_passage(
    message: str,
    reference: Optional[str],
    history: Optional[List[Dict[str, str]]],
) -> Optional[str]:
    """The passage this turn is about.

    A passage named in *this* message always wins over the one the session
    was previously grounded on — the same precedence socratic.answer() uses.
    """
    return (
        _detect_reference(message)
        or reference
        or _reference_from_history(history or [])
    )
