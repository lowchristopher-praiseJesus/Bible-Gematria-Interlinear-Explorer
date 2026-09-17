"""Devotional mode: turn a seed verse into the prompt for a long-form
devotional, and stream that devotional from the configured LLM.

The seed verse comes from one of three places:
  * an explicit reference the user typed ("John 3:16", "Psalm 23:1-3");
  * a theme the user typed ("facing anxiety") → one short LLM pick;
  * the "pick one for me" path (no reference, no theme) → a deterministic
    draw from the per-browser rotation deck (chatbot.devotional_rotation
    .pick_from_rotation, fed the client's (seed, cursor)); the LLM is only
    used for themed picks.
The rotation path also carries a fetch-failure fallback chain: an
unresolvable pool ref falls through to the next card in the deck, then to
pick_verse_for_theme(None), which itself lands on FALLBACK_VERSES. Themed
and typed-reference picks have no such fallback — a DevotionalError there
propagates to the caller unchanged.
"""

import logging
import random
import re
from typing import AsyncIterator, Dict, Optional, Tuple

from chatbot.router import (
    _find_flexible_verse_refs,
    _format_reference,
    _resolve_verse_reference,
)
from chatbot.tools import fetch_verse_translations
from chatbot.ollama_client import (
    llm_unconfigured_error,
    simple_completion,
    stream_devotional_completion,
)
from chatbot.devotional_rotation import pick_from_rotation
from chatbot import devotional_of_day

logger = logging.getLogger(__name__)


class DevotionalError(Exception):
    """Raised when a seed verse can't be resolved to any verse text."""


FALLBACK_VERSES = ["JHN 14:27", "PSA 23:1", "ISA 41:10", "ROM 8:28", "PHP 4:6-7", "MAT 11:28"]

DEVOTIONAL_SYSTEM_PROMPT = "You are an experienced Christian devotional writer."

_PICK_SYSTEM_PROMPT = (
    "You suggest a single Bible verse for a devotional. Reply with only one "
    "verse reference and nothing else."
)

# The devotional-writer brief. `[INSERT VERSE AND REFERENCE]` is replaced by
# `build_devotional_prompt` with the seed verse block.
DEVOTIONAL_PROMPT_TEMPLATE = """You are an experienced Christian devotional writer. Write a deeply personal, emotionally powerful devotional based on the Bible verse provided below.

BIBLE VERSE:
[INSERT VERSE AND REFERENCE]

Your devotional should have a warm, conversational, pastoral voice. It should feel as though a compassionate pastor is sitting across from the reader, talking directly to them about something they may be experiencing in their own life.

STYLE AND VOICE:

- Begin with a relatable question, situation, struggle, or everyday experience that immediately connects the biblical truth to something the reader may be feeling.
- Move naturally from that modern-day experience into the biblical passage or story surrounding the verse.
- Retell the relevant biblical scene in a vivid but conversational way. Help the reader picture what was happening, what the people involved may have been feeling, and what may have been going through their minds.
- Do not make the writing sound academic, theological, or like a Bible commentary. Keep it accessible, intimate, and spoken.
- Use phrases such as "Think about it," "Maybe today you're..." or "Can I tell you this?" naturally when appropriate, but do not overuse them.
- Frequently connect the biblical situation back to the reader's own life.
- Use rhetorical questions to create reflection and emotional connection.
- Explore the human emotions in the passage: fear, grief, disappointment, loneliness, hope, regret, uncertainty, longing, joy, faith, or surrender, depending on the verse.
- When appropriate, gently speculate about what a biblical character might have been thinking or feeling, while clearly presenting it as possibility rather than fact.
- Build the devotional gradually. Start with an ordinary human struggle, reveal the biblical truth, then show how that truth speaks directly into the reader's situation.
- Make the central spiritual truth clear and memorable.
- Avoid merely explaining what the verse means. Show the reader why it matters to their life right now.
- Include practical ways the reader can respond to the truth: what they can surrender, believe, change, pursue, remember, or place in God's hands.
- Keep Jesus at the center whenever the passage allows for it. Point the reader toward His character, His presence, His promises, His finished work, or His invitation.
- End with a strong emotional resolution. The final paragraphs should feel like the devotional has arrived somewhere meaningful rather than simply stopping.
- The ending should leave the reader with hope, faith, comfort, conviction, or renewed trust in God.
- Whenever possible, echo the central image or idea from the opening so the devotional feels complete and intentional.

PACING AND STRUCTURE:

Use a flowing, story-driven structure rather than headings or numbered sections.

A helpful progression is:

1. Start with a question or familiar human experience.
2. Introduce the biblical passage naturally.
3. Tell or unpack the biblical scene.
4. Highlight the surprising or beautiful truth in the verse.
5. Connect that truth to situations the reader may be facing today.
6. Offer a deeper spiritual perspective that the reader may not have considered.
7. Give the reader a practical response.
8. Bring the focus back to Jesus.
9. Finish with a memorable, emotionally powerful statement of hope or faith.

WRITING CHARACTERISTICS:

- Write in natural spoken English.
- Use a mixture of short, punchy sentences and longer reflective sentences.
- Let important sentences stand alone for emphasis.
- Use repetition sparingly when it creates emotional weight.
- Prefer concrete images and everyday experiences over abstract theological language.
- Make the devotional feel personal without assuming specific details about the reader.
- Write with warmth and sincerity rather than hype.
- Be emotionally powerful without becoming melodramatic.
- Be encouraging without making promises that Scripture does not make.
- Do not force a lesson that isn't genuinely supported by the passage.
- Stay faithful to the biblical context.
- If the verse has a difficult or surprising meaning, acknowledge that honestly before explaining its hope or significance.
- Avoid clichés, excessive Christian jargon, generic motivational language, and overly polished corporate-sounding prose.
- Do not sound like a textbook, sermon outline, Bible study worksheet, or theological essay.

LENGTH:

Write approximately 300-500 words.

MOST IMPORTANT:

The reader should finish feeling as though Scripture has spoken directly into something they are carrying today.

The devotional should move from:
"Here is something happening in the Bible"
to
"Here is what this means for you"
to
"Here is what Jesus is inviting you to believe, surrender, or receive."

Do not simply summarize the verse. Turn the biblical truth into a personal encounter with God.

Now write the devotional based on the verse provided above."""


# "PSA 23:1", "1CO 13:4-7", "SNG 2:1" — USFM book code, chapter:verse, optional -end.
_USFM_REF_RE = re.compile(r"^([1-3]?[A-Z]{2,3})\s+(\d+):(\d+)(?:-(\d+))?$")

# Fetching a whole range one verse at a time is a handful of calls; guard
# against a pathological span ("Genesis 1:1-999") fanning out.
_MAX_RANGE_SPAN = 20


def _kjv_text(translations: Dict[str, str]) -> str:
    """Pull the KJV (or best-available) plain text out of a translations dict."""
    if not translations:
        return ""
    for code, text in translations.items():
        if code.endswith("-KJV") or code == "eng":
            return text
    return next(iter(translations.values()), "")


def build_devotional_prompt(reference: str, verse_text: str) -> str:
    verse_block = f"{reference} (KJV)\n{verse_text}"
    return DEVOTIONAL_PROMPT_TEMPLATE.replace("[INSERT VERSE AND REFERENCE]", verse_block)


async def pick_verse_for_theme(theme: Optional[str]) -> str:
    """One short LLM call → a USFM reference. One retry on an unparseable
    reply, then a random FALLBACK_VERSES pick. Never returns empty."""
    if llm_unconfigured_error():
        return random.choice(FALLBACK_VERSES)

    ask = (
        f"Suggest one Bible verse for a devotional on the theme: '{theme}'."
        if theme
        else "Suggest one well-known Bible verse for a devotional."
    ) + " Reply with only the reference, e.g. `John 14:27`. Choose a pastorally rich verse; vary your choice."

    for _ in range(2):
        reply = await simple_completion(_PICK_SYSTEM_PROMPT, ask, max_tokens=64)
        refs = _find_flexible_verse_refs(reply or "")
        if refs:
            return _format_reference(*refs[0])
    return random.choice(FALLBACK_VERSES)


async def _range_text(usfm: str, chapter: int, start: int, end: int) -> str:
    """KJV text for a verse range, fetched one verse at a time (every caller
    of fetch_verse_translations in this codebase passes it a USFM ref, so no
    book-name lookup is needed) and space-joined. A verse that comes back
    empty *or* raises (fetch_verse_translations → the biblehub fetcher can
    raise VerseFetchError on a bad reference / HTTP error / no translations)
    is skipped, so one bad verse in a long span like `Psalm 23:1-99` yields
    the verses that did resolve rather than aborting the whole range."""
    last = min(end, start + _MAX_RANGE_SPAN)
    parts = []
    for v in range(start, last + 1):
        try:
            got = _kjv_text(
                await fetch_verse_translations(f"{usfm} {chapter}:{v}", languages=["eng"])
            )
        except Exception:  # noqa: BLE001 — one bad verse must not kill the range
            continue
        if got:
            parts.append(got)
    return " ".join(parts)


async def _resolve_ref_to_text(
    ref: str,
) -> Optional[Tuple[str, Dict[str, str]]]:
    """Fetch verse text for a single USFM ref or a verse range.

    Returns (possibly-clamped reference, translations dict), or None when no
    text could be fetched. It never raises for a fetch failure — the
    non-rotation callers turn a None into DevotionalError themselves (so
    their behaviour is unchanged), while the rotation path uses the None to
    try the next candidate ref in order.

    For a range the returned dict is {"eng-KJV": joined text}; for a single
    verse it's the real multi-translation payload. A range whose end exceeds
    _MAX_RANGE_SPAN is clamped and the returned reference names that span."""
    m = _USFM_REF_RE.match(ref)
    is_range = bool(m and m.group(4) and int(m.group(4)) != int(m.group(3)))

    if is_range:
        usfm, chapter = m.group(1), int(m.group(2))
        start, end = int(m.group(3)), int(m.group(4))
        # A span capped at _MAX_RANGE_SPAN only fetches start..start+cap, so
        # the reference the caller shows (the VerseBubble header and the
        # devotional prompt) must name that same span — not the user's
        # oversized end, which would silently disagree with the text.
        if end > start + _MAX_RANGE_SPAN:
            end = start + _MAX_RANGE_SPAN
            ref = f"{usfm} {chapter}:{start}-{end}"
        text = await _range_text(usfm, chapter, start, end)
        if not text:
            return None
        return ref, {"eng-KJV": text}

    # fetch_verse_translations → the biblehub fetcher raises VerseFetchError
    # on timeout / HTTP error / parse failure / a reference that yields no
    # translations (common when an LLM-cited reference is slightly off).
    # Any such failure — like an empty dict or blank KJV text — means the
    # seed verse is unresolved; the caller decides whether that's fatal.
    try:
        translations = await fetch_verse_translations(ref, languages=["eng"])
    except Exception:  # noqa: BLE001 — matches router.py's broad style
        return None
    if not translations or not _kjv_text(translations):
        return None
    return ref, translations


async def _resolve_rotation_seed_verse(
    seed: int, cursor: int
) -> Tuple[str, Dict[str, str]]:
    """The "Pick one for me" rotation path, with a fetch-failure safety net.

    DEVOTIONAL_POOL was validated against Complete.db, but the runtime
    fetches verse text from a different corpus (chatbot.tools →
    MYBIBLETOOLBOX_PATH / the biblehub fetcher), so a pool ref that corpus
    can't serve must not be a hard error. Try this card; if it yields no
    text try the next card in the deck (cursor + 1) once; if that also
    fails fall back to pick_verse_for_theme(None), which has FALLBACK_VERSES
    behind it and is always resolvable. Only this path gets the retry —
    typed-reference and theme picks still raise DevotionalError on failure."""
    for cur in (cursor, cursor + 1):
        resolved = await _resolve_ref_to_text(pick_from_rotation(seed, cur))
        if resolved is not None:
            return resolved
    ref = await pick_verse_for_theme(None)
    resolved = await _resolve_ref_to_text(ref)
    if resolved is None:
        raise DevotionalError(f"No verse text for {ref}")
    return resolved


def _is_rotation_pick(raw: Optional[str], source: str, rotation: Optional[Tuple[int, int]]) -> bool:
    """True for "Pick one for me": no typed verse reference, no typed
    theme, and the client supplied a rotation (seed, cursor) slot. Shared
    by resolve_seed_verse (which path to resolve) and stream_devotional
    (whether devotional-of-the-day applies)."""
    if source == "user" and raw and _resolve_verse_reference(raw) is not None:
        return False
    theme = raw.strip() if (raw and raw.strip()) else None
    return theme is None and rotation is not None


async def resolve_seed_verse(
    raw: Optional[str],
    source: str,
    rotation: Optional[Tuple[int, int]] = None,
) -> Tuple[str, Dict[str, str]]:
    """(usfm_reference, translations_dict). For a single verse the dict is the
    real multi-translation payload; for a range it's {"eng-KJV": joined text}.
    Raises DevotionalError when no verse text can be fetched.

    `rotation` is the client's (seed, cursor) for the "Pick one for me"
    path: when there's no user reference and no theme, the seed verse comes
    from pick_from_rotation() instead of a stateless LLM call (which used to
    return Psalm 23:1 almost every time). That path also carries a fetch
    fallback (next card → theme pick → FALLBACK_VERSES) so an unresolvable
    pool entry isn't fatal. Themed and typed-reference picks ignore
    `rotation` and still propagate a DevotionalError unchanged."""
    if _is_rotation_pick(raw, source, rotation):
        return await _resolve_rotation_seed_verse(*rotation)

    ref = _resolve_verse_reference(raw) if (source == "user" and raw) else None
    if ref is None:
        theme = raw.strip() if (raw and raw.strip()) else None
        ref = await pick_verse_for_theme(theme)

    resolved = await _resolve_ref_to_text(ref)
    if resolved is None:
        raise DevotionalError(f"No verse text for {ref}")
    return resolved


async def stream_devotional(
    raw: Optional[str],
    source: str,
    page_context: Optional[str] = None,
    rotation: Optional[Tuple[int, int]] = None,
) -> AsyncIterator[Dict[str, object]]:
    """Resolve the seed verse, then stream the devotional. Yields
    {"type": "stream", "chunk": str} while generating, then one terminal
    event: {"type": "error", "message": str} on an LLM stream failure, or
    {"type": "done", "text", "reference", "translations", "from_daily_cache"}
    on success. A DevotionalError from seed-verse resolution propagates to
    the caller.

    For a rotation ("Pick one for me") request, the first successful
    generation each GMT+8 day is captured as that day's shared devotional
    (chatbot.devotional_of_day); every later rotation request that same day
    short-circuits straight to that cached text with no verse resolution or
    LLM call, and yields from_daily_cache=True. Typed-reference and theme
    requests never read or write that cache and always generate fresh."""
    is_rotation_pick = _is_rotation_pick(raw, source, rotation)

    if is_rotation_pick:
        cached = None
        try:
            cached = devotional_of_day.get_today(devotional_of_day.get_default_db())
        except Exception:  # noqa: BLE001 — the daily cache must fail open, not block "Pick one for me"
            logger.warning("devotional_of_day.get_today failed; falling back to fresh generation", exc_info=True)
        if cached is not None:
            yield {
                "type": "done",
                "text": cached["text"],
                "reference": cached["reference"],
                "translations": cached["translations"],
                "from_daily_cache": True,
            }
            return

    reference, translations = await resolve_seed_verse(raw, source, rotation)
    verse_text = _kjv_text(translations)
    prompt = build_devotional_prompt(reference, verse_text)

    full = ""
    async for ev in stream_devotional_completion(DEVOTIONAL_SYSTEM_PROMPT, prompt, max_tokens=1800):
        if ev["type"] == "stream":
            full += ev["chunk"]
            yield {"type": "stream", "chunk": ev["chunk"]}
        elif ev["type"] == "error":
            yield {"type": "error", "message": ev["message"]}
            return

    if is_rotation_pick and full.strip():
        try:
            devotional_of_day.capture_if_absent(
                devotional_of_day.get_default_db(),
                reference=reference,
                translations=translations,
                text=full,
            )
        except Exception:  # noqa: BLE001 — capture failure must never block the stream's "done" event
            logger.warning("devotional_of_day.capture_if_absent failed; this generation was not captured", exc_info=True)

    yield {
        "type": "done",
        "text": full,
        "reference": reference,
        "translations": translations,
        "from_daily_cache": False,
    }
