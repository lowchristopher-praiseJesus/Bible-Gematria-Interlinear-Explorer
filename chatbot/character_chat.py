"""Answers turns inside a "Chat with a Character" session: the LLM speaks as
the chosen Bible character in the first person, grounded solely on that
character's profile (characters/<id>.md, see chatbot/character_loader.py)."""

import re
from typing import Any, Dict, List, Optional

from chatbot import character_loader, wiki_refs
from chatbot.ollama_client import call_ollama_with_context, generate_llm_follow_ups

# Catches a reply that talks ABOUT its own source (a book, a chapter, "the
# record") instead of speaking as lived memory — the persona prompt already
# forbids this, but live testing showed the model still slips into it
# occasionally ("as it is written in the third chapter of Genesis"), so this
# backstops the prompt with a mechanical check + one rewrite pass.
#
# The second alternative catches a narrower but related leak: a profile's own
# third-person narration (e.g. Genesis 3:6's "gave also unto her husband
# with her; and he did eat") copied verbatim instead of retold as "I"/"me".
# Bare "her husband"/"his wife" is NOT banned — that's a legitimate way to
# name a third party's spouse (e.g. David on Bathsheba and Uriah) — only the
# archaic "gave...unto her husband/his wife" construction is unsafe, since
# no one describes themselves that way in first-person speech.
_PERSONA_LEAK_RE = re.compile(
    r"\b(the bible|scriptures?|the text|the verses|the record|is written|chapter)\b"
    r"|\bgave\b.{0,20}\bunto (?:her husband|his wife)\b",
    re.IGNORECASE,
)


def _breaks_persona(message: str) -> bool:
    return bool(_PERSONA_LEAK_RE.search(message))

STARTER_QUESTIONS = [
    "Who are you?",
    "Tell me about your family.",
    "What was the hardest thing you went through?",
]

_GREETING_REQUEST = (
    "A visitor has just arrived to talk with you. Greet them in one or two short "
    "sentences, say who you are, and invite them to ask you anything."
)

_PERSONA_PROMPT = """You are {name}, a person from the Bible, talking with a modern visitor who wants to speak with you. Answer as {name}, in the first person ("I", "my", "me"), as if you were really there.

Everything you know about yourself is in the profile below, which was compiled from the Bible's own verses.
- Never add anything that is not in the profile: no facts, events, feelings, motives, dates or conversations from outside it, even if you know them from elsewhere, and never invent details to fill a gap. That includes popular ideas or guesses people hold about your story (for example, what a fruit or a place was "really" like) when the profile does not say them.
- If the visitor asks about something the profile does not cover, stay in character and say honestly, in your own voice, that you do not know it or do not remember it. You may then share what you do remember that is close to it.
- You are living your own life, not reading a book. Never mention "the Bible", "Scripture", "the text", "the verses", "the record" or what "it says" or "is written" about your own life. Say what you saw, heard and did: "God told me not to eat from that tree", not "the Bible tells us God forbade it". A gap is personal ("I never saw", "I was not told", "I do not know"), never "the text does not say".
- Stay in character at all times. Never say you are an AI, a model or a program, and never mention a "profile", "notes", "data", "verses linked", or how the profile was made. Speak of your life as your own memories.
- When the profile quotes words someone actually spoke — to you or you to them — you may quote those words, and give the reference (for example: 1 Samuel 17:45). Only give a reference if you can name the book, chapter and verse exactly. The profile often shows just chapter and verse, like (6:14–16), under a paragraph about one book; work out the book from the events and names around it, and if you cannot be sure, leave the reference out.
- Much of the profile is instead narration ABOUT you, written in the third person — it may call you "her husband", "his brother", "the woman", or "he"/"she" where it means you. That is the profile's own writing style, never your voice: retell it in your own first-person words ("I", "me", "my"), and never copy it exactly as printed, even when it is a well-known verse.
- Where the profile says a link is uncertain or rests on tradition, speak of it with natural hedging ("some say", "I am not sure"). Never mention counts or probabilities.
- Speak of other people by name, in the third person, as people you knew or knew of. If the visitor asks about anything from after your lifetime or outside your world, say you would not know of it, and steer back to your own story.
- Use plain, simple English a high-school-level reader (including one still learning English) can follow easily: short sentences, everyday words, no "thee" or "thou". Keep the warmth and dignity of your own time and place.
- Answer at length: aim for 3 to 6 paragraphs, drawing on as much of your profile's memories, feelings and verses as truly bear on the question, so the visitor gets a full, unhurried account rather than a summary. A truly small exchange (a greeting, a one-word fact) can still be a line or two — never pad those — but for anything reflective, give it the fuller telling.
- However long the reply, it stays spoken, the way you would actually talk: flowing paragraphs of your own voice, one thought leading into the next. Never use bold sub-headers, a numbered or bulleted list, or any other document-like formatting to organize your answer — that is how a written article looks, not how a person speaks."""


def _persona_for(name: str) -> str:
    return _PERSONA_PROMPT.format(name=name)


def _grounding_for(profile: str) -> str:
    return f"\n\nYOUR PROFILE (the only source you may draw on):\n\n{profile}"


def _unknown_character(route: str) -> Dict[str, Any]:
    return {
        "type": "error",
        "message": "Unknown character.",
        "data": None,
        "route": route,
    }


def _to_llm_history(history: Optional[List[Dict[str, str]]]) -> Optional[List[Dict[str, str]]]:
    if not history:
        return None
    return [{"role": m["role"], "content": m["text"]} for m in history]


async def _rewrite_if_breaks_persona(character: Dict[str, Any], message: str) -> str:
    """If `message` refers to its own source (a book, a chapter, "the
    record"), or recites third-person narration about itself verbatim
    ("gave...unto her husband...and he did eat") instead of speaking as
    lived memory, ask the model to rewrite it in-voice — up to twice, since
    live testing showed a single pass sometimes leaves the violation
    untouched. Falls back to the best attempt (or the original, if every
    attempt errored) rather than blocking the turn."""
    if not _breaks_persona(message):
        return message
    current = message
    for _ in range(2):
        result = await call_ollama_with_context(
            "Your reply below breaks character in one of two ways: either it talks "
            "about your life as something written, recorded, or found in a book, "
            "chapter, text or verse (instead of speaking only from memory), or it "
            "describes you in the third person using a relationship word — such as "
            "\"her husband\", \"his wife\", \"her brother\" — where it should say "
            "\"I\"/\"me\". Rewrite it fully in the first person, as your own spoken "
            "memory, fixing whichever of those it is. Keep every fact and every "
            "quotation exactly as before, in the same voice and about the same "
            f"length.\n\nREPLY TO REWRITE:\n{current}",
            research_data=_grounding_for(character["profile"]),
            system_prompt=_persona_for(character["name"]),
        )
        if result.get("type") != "chat" or not result.get("message"):
            break
        current = result["message"]
        if not _breaks_persona(current):
            break
    return current


async def answer(
    character_id: str,
    message: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    character = character_loader.get_character(character_id)
    if not character:
        return _unknown_character("character_chat → unknown character")

    result = await call_ollama_with_context(
        message,
        research_data=_grounding_for(character["profile"]),
        conversation_history=_to_llm_history(conversation_history),
        system_prompt=_persona_for(character["name"]),
    )
    result["data"] = {"character_id": character_id, "character_name": character["name"]}
    result["route"] = f"character_chat → {character_id} → call_ollama_with_context()"
    if result.get("type") != "chat" or not result.get("message"):
        return result

    result["message"] = await _rewrite_if_breaks_persona(character, result["message"])
    result["message"] = wiki_refs.resolve_scripture_refs(result["message"])
    follow_ups = await generate_llm_follow_ups(message, result["message"])
    if follow_ups:
        result["follow_up_questions"] = follow_ups
    return result


async def greeting(character_id: str) -> Dict[str, Any]:
    """The session's opening turn: a short in-character hello, or a static
    line if the LLM is unavailable so picking a character never dead-ends."""
    character = character_loader.get_character(character_id)
    if not character:
        return _unknown_character("Mode primer → character → unknown character")

    result = await call_ollama_with_context(
        _GREETING_REQUEST,
        research_data=_grounding_for(character["profile"]),
        system_prompt=_persona_for(character["name"]),
    )
    if result.get("type") == "chat" and result.get("message"):
        message = await _rewrite_if_breaks_persona(character, result["message"])
    else:
        message = (
            f"You are now talking with **{character['name']}**. "
            f"{character['summary']}\n\nAsk anything you like."
        )
    return {
        "type": "chat",
        "message": message,
        "data": {"character_id": character_id, "character_name": character["name"]},
        "route": "Mode primer → character",
        "follow_up_questions": list(STARTER_QUESTIONS),
    }
