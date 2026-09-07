"""SQLite-backed store for shared conversation snapshots.

Separate database from the read-only Complete.db and from feedback.db:
this one is written when a user shares a conversation and read when
someone opens a share link. Opened via the `dataset` library (already
used across myproject.py).

A share row is immutable once written: there is no update path, no
expiry, and no ownership beyond an advisory `client_id` kept only for
abuse triage. See
docs/superpowers/specs/2026-09-07-conversation-sharing-design.md.
"""

from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone

import dataset

DEFAULT_DB_URL = os.environ.get("SHARE_DB_URL", "sqlite:///shares.db")

# 16 random bytes -> url-safe base64 -> ~22 chars.
_TOKEN_NBYTES = 16


def get_db(url: str | None = None) -> "dataset.Database":
    return dataset.connect(url or DEFAULT_DB_URL)


def init_db(db: "dataset.Database") -> None:
    table = db.create_table("shares", primary_id="id", primary_type=db.types.string(64))
    # Materialize columns so reads work before the first insert.
    for col in ("created_at", "client_id", "title", "mode", "payload_json"):
        table.create_column(col, db.types.text)
    table.create_column("message_count", db.types.integer)
    table.create_index(["created_at"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_token() -> str:
    return secrets.token_urlsafe(_TOKEN_NBYTES)


def insert_share(
    db: "dataset.Database",
    *,
    client_id: str | None,
    title: str,
    mode: str,
    message_count: int,
    payload: dict,
) -> str:
    token = new_token()
    db["shares"].insert(
        {
            "id": token,
            "created_at": _now_iso(),
            "client_id": client_id or None,
            "title": title,
            "mode": mode,
            "message_count": int(message_count),
            "payload_json": json.dumps(payload),
        }
    )
    return token


def get_share(db: "dataset.Database", token: str) -> dict | None:
    row = db["shares"].find_one(id=token)
    if row is None:
        return None
    row = dict(row)
    raw = row.get("payload_json")
    try:
        row["payload"] = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        row["payload"] = None
    return row
