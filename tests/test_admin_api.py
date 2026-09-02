# tests/test_admin_api.py
import base64

import pytest

import myproject
import feedback_store as fs


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'feedback.db'}"
    monkeypatch.setattr(myproject, "_FEEDBACK_DB_URL", url, raising=False)
    monkeypatch.setattr(myproject, "_feedback_db", None, raising=False)
    monkeypatch.setenv("ADMIN_USER", "boss")
    monkeypatch.setenv("ADMIN_PASSWORD", "s3cret")
    myproject.app.config.update(TESTING=True)
    db = fs.get_db(url)
    fs.init_db(db)
    rid = fs.insert_report(
        db, client_id="c", email=None, category="error", description="d",
        session_json={"messages": []}, session_mode="freeform", session_title="t",
        message_count=0, app_version="v", user_agent="UA", viewport="1x1", page_url="u",
    )
    return myproject.app.test_client(), rid


def _auth(user="boss", pw="s3cret"):
    token = base64.b64encode(f"{user}:{pw}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def test_list_requires_credentials(ctx):
    client, _ = ctx
    resp = client.get("/api/admin/feedback")
    assert resp.status_code == 401
    assert resp.headers["WWW-Authenticate"].startswith("Basic")


def test_list_rejects_wrong_credentials(ctx):
    client, _ = ctx
    bad_pw = client.get("/api/admin/feedback", headers=_auth(pw="wrong"))
    assert bad_pw.status_code == 401
    assert bad_pw.headers["WWW-Authenticate"].startswith("Basic")
    bad_user = client.get("/api/admin/feedback", headers=_auth(user="nobody"))
    assert bad_user.status_code == 401
    assert bad_user.headers["WWW-Authenticate"].startswith("Basic")


def test_list_returns_items_with_valid_credentials(ctx):
    client, _ = ctx
    resp = client.get("/api/admin/feedback", headers=_auth())
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["total"] == 1
    assert "session_json" not in body["items"][0]


def test_get_one_returns_session_json(ctx):
    client, rid = ctx
    resp = client.get(f"/api/admin/feedback/{rid}", headers=_auth())
    assert resp.status_code == 200
    assert resp.get_json()["session_json"] == {"messages": []}
    assert client.get("/api/admin/feedback/nope", headers=_auth()).status_code == 404


def test_patch_updates_status(ctx):
    client, rid = ctx
    resp = client.patch(f"/api/admin/feedback/{rid}", headers=_auth(), json={"status": "resolved"})
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "resolved"
    bad = client.patch(f"/api/admin/feedback/{rid}", headers=_auth(), json={"status": "banana"})
    assert bad.status_code == 400


def test_503_when_admin_not_configured(ctx, monkeypatch):
    client, _ = ctx
    monkeypatch.delenv("ADMIN_USER", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    assert client.get("/api/admin/feedback", headers=_auth()).status_code == 503
