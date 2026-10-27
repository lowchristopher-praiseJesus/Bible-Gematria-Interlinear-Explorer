# chatbot/tabernacle_mode.py
""""Walk the Tabernacle" (internal id `tabernacle`): a scroll-driven 3D
walk-through whose furnishings ("spots") are described in one spots.json
shared with the frontend. This module loads that file, matches a user's
text to a spot, and builds the mode's opening turn (no LLM)."""

import functools
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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


def match_spot(text: str) -> Optional[str]:
    """Id of the spot named in `text`: longest alias first, whole words,
    case-insensitive. None if nothing matches."""
    pairs: List[Tuple[str, str]] = [
        (alias, spot_id)
        for spot_id, spot in load_spots().items()
        for alias in spot.get("aliases", [])
    ]
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    for alias, spot_id in pairs:
        if re.search(rf"\b{re.escape(alias)}\b", text, re.IGNORECASE):
            return spot_id
    return None


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
