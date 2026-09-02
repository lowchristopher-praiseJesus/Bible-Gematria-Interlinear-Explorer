"""SQLite-backed store for user-submitted chat troubleshooting reports.

Separate database from the read-only Complete.db: this one is written to.
Opened via the `dataset` library (already used across myproject.py).
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

import dataset

CATEGORIES = ("wrong_answer", "error", "slow", "ui", "other")
STATUSES = ("new", "triaged", "resolved")

DEFAULT_DB_URL = os.environ.get("FEEDBACK_DB_URL", "sqlite:///feedback.db")

_LIST_COLUMNS = (
    "id", "created_at", "category", "status",
    "session_mode", "session_title", "message_count",
)


def get_db(url: str | None = None) -> "dataset.Database":
    return dataset.connect(url or DEFAULT_DB_URL)


def init_db(db: "dataset.Database") -> None:
    table = db.create_table("reports", primary_id="id", primary_type=db.types.string(36))
    # Materialize columns so list/filter queries work before the first insert.
    for col in ("created_at", "client_id", "email", "category", "description",
                "session_json", "session_mode", "session_title", "app_version",
                "user_agent", "viewport", "page_url", "status", "admin_notes"):
        table.create_column(col, db.types.text)
    table.create_column("message_count", db.types.integer)
    table.create_index(["status"])
    table.create_index(["category"])
    table.create_index(["created_at"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def insert_report(
    db: "dataset.Database",
    *,
    client_id: str,
    email: str | None,
    category: str,
    description: str,
    session_json: dict,
    session_mode: str,
    session_title: str,
    message_count: int,
    app_version: str,
    user_agent: str,
    viewport: str,
    page_url: str,
) -> str:
    rid = str(uuid.uuid4())
    db["reports"].insert(
        {
            "id": rid,
            "created_at": _now_iso(),
            "client_id": client_id,
            "email": email or None,
            "category": category,
            "description": description,
            "session_json": json.dumps(session_json),
            "session_mode": session_mode,
            "session_title": session_title,
            "message_count": int(message_count),
            "app_version": app_version,
            "user_agent": user_agent,
            "viewport": viewport,
            "page_url": page_url,
            "status": "new",
            "admin_notes": None,
        }
    )
    return rid


def list_reports(
    db: "dataset.Database",
    *,
    status: str | None = None,
    category: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    table = db["reports"]
    where: dict = {}
    if status:
        where["status"] = status
    if category:
        where["category"] = category

    total = table.count(**where)
    rows = table.find(
        **where,
        order_by="-created_at",
        _limit=max(1, min(int(limit), 200)),
        _offset=max(0, int(offset)),
    )
    items = []
    for row in rows:
        item = {k: row.get(k) for k in _LIST_COLUMNS}
        item["has_email"] = bool(row.get("email"))
        items.append(item)
    return {"total": total, "items": items}


def _hydrate(row: dict | None) -> dict | None:
    if row is None:
        return None
    row = dict(row)
    raw = row.get("session_json")
    try:
        row["session_json"] = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        row["session_json"] = None
    return row


def get_report(db: "dataset.Database", rid: str) -> dict | None:
    return _hydrate(db["reports"].find_one(id=rid))


def update_report(
    db: "dataset.Database",
    rid: str,
    *,
    status: str | None = None,
    admin_notes: str | None = None,
) -> dict | None:
    table = db["reports"]
    if table.find_one(id=rid) is None:
        return None
    patch: dict = {"id": rid}
    if status is not None:
        patch["status"] = status
    if admin_notes is not None:
        patch["admin_notes"] = admin_notes
    table.update(patch, ["id"])
    return _hydrate(table.find_one(id=rid))


def delete_report(db: "dataset.Database", rid: str) -> bool:
    """Delete one report. Returns True if a row was removed, False if not found."""
    table = db["reports"]
    if table.find_one(id=rid) is None:
        return False
    table.delete(id=rid)
    return True


def delete_all_reports(db: "dataset.Database") -> int:
    """Delete every report. Returns how many rows were removed."""
    table = db["reports"]
    n = table.count()
    table.delete()
    return n
