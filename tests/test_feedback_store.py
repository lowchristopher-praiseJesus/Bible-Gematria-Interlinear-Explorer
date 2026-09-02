# tests/test_feedback_store.py
import json

import pytest

import feedback_store as fs


@pytest.fixture
def db(tmp_path):
    database = fs.get_db(f"sqlite:///{tmp_path / 'feedback.db'}")
    fs.init_db(database)
    return database


def _insert(db, **overrides):
    payload = dict(
        client_id="c-1", email=None, category="wrong_answer", description="bad answer",
        session_json={"id": "s1", "mode": "freeform", "title": "Ask Anything",
                      "messages": [{"id": "m1", "role": "user", "text": "hi"}]},
        session_mode="freeform", session_title="Ask Anything", message_count=1,
        app_version="1.2.3", user_agent="UA", viewport="800x600", page_url="http://x/",
    )
    payload.update(overrides)
    return fs.insert_report(db, **payload)


def test_insert_then_get_roundtrips_session_json(db):
    rid = _insert(db)
    row = fs.get_report(db, rid)
    assert row["id"] == rid
    assert row["status"] == "new"
    assert row["created_at"].endswith("Z")
    assert row["session_json"]["messages"][0]["text"] == "hi"


def test_list_excludes_session_json_and_flags_email(db):
    _insert(db, email=None)
    _insert(db, email="a@b.com", category="ui")
    result = fs.list_reports(db)
    assert result["total"] == 2
    assert "session_json" not in result["items"][0]
    assert {i["has_email"] for i in result["items"]} == {True, False}


def test_list_filters_and_paginates(db):
    for _ in range(3):
        _insert(db, category="error")
    _insert(db, category="ui")
    assert fs.list_reports(db, category="error")["total"] == 3
    page = fs.list_reports(db, category="error", limit=2, offset=2)
    assert len(page["items"]) == 1
    assert page["total"] == 3


def test_update_report_sets_status_and_notes(db):
    rid = _insert(db)
    updated = fs.update_report(db, rid, status="triaged", admin_notes="looking into it")
    assert updated["status"] == "triaged"
    assert updated["admin_notes"] == "looking into it"
    assert fs.update_report(db, "nope", status="resolved") is None


def test_delete_report_removes_one_row(db):
    keep = _insert(db)
    drop = _insert(db)
    assert fs.delete_report(db, drop) is True
    assert fs.get_report(db, drop) is None
    assert fs.get_report(db, keep) is not None
    assert fs.list_reports(db)["total"] == 1


def test_delete_report_returns_false_for_unknown_id(db):
    _insert(db)
    assert fs.delete_report(db, "not-a-real-id") is False
    assert fs.list_reports(db)["total"] == 1


def test_delete_all_reports_clears_the_table(db):
    for _ in range(3):
        _insert(db)
    assert fs.delete_all_reports(db) == 3
    assert fs.list_reports(db)["total"] == 0
    # idempotent: a second clear removes nothing
    assert fs.delete_all_reports(db) == 0
