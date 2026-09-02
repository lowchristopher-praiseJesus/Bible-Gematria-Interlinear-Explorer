# tests/test_feedback_api.py
import json

import pytest

import myproject
import feedback_store as fs


@pytest.fixture
def app_client(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'feedback.db'}"
    monkeypatch.setenv("FEEDBACK_DB_URL", url)
    monkeypatch.setattr(myproject, "_FEEDBACK_DB_URL", url, raising=False)
    monkeypatch.setattr(myproject, "_feedback_db", None, raising=False)
    myproject.app.config.update(TESTING=True)
    return myproject.app.test_client()


def _body(**overrides):
    payload = dict(
        category="wrong_answer",
        description="the answer was wrong",
        email="a@b.com",
        client_id="c-1",
        app_version="1.0.0",
        user_agent="UA",
        viewport="800x600",
        page_url="http://localhost/",
        session_json={
            "id": "s1", "mode": "freeform", "title": "Ask Anything",
            "messages": [{"id": "m1", "role": "user", "text": "hi"},
                         {"id": "m2", "role": "assistant", "text": "hello"}],
        },
    )
    payload.update(overrides)
    return payload


def test_happy_path_inserts_and_returns_id(app_client, tmp_path):
    resp = app_client.post("/api/feedback", json=_body())
    assert resp.status_code == 201
    rid = resp.get_json()["id"]
    db = fs.get_db(f"sqlite:///{tmp_path / 'feedback.db'}")
    row = fs.get_report(db, rid)
    assert row["category"] == "wrong_answer"
    assert row["session_mode"] == "freeform"       # derived server-side
    assert row["message_count"] == 2               # derived server-side
    assert row["session_title"] == "Ask Anything"


def test_rejects_unknown_category(app_client):
    resp = app_client.post("/api/feedback", json=_body(category="nonsense"))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_category"


def test_rejects_empty_description(app_client):
    resp = app_client.post("/api/feedback", json=_body(description="   "))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "empty_description"


def test_rejects_malformed_session_json(app_client):
    resp = app_client.post("/api/feedback", json=_body(session_json={"no": "messages"}))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_session"


def test_rejects_oversize_body(app_client):
    resp = app_client.post(
        "/api/feedback",
        data=b"x" * (5 * 1024 * 1024 + 1),
        content_type="application/json",
    )
    assert resp.status_code == 413
