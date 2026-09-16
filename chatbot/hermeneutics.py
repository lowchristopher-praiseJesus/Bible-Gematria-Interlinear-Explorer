"""Hermeneutics mode: run a passage through a fixed 8-phase interpretive
methodology, one LLM call per phase, emitting each phase as it completes.

Grounding is real for Phases 2, 4 and 7 (interlinear words, Strong's
entries, English full-text search, witness verification against
Complete.db); the remaining phases run on model knowledge over the passage
and the phases already completed. See
docs/superpowers/specs/2026-09-16-hermeneutics-mode-design.md.
"""

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from chatbot.bible_search import list_passage_verses_sync
from chatbot.data.parables import PARABLES
from chatbot.ollama_client import simple_completion
from chatbot.router import _USFM_TO_BOOK, _resolve_verse_reference, _find_flexible_verse_refs, _format_reference
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


# Parable names use number words ("Ten Virgins", "Two Sons") while users
# often type digits.
_NUMBER_WORDS = {
    "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
}

# Words carried by so many parable names that matching on them alone would
# pick a parable arbitrarily.
_WEAK_TOKENS = {"the", "of", "a", "and", "parable", "story", "lost", "good", "great", "rich", "wise"}


def _tokens(text: str) -> set:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {_NUMBER_WORDS.get(w, w) for w in words}


def find_parable_reference(text: str) -> Optional[str]:
    """A curated parable named in `text`, as a USFM reference.

    Matches when every distinctive word of the parable's name appears in
    the message, so "the parable of the ten virgins", "ten virgins" and
    "the 10 virgins" all hit. A name whose only tokens are weak ones
    cannot match at all.
    """
    message_tokens = _tokens(text)
    best: Optional[Tuple[int, str]] = None
    for parable in PARABLES:
        name_tokens = _tokens(parable["name"])
        distinctive = name_tokens - _WEAK_TOKENS
        if not distinctive or not distinctive <= message_tokens:
            continue
        # Prefer the most specific name when two parables both match
        # (e.g. "The Lost Sheep" vs "The Lost Coin" given both words).
        if best is None or len(distinctive) > best[0]:
            best = (len(distinctive), parable["reference"])
    if best is None:
        return None
    return _resolve_verse_reference(best[1])


_DESCRIPTION_SYSTEM_PROMPT = (
    "You identify which Bible passage a description refers to. Reply with only "
    "the reference and nothing else."
)


@dataclass(frozen=True)
class Resolution:
    """What this turn's message turned out to be about.

    `source` drives what happens next:
      reference   — the user cited it; run, no echo needed
      description — resolved from a description; run, echoed back first
      claim       — a proposition to test, not a passage; offer the passage
                    that bears on it and run nothing
      none        — nothing found; ask
    """
    reference: Optional[str]
    source: str


async def resolve_description(text: str) -> Resolution:
    """Classify a message that carries no explicit reference.

    The curated parable table answers first (no LLM call). Anything else
    gets one short completion plus one retry, and that same call also
    distinguishes a passage description from a doctrinal *claim* — the
    classification is free, since the call is being made either way.

    Unlike devotional.pick_verse_for_theme(), a failure returns nothing
    rather than a random verse: an eight-phase analysis of a passage the
    user did not ask about is worse than asking them which passage they
    meant.
    """
    from_table = find_parable_reference(text)
    if from_table:
        return Resolution(from_table, "description")

    ask = (
        f"Input: '{text}'\n\n"
        "If this DESCRIBES a Bible passage, reply with only the reference, "
        "e.g. `Ephesians 6:10-18`.\n"
        "If this asserts a doctrinal CLAIM to be tested rather than naming a "
        "passage, reply `CLAIM: <reference of the passage that bears on it "
        "most directly>`, or just `CLAIM` if no single passage does.\n"
        "If you cannot tell, reply `NONE`."
    )
    for _ in range(2):
        reply = (await simple_completion(_DESCRIPTION_SYSTEM_PROMPT, ask, max_tokens=64)) or ""
        refs = _find_flexible_verse_refs(reply)
        bearing = _format_reference(*refs[0]) if refs else None
        if reply.strip().upper().startswith("CLAIM"):
            return Resolution(bearing, "claim")
        if refs:
            return Resolution(bearing, "description")
    return Resolution(None, "none")


async def resolve_passage(
    message: str,
    reference: Optional[str],
    history: Optional[List[Dict[str, str]]],
) -> Resolution:
    """What passage (if any) this turn is about.

    A passage named in *this* message always wins over the one the session
    was previously grounded on — the same precedence socratic.answer()
    uses. Classification is only reached when no explicit reference is
    available anywhere, so "the ten virgins — actually, Matthew 25:1" runs
    the verse the user corrected themselves to, and "verify this claim from
    1 Thess 4:16 — ..." runs the verse they cited rather than stopping to
    argue about the claim.
    """
    explicit = _detect_reference(message)
    if not explicit:
        # Try flexible matching for abbreviated book names like "1 Thess"
        refs = _find_flexible_verse_refs(message)
        if refs:
            explicit = _format_reference(*refs[0])
    if not explicit:
        explicit = reference
    if not explicit:
        explicit = _reference_from_history(history or [])
    if explicit:
        return Resolution(explicit, "reference")
    return await resolve_description(message)
