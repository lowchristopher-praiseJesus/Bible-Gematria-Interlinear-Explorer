"""Answers free-text questions asked inside a Topical Study session,
grounded in that session's registered study wiki — no answer is ever
composed from outside the matched pages' own content."""

from typing import Any, Dict, List, Optional

from chatbot import wiki_loader, wiki_refs
from chatbot.ollama_client import call_ollama_with_context

# Some real wiki pages run 20KB+; capping each matched page's body keeps the
# grounding text sent to the LLM to a reasonable size regardless of how long
# the underlying page is.
_MAX_PAGE_CHARS_IN_GROUNDING = 2000


async def answer(
    series_id: str,
    message: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    concept_slug: Optional[str] = None,
) -> Dict[str, Any]:
    manifest = wiki_loader.get_manifest(series_id)
    if not manifest:
        return {
            "type": "error",
            "message": "Unknown study series.",
            "data": None,
            "route": "wiki_qa → unknown series",
        }

    # The page the user is currently reading is always relevant context —
    # a follow-up like "summarize this concept" shares no keywords with any
    # page, so keyword search alone can't see it. Grounding = the open page
    # (marked as such) plus keyword matches, deduped by slug.
    matches = wiki_loader.search(series_id, message)
    if concept_slug:
        current_page = wiki_loader.get_page(series_id, concept_slug)
        if current_page and not any(m["slug"] == concept_slug for m in matches):
            matches = [
                {
                    "slug": concept_slug,
                    "title": current_page["title"],
                    "kind": current_page["kind"],
                    "body": current_page["body"],
                    "currently_open": True,
                }
            ] + matches

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
        f"=== {m['title']}{' (the concept page currently open)' if m.get('currently_open') else ''} ===\n"
        f"{m['body'][:_MAX_PAGE_CHARS_IN_GROUNDING]}"
        for m in matches
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
    # Verse citations in the answer become markdown links into the
    # Explorer, so the frontend can make them clickable into the
    # original-language view — the same linking wiki pages get.
    result["message"] = wiki_refs.resolve_scripture_refs(result["message"])
    result["data"] = {"series_id": series_id, "best_match_slug": matches[0]["slug"]}
    result["route"] = f"wiki_qa → {series_id} → call_ollama_with_context()"
    return result
