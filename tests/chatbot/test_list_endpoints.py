"""Tests for GET /parables and GET /topics list endpoints."""


def test_get_parables(client):
    res = client.get("/parables")
    assert res.status_code == 200
    body = res.json()
    ids = {p["id"] for p in body["parables"]}
    assert "prodigal_son" in ids


def test_get_topics(client):
    res = client.get("/topics")
    assert res.status_code == 200
    body = res.json()
    ids = {t["id"] for t in body["topics"]}
    assert "holiness" in ids
