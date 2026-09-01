"""Answers free-text questions asked inside a Topical Study session,
grounded in that session's registered study wiki — no answer is ever
composed from outside the matched pages' own content."""

from typing import Any, Dict, List, Optional

from chatbot import wiki_loader
from chatbot.ollama_client import call_ollama_with_context

# Some real wiki pages run 20KB+; capping each matched page's body keeps the
# grounding text sent to the LLM to a reasonable size regardless of how long
# the underlying page is.
_MAX_PAGE_CHARS_IN_GROUNDING = 2000


async def answer(
    series_id: str,
    message: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    manifest = wiki_loader.get_manifest(series_id)
    if not manifest:
        return {
            "type": "error",
            "message": "Unknown study series.",
            "data": None,
            "route": "wiki_qa → unknown series",
        }

    matches = wiki_loader.search(series_id, message)
    if not matches:
        concepts = wiki_loader.list_concepts(series_id)[:5]
        suggestions = ", ".join(c["title"] for c in concepts) or "a concept from this series"
        return {
            "type": "chat",
            "message": (
                f"I couldn't find anything in this series about that. "
                f"Try asking about one of: {suggestions}."
            ),
            "data": {"series_id": series_id},
            "route": "wiki_qa → no match",
        }

    citation = f"{manifest['speaker']} — {manifest['title']}"
    matched_text = "\n\n".join(
        f"=== {m['title']} ===\n{m['body'][:_MAX_PAGE_CHARS_IN_GROUNDING]}" for m in matches
    )
    research_data = (
        f"Answer only from the material below, drawn from the study series "
        f"\"{manifest['title']}\" by {manifest['speaker']}. If the material "
        f"doesn't address the question, say so plainly rather than guessing. "
        f"Close your answer with a citation line: \"— {citation}\".\n\n"
        f"{matched_text}"
    )

    result = await call_ollama_with_context(
        message, research_data=research_data, conversation_history=conversation_history
    )
    result["data"] = {"series_id": series_id, "best_match_slug": matches[0]["slug"]}
    result["route"] = f"wiki_qa → {series_id} → call_ollama_with_context()"
    return result
