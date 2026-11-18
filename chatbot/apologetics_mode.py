# chatbot/apologetics_mode.py
""""Defend the Faith" (internal id `apologetics`): the user's apologetics
YouTube Shorts as track playlists, with a chat grounded on what the shorts
say. The data is chatbot/data/apologetics_shorts.json, built by
scripts/import_apologetics_shorts.py. This module lists the tracks, builds
the opening turn (no LLM) and answers grounded on the track's shorts plus a
one-line catalogue of every other uploaded short."""

import functools
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from chatbot import wiki_refs
from chatbot.ollama_client import call_ollama_with_context, generate_llm_follow_ups

logger = logging.getLogger(__name__)

SHORTS_PATH_ENV = "APOLOGETICS_SHORTS_PATH"
_DEFAULT_PATH = Path(__file__).resolve().parent / "data" / "apologetics_shorts.json"

INTRO = (
    "Watch each short in this track, then ask me anything about it. When you've "
    "watched them all, we can talk through the whole track together."
)
UNAVAILABLE = "That track isn't available any more — pick another from the start page."
FAILURE_MESSAGE = "I couldn't answer that right now — please try again."

SYSTEM_PROMPT = """You are a friendly guide to "Defend the Faith", a series of short videos that answer common objections to the Christian faith.

Rules:
- The shorts in the material below are the basis for every answer. Explain, expand on and connect the arguments they make; quote or paraphrase them.
- You may quote Scripture, citing it as "Book chapter:verse" (for example: 1 Corinthians 15:6).
- Never add historical facts, statistics, quotes, scholars or arguments that the material does not contain. When a question goes beyond the material, say plainly that the series doesn't cover that yet.
- Refer to a short only by its title in quotes, never by number. For a short in another track, also name that track. Never name a short that is not listed in the material.
- The shorts are told as stories with fictional characters. You may briefly recall a short's story to connect your answer to what the user watched, but never present its characters as real people or as sources, and keep the story apart from the facts it illustrates.
- Don't spoil a short the user hasn't watched yet beyond saying it is covered later in the track.
- Use plain, warm English. Be confident but never combative. Keep answers short."""


@functools.lru_cache(maxsize=1)
def load_manifest() -> Dict[str, Any]:
    """The manifest, cached; {} (logged) if missing or invalid. Call
    `load_manifest.cache_clear()` after changing the env."""
    path = Path(os.environ.get(SHORTS_PATH_ENV) or _DEFAULT_PATH)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("tracks"), list) or not isinstance(data.get("shorts"), dict):
            raise ValueError("manifest is not {tracks: [...], shorts: {...}}")
        return data
    except (OSError, ValueError) as exc:
        logger.error("Apologetics manifest unavailable (%s): %s", path, exc)
        return {}


def _short(n: Any) -> Optional[Dict[str, Any]]:
    return load_manifest().get("shorts", {}).get(str(n)) if isinstance(n, int) and not isinstance(n, bool) else None


def _uploaded(numbers: Iterable[Any]) -> List[Dict[str, Any]]:
    return [s for s in (_short(n) for n in numbers) if s and s.get("youtube_id")]


def _track(track_id: Any) -> Optional[Dict[str, Any]]:
    """A track with at least one uploaded short, else None."""
    for t in load_manifest().get("tracks", []):
        if t.get("id") == track_id and _uploaded(t.get("shorts", [])):
            return t
    return None


def list_tracks() -> List[Dict[str, Any]]:
    """Tracks with at least one uploaded short; each short trimmed to what the
    playlist shows (no script or summary). Not-uploaded shorts are kept with
    youtube_id None ("Coming soon")."""
    out = []
    for t in load_manifest().get("tracks", []):
        if not _track(t.get("id")):
            continue
        shorts = [s for s in (_short(n) for n in t["shorts"]) if s]
        out.append({
            "id": t["id"], "title": t["title"], "blurb": t.get("blurb", ""),
            "shorts": [
                {k: s.get(k) for k in ("number", "title", "youtube_id", "thumbnail", "further_reading")}
                for s in shorts
            ],
        })
    return out


def primer(mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Opening turn: intro plus the track's playlist artifact (no LLM)."""
    track = _track((mode_params or {}).get("track_id"))
    return {
        "type": "chat",
        "message": INTRO if track else UNAVAILABLE,
        "data": None,
        "route": "Mode primer → apologetics",
        "follow_up_questions": [],
        "artifacts": (
            [{"type": "apologetics_track", "label": track["title"], "params": {"trackId": track["id"]}}]
            if track else []
        ),
    }


def _first_sentence(text: str) -> str:
    m = re.match(r"(.+?[.!?])(\s|$)", " ".join((text or "").split()))
    return m.group(1) if m else (text or "").strip()


def grounding_for(track_id: Any, current_short: Any, watched: Any) -> str:
    """Research text: the track's uploaded shorts in full (current/watched
    marked), then one line for every other uploaded short. Shorts are named
    by title only."""
    manifest = load_manifest()
    if not manifest:
        return "The shorts are unavailable; say you can't answer about them right now."
    watched_set = {n for n in (watched if isinstance(watched, list) else []) if isinstance(n, int)}
    track = _track(track_id)
    in_track = _uploaded(track["shorts"]) if track else []
    parts: List[str] = []
    if track:
        parts.append(f"THIS TRACK: {track['title']}")
        for s in in_track:
            mark = ("WATCHING NOW" if s["number"] == current_short
                    else "watched" if s["number"] in watched_set else "not watched yet")
            block = [f'### "{s["title"]}" [{mark}]', "Script (as narrated):", s.get("script", "").strip(),
                     "Summary:", s.get("summary", "").strip()]
            if s.get("fiction_note"):
                block.append(s["fiction_note"])
            reading = [i["text"] for i in s.get("further_reading", [])]
            if reading:
                block.append("Further reading: " + " · ".join(reading))
            parts.append("\n".join(block))

    track_titles: Dict[int, List[str]] = {}
    for t in manifest.get("tracks", []):
        for n in t.get("shorts", []):
            track_titles.setdefault(n, []).append(t["title"])
    shown = {s["number"] for s in in_track}
    others = [s for s in _uploaded(sorted(int(k) for k in manifest["shorts"])) if s["number"] not in shown]
    if others:
        lines = [
            f'- "{s["title"]}" (track: {", ".join(track_titles.get(s["number"], [])) or "none"}): '
            f'{_first_sentence(s.get("summary", ""))}'
            for s in others
        ]
        parts.append("OTHER SHORTS IN THE SERIES:\n" + "\n".join(lines))
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
    """One turn grounded on the session's track and its progress."""
    params = mode_params or {}
    track_id = params.get("track_id")
    result = await call_ollama_with_context(
        message,
        research_data=grounding_for(track_id, params.get("current_short"), params.get("watched_shorts")),
        conversation_history=_to_llm_history(history),
        system_prompt=SYSTEM_PROMPT,
    )
    route = f"apologetics_mode → {track_id or 'no track'}"
    if result.get("type") != "chat" or not result.get("message"):
        return {"type": "chat", "message": FAILURE_MESSAGE, "data": None, "route": route}

    result["message"] = wiki_refs.resolve_scripture_refs(result["message"])
    result["data"] = None
    result["route"] = route
    follow_ups = await generate_llm_follow_ups(message, result["message"])
    if follow_ups:
        result["follow_up_questions"] = follow_ups
    return result
