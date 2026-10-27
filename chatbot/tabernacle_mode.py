# chatbot/tabernacle_mode.py
""""Walk the Tabernacle" (internal id `tabernacle`): a scroll-driven 3D
walk-through whose furnishings ("spots") are described in one spots.json
shared with the frontend. This module loads that file, matches a user's
text to a spot, and builds the mode's opening turn (no LLM)."""

import functools
import html as html_lib
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import dataset

from chatbot import bible_search, wiki_refs
from chatbot.ollama_client import call_ollama_with_context, generate_llm_follow_ups

logger = logging.getLogger(__name__)

SPOTS_PATH_ENV = "TABERNACLE_SPOTS_PATH"
_DEFAULT_SPOTS_PATH = (
    Path(__file__).resolve().parent.parent
    / "frontend" / "public" / "tabernacle" / "data" / "spots.json"
)

INTRO_MESSAGE = (
    "Scroll to walk from the gate to the Holy of Holies. Click any furnishing "
    "to read about it, or ask me anything along the way."
)
FOLLOW_UPS = [
    "What does the veil represent?",
    "Why was the altar made of brass?",
    "What was inside the ark?",
]


@functools.lru_cache(maxsize=1)
def load_spots() -> Dict[str, Dict[str, Any]]:
    """Spots keyed by id. Cached; returns {} (logged once) if the file is
    missing or invalid. Call `load_spots.cache_clear()` after changing the env."""
    path = Path(os.environ.get(SPOTS_PATH_ENV) or _DEFAULT_SPOTS_PATH)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("spots file is not a JSON object")
        return data
    except (OSError, ValueError) as exc:
        logger.error("Tabernacle spots unavailable (%s): %s", path, exc)
        return {}


def _alias_pairs() -> List[Tuple[str, str]]:
    """(alias, spot id) for every well-formed alias, longest alias first."""
    pairs: List[Tuple[str, str]] = [
        (alias, spot_id)
        for spot_id, spot in load_spots().items()
        if isinstance(spot, dict) and isinstance(spot.get("aliases"), list)
        for alias in spot["aliases"]
        if isinstance(alias, str) and alias
    ]
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    return pairs


def match_spot(text: str) -> Optional[str]:
    """Id of the spot named in `text`: longest alias first, whole words,
    case-insensitive. None if nothing matches."""
    for alias, spot_id in _alias_pairs():
        if re.search(rf"\b{re.escape(alias)}\b", text, re.IGNORECASE):
            return spot_id
    return None


def first_spot_in(text: str) -> Optional[str]:
    """Id of the spot whose alias occurs earliest in `text` (whole words,
    case-insensitive); at the same position the longer alias wins, so "altar
    of incense" beats "altar". Used on a reply, which may name several spots
    but is about the first. None if nothing matches."""
    best: Optional[Tuple[int, str]] = None
    for alias, spot_id in _alias_pairs():  # longest first: a tie keeps the longer
        m = re.search(rf"\b{re.escape(alias)}\b", text, re.IGNORECASE)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), spot_id)
    return best[1] if best else None


def primer(mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Opening turn: intro text plus the tabernacle artifact, restoring a
    saved spot (`tabernacle_spot`) if it is still a known id."""
    saved = (mode_params or {}).get("tabernacle_spot")
    spot = saved if isinstance(saved, str) and saved in load_spots() else None
    return {
        "type": "chat",
        "message": INTRO_MESSAGE,
        "data": None,
        "route": "Mode primer → tabernacle",
        "follow_up_questions": list(FOLLOW_UPS),
        "artifacts": [
            {"type": "tabernacle", "label": "The Tabernacle", "params": {"spot": spot}}
        ],
    }


SYSTEM_PROMPT = """You are a guide walking a visitor through the Tabernacle of Moses.

Answer from the panel text and Scripture provided below. Keep to the typological reading the panels present (how each furnishing points to Christ); do not bring in other interpretations. If Scripture does not state something, say so plainly rather than guessing. Cite references as "Book chapter:verse" (for example: Exodus 25:22). Use plain, simple English and keep answers short and warm."""

_TAG_RE = re.compile(r"<[^>]+>")
_REF_RE = re.compile(r"^(\w{3})\s+(\d+):(\d+)(?:-(\d+))?$")
_FAILURE_MESSAGE = "I couldn't answer that right now \u2014 please try again."


def _plain(markup: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(_TAG_RE.sub(" ", markup))).strip()


def verse_text(usfm_ref: str) -> str:
    """KJV text of a USFM ref ("EXO 25:22" or a range "EXO 25:10-22"), verses
    joined with spaces; "" if the ref does not resolve."""
    m = _REF_RE.match((usfm_ref or "").strip())
    if not m:
        return ""
    bnum = bible_search._USFM_TO_BNUM.get(m.group(1).upper())
    if not bnum:
        return ""
    first = int(m.group(3))
    last = int(m.group(4) or first)
    db = dataset.connect(bible_search.DB_PATH)
    rows = db["Complete"].find(bnum=bnum, cnum=int(m.group(2)), order_by="vnum")
    return " ".join(
        bible_search._remove_tags(r["text_1769"])
        for r in rows
        if first <= r["vnum"] <= last and r["text_1769"]
    )


def grounding_for(spot_id: Optional[str]) -> str:
    """Research text for the LLM: the spot's panel text plus its verses, or
    (no spot) a one-line summary of every spot."""
    spots = load_spots()
    if not spots:
        return "The tabernacle panel text is unavailable; answer only from Scripture you can cite."
    spot = spots.get(spot_id) if spot_id else None
    if not isinstance(spot, dict):
        lines = [
            f"- {s.get('label', sid)}: {_plain(s.get('html', ''))[:200]}"
            for sid, s in spots.items() if isinstance(s, dict)
        ]
        return "THE TABERNACLE SPOTS:\n" + "\n".join(lines)
    parts = [f"{spot.get('title') or spot.get('label')}", _plain(spot.get("html", ""))]
    for ref in spot.get("refs", []):
        text = verse_text(ref.get("usfm", ""))
        if text:
            parts.append(f"{ref.get('label')}: {text}")
    return "\n\n".join(parts)


def _to_llm_history(history: Optional[List[Dict[str, str]]]) -> Optional[List[Dict[str, str]]]:
    if not history:
        return None
    return [{"role": m["role"], "content": m["text"]} for m in history]


async def answer(
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    mode_params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """One turn: ground the LLM on the spot named in the message (else the
    viewer's current spot) and cue the camera to the spot the message names,
    else the first one the reply names. The saved spot is never a cue: the
    camera is already there."""
    saved = (mode_params or {}).get("tabernacle_spot")
    current = saved if isinstance(saved, str) and saved in load_spots() else None
    named = match_spot(message)
    spot = named or current

    result = await call_ollama_with_context(
        message,
        research_data=grounding_for(spot),
        conversation_history=_to_llm_history(history),
        system_prompt=SYSTEM_PROMPT,
    )
    route = f"tabernacle_mode \u2192 {spot or 'general'}"
    if result.get("type") != "chat" or not result.get("message"):
        return {
            "type": "chat",
            "message": _FAILURE_MESSAGE,
            "data": {"tabernacle_spot": named},
            "route": route,
        }

    result["message"] = wiki_refs.resolve_scripture_refs(result["message"])
    cue = named or first_spot_in(result["message"])
    result["data"] = {"tabernacle_spot": cue}
    result["route"] = route
    follow_ups = await generate_llm_follow_ups(message, result["message"])
    if follow_ups:
        result["follow_up_questions"] = follow_ups
    return result
