"""Registered LLM-wiki study series for Topical Study mode.

Append new entries here as more series are ingested — no other code needs
to change when the list grows. `path` points into the external wiki
library (~/Documents/study-wikis/), never into this repo — a registered
wiki's `raw/` folder holds copyrighted sermon transcripts/audio that must
never be committed. Each entry's `path` is expected to follow the
three-layer schema (`raw/`, `wiki/`, `AGENTS.md`) documented in that
wiki's own AGENTS.md — this app only reads `wiki/concepts/`,
`wiki/entities/`, `wiki/sources/` from it (see chatbot/wiki_loader.py).
"""

from typing import Any, Dict, List, Optional

STUDY_WIKI_LIBRARY: List[Dict[str, Any]] = [
    {
        "id": "present-day-ministry-of-jesus",
        "title": "The Present-Day Ministry of Jesus and How It Empowers You",
        "speaker": "Joseph Prince",
        "description": (
            "10-part series on what Jesus is doing now as high priest at "
            "the Father's right hand, mostly from Hebrews."
        ),
        "path": "~/Documents/study-wikis/present-day-ministry-of-jesus",
    },
]


def get_registered(series_id: str) -> Optional[Dict[str, Any]]:
    return next((w for w in STUDY_WIKI_LIBRARY if w["id"] == series_id), None)
