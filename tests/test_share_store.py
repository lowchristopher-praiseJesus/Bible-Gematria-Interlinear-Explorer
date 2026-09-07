# tests/test_share_store.py
import pytest

import share_store as ss

SNAPSHOT = {
    "mode": "freeform",
    "modeParams": {},
    "title": "Ask Anything",
    "messages": [{"id": "m1", "role": "user", "text": "hi"}],
    "notes": [{"id": "n1", "body": "a note", "createdAt": 1, "updatedAt": 1}],
}


@pytest.fixture
def db(tmp_path):
    database = ss.get_db(f"sqlite:///{tmp_path / 'shares.db'}")
    ss.init_db(database)
    return database


def test_insert_returns_token_and_get_roundtrips_payload(db):
    token = ss.insert_share(
        db, client_id="c-1", title="Ask Anything", mode="freeform",
        message_count=1, payload=SNAPSHOT,
    )
    assert isinstance(token, str) and len(token) >= 16
    row = ss.get_share(db, token)
    assert row["id"] == token
    assert row["created_at"].endswith("Z")
    assert row["mode"] == "freeform"
    assert row["message_count"] == 1
    assert row["payload"]["notes"][0]["body"] == "a note"
    assert row["payload"]["messages"][0]["text"] == "hi"


def test_get_share_unknown_token_returns_none(db):
    assert ss.get_share(db, "no-such-token") is None


def test_init_db_is_idempotent_and_queryable_before_first_insert(db):
    ss.init_db(db)  # a second call must not raise
    assert ss.get_share(db, "anything") is None


def test_tokens_are_unique_across_many_inserts(db):
    tokens = {
        ss.insert_share(db, client_id=None, title="t", mode="freeform",
                        message_count=0, payload=SNAPSHOT)
        for _ in range(25)
    }
    assert len(tokens) == 25
