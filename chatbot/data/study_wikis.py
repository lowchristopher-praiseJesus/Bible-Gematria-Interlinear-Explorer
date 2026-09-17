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
    {
        "id": "principles-for-interpreting-the-bible",
        "title": "Principles For Interpreting The Bible",
        "speaker": "Joseph Prince",
        "description": (
            "6-part series on how to read the Bible — context, letting scripture "
            "interpret scripture, rightly dividing the covenants, typology, and "
            "the Christ-centered test of any interpretation."
        ),
        "path": "~/Documents/study-wikis/principles-for-interpreting-the-bible",
    },
    {
        "id": "blessings-of-god",
        "title": "A Study of the Blessings of God",
        "speaker": "Joseph Prince",
        "description": (
            "6-part series walking through Deuteronomy 28 verse by verse — the "
            "blessings (28:1-13) and the curses (28:14-68) — read through a New "
            "Covenant/grace lens, plus a related midweek message on inheriting "
            "God's blessings by faith from Romans 4."
        ),
        "path": "~/Documents/study-wikis/A-study-of-the-blessings-of-god",
    },
    {
        "id": "secret-of-moses-40-days",
        "title": "The Secret of Moses: 40 Days",
        "speaker": "Joseph Prince",
        "description": (
            "8-part series reading Exodus 24-31's account of Moses' 40 days on "
            "Sinai as a room-by-room unveiling of the Tabernacle — its furniture, "
            "colors, and materials read as types and shadows of Christ."
        ),
        "path": "~/Documents/study-wikis/the-secret-of-moses-40-Days",
    },
]


def get_registered(series_id: str) -> Optional[Dict[str, Any]]:
    return next((w for w in STUDY_WIKI_LIBRARY if w["id"] == series_id), None)
