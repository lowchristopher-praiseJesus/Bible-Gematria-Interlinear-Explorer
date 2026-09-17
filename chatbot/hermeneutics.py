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
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from chatbot.bible_search import list_passage_verses_sync
from chatbot.book_context import get_book_context
from chatbot.data.hermeneutic_rulings import render_rulings, rulings_for
from chatbot.data.parables import PARABLES
from chatbot.ollama_client import llm_unconfigured_error, simple_completion, call_ollama_with_context, generate_llm_follow_ups
from chatbot.router import _USFM_TO_BOOK, _resolve_verse_reference, _find_flexible_verse_refs, _format_reference
from chatbot.socratic import _detect_reference
from chatbot.tools import fetch_interlinear, fetch_strongs_local, search_english, fetch_verse_translations
from chatbot.hermeneutics_phases import PHASES, SYNTHESIS_PROMPT

MAX_PASSAGE_VERSES = 25

# A hosted reasoning model can take over a minute on one phase; the shared
# 60s default would turn that into a silently empty phase.
LLM_TIMEOUT_SECONDS = 240.0

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

# Articles and connectives dropped from both the name and the message
# before phrase matching, so "the sheep and goats" still names "The Sheep
# and the Goats".
_STOPWORDS = {"the", "of", "a", "an", "and", "in", "at", "under", "as"}

# Words carried by so many parable names that matching on them alone would
# pick a parable arbitrarily.
_WEAK_TOKENS = _STOPWORDS | {"parable", "story", "lost", "good", "great", "rich", "wise"}

# Names that are also ordinary English or other Scripture ("a thief in the
# night", "faith as a grain of mustard seed", "Abraham had two sons"). These
# are recognised only when the message also says "parable", so a claim that
# happens to use the phrase reaches the classifier instead of silently
# running a parable.
_PARABLE_REQUIRED = {
    "The Sower", "The Leaven", "The Net", "The Talents", "The Hidden Treasure",
    "The Mustard Seed", "The Two Sons", "The Strong Man", "The Empty House",
    "The Growing Seed", "The Thief in the Night", "The Fig Tree as a Sign",
    "New Wine in Old Wineskins", "The Lamp Under a Bushel", "The Two Debtors",
    "The Wedding Feast", "The Great Banquet",
}


def _words(text: str) -> List[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return [_NUMBER_WORDS.get(w, w) for w in words if w not in _STOPWORDS]


def _contains_phrase(haystack: List[str], needle: List[str]) -> bool:
    n = len(needle)
    return any(haystack[i:i + n] == needle for i in range(len(haystack) - n + 1))


def find_parable_reference(text: str) -> Optional[str]:
    """A curated parable named in `text`, as a USFM reference.

    Matches when the parable's full name appears as a phrase, in order
    ("the parable of the ten virgins", "ten virgins", "the 10 virgins",
    "the good samaritan"). When the message also says "parable", every
    distinctive word of the name is enough ("the parable about the sower").
    A name that is also an ordinary phrase needs "parable" to match at all
    (see _PARABLE_REQUIRED), and a lone word shared with ordinary speech
    ("sheep", "fool", "net") never matches by itself.
    """
    message_words = _words(text)
    message_tokens = set(message_words)
    says_parable = bool(message_tokens & {"parable", "parables"})
    best: Optional[Tuple[int, str]] = None
    for parable in PARABLES:
        name_words = _words(parable["name"])
        distinctive = set(name_words) - _WEAK_TOKENS
        if not distinctive:
            continue
        if says_parable:
            matched = distinctive <= message_tokens
        else:
            matched = (
                parable["name"] not in _PARABLE_REQUIRED
                and len(name_words) >= 2
                and _contains_phrase(message_words, name_words)
            )
        if not matched:
            continue
        # Prefer the most specific name when two parables both match
        # (e.g. "The Lost Sheep" vs "The Lost Coin" given both words).
        if best is None or len(distinctive) > best[0]:
            best = (len(distinctive), parable["reference"])
    if best is None:
        return None
    return _resolve_verse_reference(best[1])


# Models write ranges with typographic dashes ("14:13\u201121"); the reference
# parser only knows "-" and would silently drop the end verse.
_DASHES = str.maketrans({"\u2010": "-", "\u2011": "-", "\u2012": "-",
                         "\u2013": "-", "\u2014": "-", "\u2212": "-"})

# Room for a reasoning model's hidden reasoning before its one-line answer.
_CLASSIFIER_MAX_TOKENS = 1024

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
        reply = (await simple_completion(
            _DESCRIPTION_SYSTEM_PROMPT, ask, max_tokens=_CLASSIFIER_MAX_TOKENS,
            timeout=LLM_TIMEOUT_SECONDS,
        ) or "").translate(_DASHES)
        # Models decorate the marker ("`CLAIM: ...`", "**CLAIM:** ...",
        # "Answer: CLAIM: ..."); a claim misread as a description would be
        # run, which is the one outcome this call exists to prevent.
        plain = re.sub(r"[`*\"'“”‘’]", "", reply)
        refs = _find_flexible_verse_refs(plain)
        bearing = _format_reference(*refs[0]) if refs else None
        if re.search(r"\bCLAIM\b", plain, re.IGNORECASE):
            return Resolution(bearing, "claim")
        if refs:
            return Resolution(bearing, "description")
    return Resolution(None, "none")


# "verses 1-5", "vv. 1-5", "just verse 3" — a range with no book, which
# only means something against the chapter the previous turn narrowed.
_RELATIVE_VERSES_RE = re.compile(
    r"^(?:.*\b(?:verses?|vv?\.?|vs\.?)\s*)?(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*[.!?]?\s*$",
    re.IGNORECASE,
)


def named_passage(message: str, scope_chapter: Optional[str] = None) -> Optional[Resolution]:
    """The passage named in *this* message, with no LLM call and no
    session state: a typed reference (ranges kept), a verse range against
    the chapter the last reply asked the user to narrow, or a curated
    parable. The one detector both a fresh run and follow-up routing use,
    so they can never disagree about what the user asked for."""
    text = message.translate(_DASHES)
    refs = _find_flexible_verse_refs(text)
    if refs:
        return Resolution(_format_reference(*refs[0]), "reference")
    # A bare chapter ("Genesis 1") — run() answers it with a narrowing reply.
    chapter = _detect_reference(text)
    if chapter:
        return Resolution(chapter, "reference")
    if scope_chapter:
        relative = _RELATIVE_VERSES_RE.match(text.strip())
        if relative:
            start, end = relative.group(1), relative.group(2)
            ref = f"{scope_chapter}:{start}" + (f"-{end}" if end else "")
            return Resolution(ref, "reference")
    from_table = find_parable_reference(text)
    if from_table:
        return Resolution(from_table, "description")
    return None


async def resolve_passage(
    message: str,
    reference: Optional[str],
    history: Optional[List[Dict[str, str]]] = None,
    scope_chapter: Optional[str] = None,
) -> Resolution:
    """What passage (if any) this turn is about.

    A passage named in *this* message always wins over the one the session
    was previously grounded on — the same precedence socratic.answer()
    uses — so "the ten virgins — actually, Matthew 25:1" runs the verse the
    user corrected themselves to, and "verify this claim from 1 Thess
    4:16 — ..." runs the verse they cited rather than stopping to argue
    about the claim.

    The session reference comes next (the primer's pick, so "go" runs it);
    the LLM classifier only after that. Conversation history is
    deliberately NOT a source: this mode's own replies quote example
    references ("for example Romans 8:1"), and reading those back would run
    a passage nobody chose. `history` is accepted only for call-site
    compatibility.
    """
    named = named_passage(message, scope_chapter)
    if named:
        return named
    if reference:
        return Resolution(reference, "reference")
    return await resolve_description(message)


# Divine titles are detected by Strong's number rather than by asking the
# model to spot them in transliteration.
_DIVINE_TITLES = {
    "H430": ("Elohim", "God as Creator, Judge and Power — known to the world at large"),
    "H3068": ("Yahweh", "the covenant-keeping LORD of unmerited grace and personal redemption"),
}

_SECTION_LABELS = {
    "literary_context": "Literary Context",
    "historical_setting": "Historical Setting",
    "author_and_audience": "Author and Audience",
    "immediate_purpose": "Immediate Purpose",
}


async def passage_text_for(usfm: str, chapter: int, start: int, end: int) -> str:
    """The passage's KJV text, verse-numbered, straight from Complete.db."""
    book_name = _USFM_TO_BOOK.get(usfm.upper(), usfm)
    verses = list_passage_verses_sync(book_name, chapter, start, end)
    return " ".join(f"{v['vnum']} {v['kjv']}" for v in verses if v.get("kjv"))


async def _interlinear_for_range(
    usfm: str, chapter: int, start: int, end: int
) -> List[Dict[str, Any]]:
    rows = []
    for verse in range(start, end + 1):
        row = await fetch_interlinear(usfm, chapter, verse)
        if row:
            rows.append(row)
    return rows


def _key_phrases(passage_text: str) -> List[str]:
    """Up to three multi-word phrases worth cross-referencing. Deliberately
    crude: the phrases only seed english_search, and the model judges what
    comes back."""
    cleaned = re.sub(r"\d+", " ", passage_text)
    phrases = re.findall(r"\b(?:[a-z]{4,}\s+){1,2}[a-z]{4,}\b", cleaned.lower())
    return list(dict.fromkeys(phrases))[:3]


async def build_grounding(
    kind: str, usfm: str, chapter: int, start: int, end: int, passage_text: str
) -> str:
    if kind == "none":
        return ""

    if kind == "book_context":
        ctx = get_book_context(usfm.upper())
        if not ctx:
            return ""
        parts = []
        for key, label in _SECTION_LABELS.items():
            value = ctx.get("sections", {}).get(key)
            if value:
                parts.append(f"{label}: {value}")
        return "\n".join(parts)

    if kind == "lexical":
        rows = await _interlinear_for_range(usfm, chapter, start, end)
        numbers = [w["strongs"] for row in rows for w in row["words"]]
        entries = await fetch_strongs_local(numbers)
        lines = ["STRONG'S DATA FOR THIS PASSAGE:"]
        for number, entry in entries.items():
            translit = (
                entry.get("transliteration1")
                or entry.get("transliteration")
                or ""
            )
            lines.append(
                f"- {number} {translit} "
                f"({entry.get('root', '')}): {entry.get('meaning', '')}"
            )
        for phrase in _key_phrases(passage_text):
            found = await search_english(phrase)
            refs = [r["ref"] for r in found.get("results", [])[:6]]
            if refs:
                lines.append(f"OTHER OCCURRENCES of {phrase!r}: {', '.join(refs)}")
        rulings = render_rulings(rulings_for(passage_text))
        if rulings:
            lines.append("")
            lines.append(rulings)
        return "\n".join(lines)

    if kind == "roots":
        rows = await _interlinear_for_range(usfm, chapter, start, end)
        lines = ["ROOT MEANINGS IN THIS PASSAGE:"]
        seen = set()
        for row in rows:
            for root in row["roots"]:
                key = root["strongs"]
                if key in seen:
                    continue
                seen.add(key)
                lines.append(
                    f"- {key} {root['translit']} ({root['root']}) = {root['english']}"
                )
        titles = [
            f"- {name} ({number}): {gloss}"
            for number, (name, gloss) in _DIVINE_TITLES.items()
            if number in seen
        ]
        if titles:
            lines.append("")
            lines.append("DIVINE TITLES PRESENT IN THIS PASSAGE:")
            lines.extend(titles)
        return "\n".join(lines)

    # "witnesses" needs the model's proposals first, so Phase 4's grounding
    # is the verification pass in verify_witnesses() rather than a prompt
    # block built up front.
    return ""


_WITNESS_LINE_RE = re.compile(r"^WITNESSES:\s*(.+)$", re.MULTILINE | re.IGNORECASE)
_VERDICT_LINE_RE = re.compile(
    r"^VERDICT:\s*(heart|cross|grace)\s*=\s*(pass|fail)[ \t]*[—\-:]?[ \t]*(.*)$",
    re.MULTILINE | re.IGNORECASE,
)
# Note: trailing whitespace after (pass|fail) and separator uses [ \t]* (horizontal only)
# instead of \s* to prevent matching newlines, which would cause an empty reason to
# consume the following VERDICT line as part of this verdict's reason.


def parse_marker(phase_text: str, marker: str) -> Optional[str]:
    """The value of a `MARKER: value` line, lowercased, or None."""
    match = re.search(rf"^{marker}:\s*(.+)$", phase_text, re.MULTILINE | re.IGNORECASE)
    return match.group(1).strip().lower() if match else None


def parse_verdicts(phase_text: str) -> List[Dict[str, Any]]:
    """Phase 8's three verdicts. Prose without markers yields [] — the
    report then shows no badges rather than inventing passes."""
    return [
        {
            "test": test.lower(),
            "passed": outcome.lower() == "pass",
            "reason": reason.strip(),
        }
        for test, outcome, reason in _VERDICT_LINE_RE.findall(phase_text)
    ]


async def verify_witnesses(phase_text: str) -> Tuple[List[Dict[str, Any]], int]:
    """Resolve and fetch each reference Phase 4 proposed.

    Returns (verified citations, count dropped). A reference that doesn't
    resolve, or whose text can't be fetched, is dropped — the model must
    not be able to cite a verse that isn't there.
    """
    match = _WITNESS_LINE_RE.search(phase_text)
    if not match:
        return [], 0

    citations: List[Dict[str, Any]] = []
    dropped = 0
    for raw in match.group(1).split(","):
        candidate = raw.strip()
        if not candidate:
            continue
        resolved = _resolve_verse_reference(candidate)
        if not resolved:
            dropped += 1
            continue
        try:
            translations = await fetch_verse_translations(resolved, languages=["eng"])
        except Exception:
            translations = None
        text = (translations or {}).get("eng-KJV") or next(
            iter((translations or {}).values()), None
        )
        if not text:
            dropped += 1
            continue
        citations.append({"reference": resolved, "text": text, "verified": True})
    return citations, dropped


MIN_WITNESSES = 2


def _final(result: Dict[str, Any]) -> Dict[str, Any]:
    return {"kind": "final", "result": result}


def build_digest(phases: List[Dict[str, Any]], summary: str) -> str:
    """The compact carry-forward a post-report turn answers from, instead
    of re-running the pipeline."""
    lines = [f"{p['index']}. {p['title']}: {p['markdown'][:400]}" for p in phases]
    lines.append(f"Final verified interpretation: {summary}")
    return "\n".join(lines)


async def run(
    reference: Optional[str],
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    scope_chapter: Optional[str] = None,
    resolution: Optional[Resolution] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Run the eight phases, yielding each as it completes, then the final
    assembled report.

    `resolution` is the passage stream() already detected in this message;
    when given it is used as-is rather than re-resolved against the session
    reference.

    Only a completed run hands back `data.reference` (the frontend's session
    reference). The claim redirect, the narrowing reply and the no-text
    reply deliberately do not: persisting a passage the user never chose
    would make their next, unrelated message run it."""
    llm_error = llm_unconfigured_error()
    if llm_error:
        yield _final({
            "type": "error", "message": llm_error, "data": None,
            "route": "hermeneutics → LLM unconfigured",
        })
        return

    if resolution is None:
        resolution = await resolve_passage(message, reference, history, scope_chapter)
    resolved = resolution.reference
    was_described = resolution.source == "description"

    # A claim is not a passage. Running the eight phases on whatever single
    # verse an LLM associates with a proposition answers a question the user
    # did not ask, while looking exactly as authoritative as a real run —
    # the worst output this mode can produce. Say what it is and offer the
    # passage that bears on it instead.
    if resolution.source == "claim":
        offer = (
            f" The passage that bears on it most directly is **{resolved}** — "
            "shall I run that?"
            if resolved
            else " Which passage would you like me to run on it?"
        )
        yield _final({
            "type": "chat",
            "message": (
                "That's a claim to test rather than a passage to interpret, and I run "
                "the eight phases over one passage at a time." + offer
            ),
            "data": None,
            "route": "hermeneutics → claim, not a passage",
            "follow_up_questions": ([f"Run {resolved}"] if resolved else []),
        })
        return

    if not resolved:
        yield _final({
            "type": "chat",
            "message": "Which passage would you like me to run? Give me a verse or a "
                       "short range — for example \"Romans 8:1\" or "
                       "\"1 Thessalonians 4:15-18\".",
            "data": None,
            "route": "hermeneutics → no passage",
        })
        return

    try:
        usfm, chapter, start, end = parse_scope(resolved)
    except ScopeError as exc:
        # The chapter (not a reference) comes back so "verses 1-5" next turn
        # can be read against it — see named_passage().
        chapter_part = resolved.split(":", 1)[0].strip()
        yield _final({
            "type": "chat", "message": exc.message,
            "data": ({"scopeChapter": chapter_part}
                     if re.match(r"^[1-3]?[A-Z]{2,3}\s+\d{1,3}$", chapter_part) else None),
            "route": "hermeneutics → out of scope",
        })
        return

    # Nothing downstream checks that the passage exists: an LLM-resolved
    # description, or a typo'd reference, can name a chapter or verse range
    # Complete.db has no text for, and every phase would then run on an
    # empty string and produce a confident, wholly ungrounded report. Phase
    # 4 already refuses to cite a verse it cannot fetch; the passage the
    # whole run is about gets the same guarantee. Checked BEFORE the
    # echo-back, so an unusable resolution never announces itself as though
    # the run were starting.
    passage_text = await passage_text_for(usfm, chapter, start, end)
    if not passage_text.strip():
        yield _final({
            "type": "chat",
            "message": (
                f"I couldn't find any text for **{resolved}**"
                + (" — I may have read your description wrong." if was_described else ".")
                + " Could you give me the reference you have in mind?"
            ),
            "data": None,
            "route": "hermeneutics → passage has no text",
        })
        return

    # A passage the user described rather than cited is echoed back before
    # any phase runs, so a wrong reading is visible immediately instead of
    # ninety seconds later with the report. Index 0 keeps this on the
    # existing `phase` event rather than inventing a second event type; the
    # frontend renders index 0 as a plain notice, not a collapsible phase.
    if was_described:
        yield {"kind": "phase", "phase": {
            "index": 0,
            "title": "Passage",
            "status": "done",
            "markdown": f"Reading that as **{resolved}** — running it now.",
        }}

    completed: List[Dict[str, Any]] = []

    for spec in PHASES:
        phase: Dict[str, Any] = {
            "index": spec.index, "title": spec.title, "status": "done", "markdown": "",
        }
        try:
            grounding = await build_grounding(
                spec.grounding, usfm, chapter, start, end, passage_text
            )
            prior = "\n\n".join(
                f"PHASE {p['index']} ({p['title']}):\n{p['markdown']}" for p in completed
            )
            user_prompt = (
                f"PASSAGE: {resolved}\n\nTEXT (KJV): {passage_text}\n\n"
                + (f"{grounding}\n\n" if grounding else "")
                + (f"FINDINGS SO FAR:\n{prior}\n\n" if prior else "")
                + "Carry out your phase now."
            )
            phase["markdown"] = await simple_completion(
                spec.system_prompt, user_prompt, max_tokens=spec.max_tokens,
                timeout=LLM_TIMEOUT_SECONDS,
            )
            if not phase["markdown"].strip():
                raise RuntimeError("the model returned no answer (timeout or provider error)")
            if spec.index == 1:
                phase["audience"] = parse_marker(phase["markdown"], "AUDIENCE")
            if spec.index == 3:
                phase["speaker"] = parse_marker(phase["markdown"], "SPEAKER")
            if spec.index == 4:
                citations, dropped = await verify_witnesses(phase["markdown"])
                phase["citations"] = citations
                if len(citations) < MIN_WITNESSES:
                    phase["markdown"] += (
                        "\n\n_Note: fewer than two proposed witnesses could be "
                        f"verified against the text ({dropped} dropped as unresolvable). "
                        "Weigh this interpretation accordingly._"
                    )
                elif dropped:
                    phase["markdown"] += (
                        f"\n\n_{dropped} proposed reference(s) did not resolve and were dropped._"
                    )
            if spec.index == 8:
                phase["verdicts"] = parse_verdicts(phase["markdown"])
        except Exception as exc:  # a slow provider must not discard the run
            phase["status"] = "error"
            phase["markdown"] = f"This phase could not be completed: {type(exc).__name__}: {exc}"

        completed.append(phase)
        yield {"kind": "phase", "phase": phase}

    missing = [p["index"] for p in completed if p["status"] == "error"]
    findings = "\n\n".join(
        f"PHASE {p['index']} ({p['title']}):\n{p['markdown']}"
        for p in completed if p["status"] == "done"
    )
    try:
        summary = await simple_completion(
            SYNTHESIS_PROMPT,
            f"PASSAGE: {resolved}\n\nTEXT (KJV): {passage_text}\n\nPHASE FINDINGS:\n{findings}",
            max_tokens=900,
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        summary = f"The summary could not be generated: {type(exc).__name__}: {exc}"
    if missing:
        summary += (
            "\n\n_Phases "
            + ", ".join(str(i) for i in missing)
            + " could not be completed, so this summary rests on the remainder._"
        )

    verdicts = next((p.get("verdicts") for p in completed if p["index"] == 8), None) or []
    has_failed = any(not v["passed"] for v in verdicts)

    yield _final({
        "type": "chat",
        "message": summary,
        "data": {
            "reference": resolved,
            "hasFailedVerdict": has_failed,
            "runDigest": build_digest(completed, summary),
        },
        "route": f"hermeneutics → {len(completed)} phases",
        "artifacts": [{
            "type": "hermeneutics_report",
            "label": "Open full report ▸",
            "params": {"reference": resolved, "phases": completed, "summary": summary},
        }],
        "follow_up_questions": [
            "Which phase is doing the most work here?",
            "What would change if this were addressed to the Church instead?",
        ],
    })


FOLLOW_UP_SYSTEM_PROMPT = """You are a Biblical Hermeneutics Engine answering a follow-up question about a passage you have already analysed through an eight-phase methodology. The findings of that analysis are given below.

Answer from those findings. Be concise — a short paragraph. Do not re-run the phases, do not re-list them, and do not introduce a verse reference the analysis did not establish."""


async def stream(
    reference: Optional[str],
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    run_digest: Optional[str] = None,
    scope_chapter: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Phase events + final for a fresh run; a single final for a
    follow-up answered from the digest.

    After a completed run, a turn is a follow-up unless it names a
    different passage. "Names" is decided by named_passage() — the same
    detector run() resolves with — and the detected passage is handed to
    run() explicitly, so "now do the prodigal son" runs the prodigal son
    rather than re-resolving to the session's previous passage. The LLM
    classifier is deliberately NOT consulted here: it would cost a
    completion on every follow-up turn, and a description vague enough to
    need it is more likely a question about the passage in hand.
    """
    named = named_passage(message, scope_chapter)
    if run_digest and (named is None or named.reference == reference):
        result = await call_ollama_with_context(
            message,
            research_data=f"PASSAGE: {reference}\n\nANALYSIS FINDINGS:\n{run_digest}",
            conversation_history=history,
            system_prompt=FOLLOW_UP_SYSTEM_PROMPT,
        )
        result["route"] = "hermeneutics → follow-up from digest"
        result.setdefault("data", {"reference": reference})
        if result.get("type") == "chat" and result.get("message"):
            follow_ups = await generate_llm_follow_ups(message, result["message"])
            if follow_ups:
                result["follow_up_questions"] = follow_ups
        yield _final(result)
        return

    async for event in run(reference, message, history, scope_chapter=scope_chapter, resolution=named):
        yield event


async def answer(
    reference: Optional[str],
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    run_digest: Optional[str] = None,
    scope_chapter: Optional[str] = None,
) -> Dict[str, Any]:
    """Buffered entry point: drives the same pipeline and returns only the
    final result, so POST /chat behaves identically to /chat/stream."""
    result: Dict[str, Any] = {}
    async for event in stream(reference, message, history, run_digest, scope_chapter):
        if event["kind"] == "final":
            result = event["result"]
    return result
