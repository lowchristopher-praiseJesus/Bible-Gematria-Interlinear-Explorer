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
    conversation returns however many themes are genuinely there.

    `themes` is tri-state, so callers can tell "the call itself failed" from
    "the model looked and genuinely found nothing":
      - `[]` — a genuine, successfully-parsed classification with no themes
        (or no source conversation to look at at all).
      - `None` — the LLM call errored/timed out (simple_completion's `""`
        sentinel) or its reply couldn't be parsed as the expected JSON —
        both are "the call didn't do its job", not "no themes exist".
    """
    transcript = _transcript_for(source_messages)
    if not transcript.strip():
        return {"themes": [], "digest": ""}

    reply = await simple_completion(
        _THEMES_SYSTEM_PROMPT,
        f"CONVERSATION:\n{transcript}",
        max_tokens=800,
        timeout=STORY_LLM_TIMEOUT_SECONDS,
    )
    if not reply:
        return {"themes": None, "digest": ""}
    parsed = _extract_json_object(reply)
    if not parsed:
        return {"themes": None, "digest": ""}

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


AGE_WORD_BANDS = {
    "3-6": (500, 800),
    "7-8": (800, 1200),
    "9-10": (1200, 1800),
}

AGE_COMPLEXITY = {
    "3-6": (
        "Simple sentences and concrete, sensory imagery all the way "
        "through — including the ending. Do not end with an abstract "
        "metaphor or simile (for example, comparing the friendship to the "
        "wind, the moon, or the stars) and do not tack on a summarizing "
        "moral (for example, \"The lesson is...\"). Instead end on one "
        "concrete, in-scene action that shows the lesson already happened."
    ),
    "7-8": "Slightly longer sentences, a light subplot, and gentle vocabulary growth.",
    "9-10": (
        "A fuller plot with some dialogue, richer vocabulary, and a lesson "
        "shown through the story rather than stated outright."
    ),
}

_STORY_SYSTEM_PROMPT = (
    "You write short, warm, original children's stories that illustrate a "
    "lesson from a Bible conversation, without retelling the Bible "
    "passage itself or naming any real biblical figure. Invent your own "
    "characters instead — a child, an animal, or similar — the way a "
    "parable teaches through an original story rather than a dramatized "
    "retelling.\n\n"
    "Start your reply with a single line `Title: <story title>`, a blank "
    "line, then the story itself as plain prose (no headings, no bullet "
    "points)."
)

_TITLE_LINE_RE = re.compile(r"^Title:\s*(.+)$", re.IGNORECASE | re.MULTILINE)


def _split_title(text: str) -> Dict[str, str]:
    match = _TITLE_LINE_RE.search(text)
    if not match:
        return {"title": "A Story for You", "body": text.strip()}
    title = match.group(1).strip()
    body = text[match.end():].strip()
    return {"title": title or "A Story for You", "body": body}


def _story_prompt(digest: str, themes: List[Dict[str, str]], age_range: str, low: int, high: int) -> str:
    theme_lines = "\n".join(f"- {t['label']}: {t['description']}" for t in themes)
    return (
        f"CONVERSATION SUMMARY: {digest}\n\n"
        f"THEME(S) TO WEAVE INTO ONE STORY:\n{theme_lines}\n\n"
        f"TARGET READER: age {age_range}. {AGE_COMPLEXITY[age_range]}\n"
        f"LENGTH: {low}-{high} words."
    )


async def generate_story(digest: str, themes: List[Dict[str, str]], age_range: str) -> Dict[str, Any]:
    """One story, sized to `age_range`'s word band, weaving every theme in
    `themes` together. Retries once, with a corrective instruction, if the
    word count lands far outside the target band — delivers the result
    either way rather than blocking the user."""
    if age_range not in AGE_WORD_BANDS:
        raise ValueError(f"Unknown story age range: {age_range!r}")
    low, high = AGE_WORD_BANDS[age_range]

    prompt = _story_prompt(digest, themes, age_range, low, high)
    text = await simple_completion(
        _STORY_SYSTEM_PROMPT, prompt, max_tokens=2400, timeout=STORY_LLM_TIMEOUT_SECONDS,
    )
    parts = _split_title(text)
    word_count = len(parts["body"].split())

    # Only retry when far outside the band (30% slack either way) — a
    # story a little short or long is still delivered as-is.
    if not (low * 0.7 <= word_count <= high * 1.3):
        corrective = (
            prompt
            + f"\n\nYour previous attempt was {word_count} words. Write again, "
            f"between {low} and {high} words this time."
        )
        retry_text = await simple_completion(
            _STORY_SYSTEM_PROMPT, corrective, max_tokens=2400, timeout=STORY_LLM_TIMEOUT_SECONDS,
        )
        if retry_text.strip():
            parts = _split_title(retry_text)
            word_count = len(parts["body"].split())

    return {"title": parts["title"], "text": parts["body"], "word_count": word_count}


async def build_primer(mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The mode's whole turn structure: every Tell a Story request is an
    empty-message call (theme derivation, then "Make my story"/"Try
    again"), so this single entry point — reached from
    router.build_mode_primer on every turn — decides which by whether the
    user has already picked themes."""
    # router.build_mode_primer already normalizes mode_params before
    # dispatching here, but this function is also exercised directly (by
    # its own tests, and potentially future callers), so it guards
    # `mode_params=None` itself too — matching the same pattern
    # build_mode_primer uses at its own top.
    mode_params = mode_params or {}
    llm_error = llm_unconfigured_error()
    if llm_error:
        return {
            "type": "error", "message": llm_error, "data": None,
            "route": "Mode primer → story → LLM unconfigured",
        }

    selected_ids = mode_params.get("story_selected_theme_ids")
    if selected_ids:
        return await _story_turn(mode_params, selected_ids)
    return await _themes_turn(mode_params)


async def _themes_turn(mode_params: Dict[str, Any]) -> Dict[str, Any]:
    source_messages = mode_params.get("source_messages") or []
    result = await derive_themes(source_messages)
    if result["themes"] is None:
        # The LLM call itself failed or returned something unusable — a
        # transient/infra problem, not a verdict on the conversation. Say
        # so distinctly from the "genuinely no themes" case below, and
        # flag `themesRetry` so the frontend can offer a Retry affordance
        # in place rather than forcing the user to abandon this story
        # session and start a new one from scratch.
        return {
            "type": "chat",
            "message": "The story engine is having trouble right now — please try again in a moment.",
            "data": {"themesRetry": True},
            "route": "Mode primer → story → theme derivation failed",
        }
    if not result["themes"]:
        return {
            "type": "chat",
            "message": "Couldn't find a story in this conversation yet — try chatting a bit more first.",
            "data": {"themesRetry": True},
            "route": "Mode primer → story → no themes",
        }
    return {
        "type": "chat",
        "message": (
            "Here's what stood out from that conversation — pick what you'd "
            "like the story to be about, and an age range, then I'll write it."
        ),
        "data": {"themes": result["themes"], "digest": result["digest"]},
        "route": "Mode primer → story → themes derived",
        "follow_up_questions": [],
    }


async def _story_turn(mode_params: Dict[str, Any], selected_ids: List[str]) -> Dict[str, Any]:
    all_themes = mode_params.get("story_themes") or []
    selected = [t for t in all_themes if t.get("id") in set(selected_ids)]
    if not selected:
        return {
            "type": "chat",
            "message": "I lost track of which theme you picked — please choose again.",
            "data": None,
            "route": "Mode primer → story → no matching themes",
        }
    age_range = mode_params.get("story_age_range") or "3-6"
    digest = mode_params.get("story_digest") or ""
    try:
        story = await generate_story(digest, selected, age_range)
    except ValueError:
        # An out-of-band story_age_range (not one of AGE_WORD_BANDS' three
        # values) — generate_story correctly raises for this (its own
        # tests pin that contract), but the picker never sends anything
        # else, so this is a defensive fallback, not a user-facing input
        # error to explain in detail.
        return {
            "type": "error",
            "message": "Something went wrong with that age range — please pick one and try again.",
            "data": None,
            "route": "Mode primer → story → invalid age range",
        }
    if not story["text"].strip():
        # Both the initial attempt and its one retry came back empty —
        # simple_completion() returns "" on any provider/network/timeout
        # failure rather than raising, so nothing upstream would otherwise
        # notice. Deliver an honest error instead of a confident-looking
        # "Here's your story" message with a blank artifact.
        return {
            "type": "error",
            "message": "I couldn't write the story just now — please try again in a moment.",
            "data": None,
            "route": "Mode primer → story → generation failed",
        }
    theme_labels = [t["label"] for t in selected]
    return {
        "type": "chat",
        "message": f"Here's your story — **{story['title']}**.",
        "data": None,
        "route": "Mode primer → story → generated",
        "artifacts": [{
            "type": "story",
            "label": "Read the story ▸",
            "params": {
                "title": story["title"],
                "themes": theme_labels,
                "age_range": age_range,
                "text": story["text"],
                "word_count": story["word_count"],
            },
        }],
    }
