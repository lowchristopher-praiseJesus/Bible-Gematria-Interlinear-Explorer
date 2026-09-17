"""SQLite-backed store for Devotional mode's shared "devotional of the day".

Only the rotation ("Pick one for me") path reads or writes this table — a
typed reference or theme always generates fresh. The first "Pick one for
me" generation on a given GMT+8 calendar day becomes what every other
"Pick one for me" request returns for the rest of that day, so the LLM
devotional-text call (and, transitively, the audio-cache-keyed TTS call)
happens at most once per day regardless of how many users hit it. See
docs/superpowers/specs/2026-09-17-devotional-audio-design.md.

Separate database from Complete.db, feedback.db, and shares.db. Opened via
the `dataset` library (already used by share_store.py).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import dataset
from sqlalchemy.exc import IntegrityError

DEFAULT_DB_URL = os.environ.get("DEVOTIONAL_OF_DAY_DB_URL", "sqlite:///devotional-of-day.db")

_db = None


def get_db(url: Optional[str] = None) -> "dataset.Database":
    return dataset.connect(url or DEFAULT_DB_URL)


def init_db(db: "dataset.Database") -> None:
    table = db.create_table("daily_devotional", primary_id="date_gmt8", primary_type=db.types.string(10))
    for col in ("reference", "translations_json", "text", "created_at"):
        table.create_column(col, db.types.text)


def get_default_db() -> "dataset.Database":
    """Lazily-connected singleton for the app's own runtime. Tests should
    use get_db()/init_db() on their own throwaway URL instead."""
    global _db
    if _db is None:
        _db = get_db()
        init_db(_db)
    return _db


def today_gmt8() -> str:
    """Today's date in a fixed UTC+8 offset ('YYYY-MM-DD'). GMT+8 (e.g.
    Singapore, Shanghai, Kuala Lumpur) has no DST, so a fixed offset is
    correct and needs no zoneinfo dependency."""
    return (datetime.now(timezone.utc) + timedelta(hours=8)).date().isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def get_for_date(db: "dataset.Database", date_gmt8: str) -> Optional[dict]:
    row = db["daily_devotional"].find_one(date_gmt8=date_gmt8)
    if row is None:
        return None
    row = dict(row)
    row["translations"] = json.loads(row["translations_json"])
    return row


def get_today(db: "dataset.Database") -> Optional[dict]:
    return get_for_date(db, today_gmt8())


def capture_if_absent(
    db: "dataset.Database",
    *,
    reference: str,
    translations: dict,
    text: str,
    date_gmt8: Optional[str] = None,
) -> bool:
    """Persist (reference, translations, text) as the given day's canonical
    devotional if no row exists yet for that day. Returns True if this call
    became canonical, False if another request already won — a benign
    race; the caller's own result is unaffected either way."""
    date_gmt8 = date_gmt8 or today_gmt8()
    try:
        db["daily_devotional"].insert({
            "date_gmt8": date_gmt8,
            "reference": reference,
            "translations_json": json.dumps(translations),
            "text": text,
            "created_at": _now_iso(),
        })
        return True
    except IntegrityError:
        return False
