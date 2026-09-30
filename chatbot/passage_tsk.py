# chatbot/passage_tsk.py
"""TSK cross-reference lookup for "Find passages" passage queries.

Data: chatbot/data/tsk_crossrefs.json, built by scripts/build_tsk_crossrefs.py
from OpenBible.info's cross-references (CC-BY), themselves derived from the
Treasury of Scripture Knowledge. A missing file simply means no
cross-reference arm (fail open)."""

import json
import logging
import threading
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Sequence

logger = logging.getLogger(__name__)

TSK_FILE = Path(__file__).resolve().parent / "data" / "tsk_crossrefs.json"
ATTRIBUTION = "Cross-references: OpenBible.info (CC-BY), from the Treasury of Scripture Knowledge"

_TABLE: Dict[str, List[List[int]]] = {}
_LOADED = False
_LOCK = threading.Lock()


def _table() -> Dict[str, List[List[int]]]:
    global _TABLE, _LOADED
    if _LOADED:
        return _TABLE
    with _LOCK:
        if not _LOADED:
            try:
                _TABLE = json.loads(TSK_FILE.read_text())
            except Exception:  # noqa: BLE001 — optional data; no cross-reference arm without it
                logger.warning("passages: TSK cross-references unavailable", exc_info=True)
                _TABLE = {}
            _LOADED = True
    return _TABLE


def related_verse_ids(verse_ids: Sequence[int], limit: int = 60) -> List[int]:
    table = _table()
    votes: Dict[int, int] = defaultdict(int)
    for verse_id in verse_ids:
        for target, count in table.get(str(verse_id), []):
            votes[target] += count
    return sorted(votes, key=lambda t: (-votes[t], t))[:limit]
