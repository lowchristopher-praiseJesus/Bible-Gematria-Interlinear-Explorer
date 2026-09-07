"""Devotional mode: turn a seed verse into the prompt for a long-form
devotional, and stream that devotional from the configured LLM.

The seed verse comes from one of three places:
  * an explicit reference the user typed ("John 3:16", "Psalm 23:1-3");
  * a theme the user typed ("facing anxiety") → one short LLM pick;
  * the "pick one for me" path → the same LLM pick with no theme.
Anything the LLM pick can't produce falls back to FALLBACK_VERSES.
"""

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

Write approximately 1,200-1,600 words.

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
    book-name lookup is needed) and space-joined."""
    last = min(end, start + _MAX_RANGE_SPAN)
    parts = []
    for v in range(start, last + 1):
        got = _kjv_text(await fetch_verse_translations(f"{usfm} {chapter}:{v}", languages=["eng"]))
        if got:
            parts.append(got)
    return " ".join(parts)


async def resolve_seed_verse(raw: Optional[str], source: str) -> Tuple[str, Dict[str, str]]:
    """(usfm_reference, translations_dict). For a single verse the dict is the
    real multi-translation payload; for a range it's {"eng-KJV": joined text}.
    Raises DevotionalError when no verse text can be fetched."""
    ref = _resolve_verse_reference(raw) if (source == "user" and raw) else None
    if ref is None:
        theme = raw.strip() if (raw and raw.strip()) else None
        ref = await pick_verse_for_theme(theme)

    m = _USFM_REF_RE.match(ref)
    is_range = bool(m and m.group(4) and int(m.group(4)) != int(m.group(3)))

    if is_range:
        text = await _range_text(m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)))
        if not text:
            raise DevotionalError(f"No verse text for {ref}")
        return ref, {"eng-KJV": text}

    translations = await fetch_verse_translations(ref, languages=["eng"])
    if not translations:
        raise DevotionalError(f"No verse text for {ref}")
    return ref, translations


async def stream_devotional(
    raw: Optional[str], source: str, page_context: Optional[str] = None
) -> AsyncIterator[Dict[str, object]]:
    """Resolve the seed verse, then stream the devotional. Yields
    {"type": "stream", "chunk": str} while generating, then one terminal
    event: {"type": "error", "message": str} on an LLM stream failure, or
    {"type": "done", "text", "reference", "translations"} on success.
    A DevotionalError from seed-verse resolution propagates to the caller."""
    reference, translations = await resolve_seed_verse(raw, source)
    verse_text = _kjv_text(translations)
    prompt = build_devotional_prompt(reference, verse_text)

    full = ""
    async for ev in stream_devotional_completion(DEVOTIONAL_SYSTEM_PROMPT, prompt, max_tokens=3600):
        if ev["type"] == "stream":
            full += ev["chunk"]
            yield {"type": "stream", "chunk": ev["chunk"]}
        elif ev["type"] == "error":
            yield {"type": "error", "message": ev["message"]}
            return
    yield {"type": "done", "text": full, "reference": reference, "translations": translations}
