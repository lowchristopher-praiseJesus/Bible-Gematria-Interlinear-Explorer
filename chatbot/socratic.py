"""Answers turns inside a Socratic Study session: instead of lecturing,
poses probing questions about a passage's literary structure and logic,
grounded in its text and any curated book context. Mirrors wiki_qa.py's
per-turn handler shape, but grounds on a single resolved verse reference
rather than a study-wiki series."""

from typing import Any, Dict, List, Optional

from chatbot.book_context import get_book_context
from chatbot.ollama_client import (
    VERSE_REF_PATTERN,
    _usfm_from_name,
    call_ollama_with_context,
    generate_llm_follow_ups,
)
from chatbot.router import _ref_from_history
from chatbot.tools import fetch_verse_translations

SOCRATIC_SYSTEM_PROMPT = """You are a Socratic Bible study partner, in the tradition of David Gooding and John Lennox: you help the user examine a passage for themselves rather than handing them conclusions. Your ultimate aim, whenever the passage supports it, is to help the user see what the text reveals about who God is — His character, nature, and ways.

- When the user answers your previous question and their answer is substantively right or insightful, say so briefly first — "Yes, exactly." / "Good insight." / naming specifically what they got right — before asking anything else. Never silently move on to a new question as if they hadn't answered; that reads as not listening. Then push to a genuinely NEW angle the conversation hasn't covered yet (a different attribute, a different implication, a connection elsewhere in the passage) — never re-ask essentially the same question in different words just because it's the same theme; re-asking what they already answered reads as not listening too, affirmation or not.
- When the user is reflecting on the passage, answering a question, or just starting out, ask ONE short, specific question — not a lecture. If the passage speaks to God's character, nature, or ways, make THAT the point of the question, not the passage's literary structure for its own sake — e.g. ask "what does God's action here show about His patience?" rather than "why does this verse follow the last one?". Use the passage's structure and logic only as the way INTO that question, never as the destination. When a passage isn't primarily about God (e.g. a genealogy or a travel note), question its structure and logic on its own terms instead of forcing a theological angle onto it.
- When the user instead asks a direct, factual question — about historical background, authorship, dates, word meanings, translation differences, or anything else with an actual answer, including a suggested question like "What's the historical context here?" — answer it directly and concisely (drawing on your own knowledge if nothing specific is given below), rather than turning it back into another question. The same goes for "I'm stuck", "I don't know", or "just tell me" signals. Only return to questioning on your next turn.
- Never deflect a direct question with a further question — that reads as evasive, not Socratic.
- Ground every question in the actual text and context given below. Never ask generic trivia unconnected to this specific passage.
- Keep your response short: a sentence or two."""

_SECTION_LABELS = {
    "literary_context": "Literary Context",
    "historical_setting": "Historical Setting",
    "author_and_audience": "Author and Audience",
    "immediate_purpose": "Immediate Purpose",
}

# SOCRATIC_SYSTEM_PROMPT already tells the model to answer directly on a
# "stuck" signal, but live testing showed the smaller model (openai/gpt-oss-20b)
# ignoring an exact "I don't know" in favor of continuing the Socratic-question
# pattern already established by prior turns in conversation history — the
# in-context pattern momentum overrides the meta-instruction. Detecting the
# signal here and forcing the override deterministically (below) makes it
# reliable instead of a suggestion the model can drop.
_STUCK_PHRASES = (
    "i don't know", "i dont know", "i do not know", "idk",
    "no idea", "not sure",
    "i'm stuck", "im stuck",
    "give me a hint", "give me the answer", "give me an answer",
    "just tell me", "tell me",
    "what's the answer", "whats the answer", "what is the answer",
)


def _is_stuck_signal(message: str) -> bool:
    normalized = message.strip().lower()
    return any(phrase in normalized for phrase in _STUCK_PHRASES)


def _detect_reference(text: str) -> Optional[str]:
    """Best-effort extraction of a single verse reference embedded in free
    text (e.g. "Let's look at John 3:16") — used when no reference has been
    established yet for the session, so a freeform-start conversation can
    still ground its questions once the user names a passage."""
    match = VERSE_REF_PATTERN.search(text)
    if not match:
        return None
    usfm = _usfm_from_name(match.group(1))
    return f"{usfm} {match.group(2)}:{match.group(3)}"


async def _grounding_for(reference: str, fetch_verse_text: bool = True) -> Dict[str, Any]:
    """Returns {"research_data", "translations", "book_context"} — the LLM
    prompt text plus the raw pieces the caller needs to also show the
    passage in a verse box, the same way every other mode does.

    `fetch_verse_text` is False for a verse range: fetch_verse_translations()
    only ever fetches a single verse (the same constraint _quote_response()
    and the mode primer work around in chatbot/router.py), so a range skips
    straight to book-context grounding instead."""
    parts = [f"Passage: {reference}"]
    translations: Dict[str, str] = {}
    if fetch_verse_text:
        try:
            translations = await fetch_verse_translations(reference, languages=["eng"])
        except Exception:
            translations = {}
        text = translations.get("eng-KJV") or next(iter(translations.values()), None)
        if text:
            parts.append(f"Text (KJV): {text}")

    usfm = reference.split(" ")[0].upper()
    ctx = get_book_context(usfm)
    if ctx:
        sections = ctx.get("sections", {})
        for key, label in _SECTION_LABELS.items():
            val = sections.get(key)
            if val:
                parts.append(f"{label}: {val}")

    return {
        "research_data": "\n\n".join(parts),
        "translations": translations,
        "book_context": ctx,
    }


async def answer(
    reference: Optional[str],
    message: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    # A fresh passage named in *this* message always wins over whatever the
    # session was previously grounded on (the frontend persists the last
    # resolved reference into mode_params, so `reference` here is normally
    # the passage from an earlier turn, not this one). Failing an explicit
    # `reference` too (e.g. an older client, or a session opened before that
    # persistence existed), fall back to the last reference mentioned
    # anywhere in the conversation (the same fallback the deterministic
    # router uses) rather than losing the passage the session was already
    # grounded on.
    resolved = (
        _detect_reference(message)
        or reference
        or _ref_from_history(conversation_history or [])
    )
    is_range = bool(resolved) and ":" in resolved and "-" in resolved.split(":", 1)[1]
    translations: Dict[str, str] = {}
    book_context = None
    if resolved:
        grounding = await _grounding_for(resolved, fetch_verse_text=not is_range)
        research_data = grounding["research_data"]
        translations = grounding["translations"]
        book_context = grounding["book_context"]
    else:
        research_data = (
            "No passage has been named yet in this conversation. Ask the user which passage "
            "or topic they want to interrogate, rather than posing a structural question about "
            "nothing in particular."
        )

    system_prompt = SOCRATIC_SYSTEM_PROMPT
    if _is_stuck_signal(message):
        system_prompt += (
            "\n\nThe user's message just now is a stuck/don't-know/tell-me signal. "
            "This turn only: do NOT ask another question — give ONE direct, concise "
            "answer about the passage, grounded in the text and context above. "
            "Resume questioning on your next turn."
        )

    result = await call_ollama_with_context(
        message,
        research_data=research_data,
        conversation_history=conversation_history,
        system_prompt=system_prompt,
    )
    result = await _attach_follow_ups(result, message)
    result["route"] = "socratic → call_ollama_with_context()"

    # Mirrors the "verse" response shape every other mode uses so the
    # passage under discussion shows up as a verse box in chat, not just a
    # bare reference string — but only for a single verse (a range has no
    # single-verse translations dict to show) and only on a successful turn.
    if result.get("type") == "chat" and resolved and translations and not is_range:
        result["type"] = "verse"
        result["data"] = {"reference": resolved, "translations": translations, "book_context": book_context}
    else:
        result["data"] = {"reference": resolved}
    return result


async def _attach_follow_ups(result: Dict[str, Any], message: str) -> Dict[str, Any]:
    """Mirrors wiki_qa._attach_follow_ups(): gives a successful turn
    LLM-authored follow-up questions grounded in the exchange. Fails
    silently (leaves follow_up_questions unset) when the LLM call errors or
    returns nothing usable."""
    if result.get("type") != "chat" or not result.get("message"):
        return result
    follow_ups = await generate_llm_follow_ups(message, result["message"])
    if follow_ups:
        result["follow_up_questions"] = follow_ups
    return result
