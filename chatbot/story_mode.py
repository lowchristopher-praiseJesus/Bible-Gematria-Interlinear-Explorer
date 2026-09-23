"""Tell a Story mode: derive up to three themes/lessons from an existing
conversation, let the user pick which to weave together and a target
reading age, then write a short original children's story illustrating
them. See docs/superpowers/specs/2026-09-23-tell-a-story-mode-design.md.
"""

import json
import re
from typing import Any, Dict, List, Optional

from chatbot.ollama_client import llm_unconfigured_error, simple_completion

MAX_STORY_SOURCE_MESSAGES = 60

# Kept comfortably under Flask's 180s proxy timeout: every Tell a Story
# turn is an empty-message call routed through build_mode_primer, which —
# unlike Deep Study's phase-by-phase streaming — has no SSE keepalive.
STORY_LLM_TIMEOUT_SECONDS = 120.0

_THEMES_SYSTEM_PROMPT = (
    "You read a transcript of a Bible-study conversation and identify the "
    "moral or spiritual lessons in it that would make a good children's "
    "story. Reply with ONLY a JSON object, no markdown fence, no "
    "commentary:\n"
    '{"themes": [{"id": "t1", "label": "short theme name", "description": '
    '"one sentence describing it"}], "digest": "2-4 sentence summary of '
    'what the conversation was about"}\n'
    "List 1 to 3 themes. Only list a theme that is genuinely present in "
    "the conversation — a short or narrow conversation may honestly have "
    "only one."
)


def _extract_json_object(content: str) -> Optional[Dict[str, Any]]:
    """Best-effort extraction of a JSON object from LLM output that may be
    wrapped in a markdown fence or padded with stray prose. Returns None
    for anything that isn't a JSON object."""
    text = content.strip()
    fence_match = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    if not text.startswith("{"):
        brace_match = re.search(r"\{.*\}", text, re.DOTALL)
        if brace_match:
            text = brace_match.group(0)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _transcript_for(source_messages: List[Dict[str, str]]) -> str:
    capped = source_messages[-MAX_STORY_SOURCE_MESSAGES:]
    return "\n".join(f"{m['role'].upper()}: {m['text']}" for m in capped)


async def derive_themes(source_messages: List[Dict[str, str]]) -> Dict[str, Any]:
    """Up to 3 {id, label, description} themes plus a compact digest of the
    conversation, from one LLM call. Never pads to 3 with filler — a thin
    conversation returns however many themes are genuinely there."""
    transcript = _transcript_for(source_messages)
    if not transcript.strip():
        return {"themes": [], "digest": ""}

    reply = await simple_completion(
        _THEMES_SYSTEM_PROMPT,
        f"CONVERSATION:\n{transcript}",
        max_tokens=800,
        timeout=STORY_LLM_TIMEOUT_SECONDS,
    )
    parsed = _extract_json_object(reply) if reply else None
    if not parsed:
        return {"themes": [], "digest": ""}

    themes: List[Dict[str, str]] = []
    seen_ids = set()
    for i, raw in enumerate(parsed.get("themes", [])[:3]):
        if not isinstance(raw, dict):
            continue
        label = str(raw.get("label", "")).strip()
        if not label:
            continue
        theme_id = str(raw.get("id") or "").strip() or f"theme-{i + 1}"
        if theme_id in seen_ids:
            theme_id = f"theme-{i + 1}"
        seen_ids.add(theme_id)
        themes.append({
            "id": theme_id,
            "label": label,
            "description": str(raw.get("description", "")).strip(),
        })

    digest = str(parsed.get("digest", "")).strip()
    return {"themes": themes, "digest": digest}
