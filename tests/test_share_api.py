# tests/test_share_api.py
import pytest

import myproject
import share_store as ss


@pytest.fixture
def app_client(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'shares.db'}"
    monkeypatch.setenv("SHARE_DB_URL", url)
    monkeypatch.setattr(myproject, "_SHARE_DB_URL", url, raising=False)
    monkeypatch.setattr(myproject, "_share_db", None, raising=False)
    myproject._share_buckets.clear()
    myproject.app.config.update(TESTING=True)
    return myproject.app.test_client()


def _session(**overrides):
    s = dict(
        mode="freeform",
        modeParams={},
        title="Ask Anything",
        messages=[
            {"id": "m1", "role": "user", "text": "hi"},
            {"id": "m2", "role": "assistant", "text": "hello", "trace": {"turnId": "t"}},
        ],
        notes=[{"id": "n1", "body": "my note", "createdAt": 1, "updatedAt": 1}],
    )
    s.update(overrides)
    return s


def _body(**overrides):
    b = dict(client_id="c-1", session=_session())
    b.update(overrides)
    return b


def test_create_returns_token_and_import_url(app_client):
    resp = app_client.post("/api/share", json=_body())
    assert resp.status_code == 201
    data = resp.get_json()
    assert data["token"]
    assert data["url"].endswith(f"/?import={data['token']}")


def test_stored_row_strips_trace_and_derives_counts(app_client, tmp_path):
    token = app_client.post("/api/share", json=_body()).get_json()["token"]
    db = ss.get_db(f"sqlite:///{tmp_path / 'shares.db'}")
    row = ss.get_share(db, token)
    assert row["message_count"] == 2
    assert row["mode"] == "freeform"
    assert "trace" not in row["payload"]["messages"][1]
    assert row["payload"]["notes"][0]["body"] == "my note"


def test_get_returns_snapshot_without_client_id(app_client):
    token = app_client.post("/api/share", json=_body()).get_json()["token"]
    resp = app_client.get(f"/api/share/{token}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["title"] == "Ask Anything"
    assert data["mode"] == "freeform"
    assert data["modeParams"] == {}
    assert data["notes"][0]["body"] == "my note"
    assert data["messages"][1].get("trace") is None
    assert "client_id" not in data
    assert data["shared_at"].endswith("Z")


def test_get_unknown_token_is_404(app_client):
    assert app_client.get("/api/share/nope").status_code == 404


def test_rejects_missing_session(app_client):
    resp = app_client.post("/api/share", json={"client_id": "c-1"})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_session"


def test_rejects_non_list_messages(app_client):
    resp = app_client.post("/api/share", json=_body(session=_session(messages="nope")))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_session"


def test_rejects_blank_mode(app_client):
    resp = app_client.post("/api/share", json=_body(session=_session(mode="")))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_session"


def test_rejects_oversize_body(app_client):
    resp = app_client.post(
        "/api/share",
        data=b"x" * (1 * 1024 * 1024 + 1),
        content_type="application/json",
    )
    assert resp.status_code == 413


def test_rate_limited_after_bucket_exhausted(app_client):
    myproject._share_buckets.clear()
    codes = [app_client.post("/api/share", json=_body()).status_code for _ in range(12)]
    assert codes[:10] == [201] * 10
    assert codes[10] == 429
    assert app_client.post("/api/share", json=_body()).get_json()["error"] == "rate_limited"
