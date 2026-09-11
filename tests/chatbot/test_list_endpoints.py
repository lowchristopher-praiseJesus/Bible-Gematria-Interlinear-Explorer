"""Tests for GET /parables and GET /study-wikis list endpoints."""


def test_get_parables(client):
    res = client.get("/parables")
    assert res.status_code == 200
    body = res.json()
    ids = {p["id"] for p in body["parables"]}
    assert "prodigal_son" in ids


def test_get_study_wikis(client):
    res = client.get("/study-wikis")
    assert res.status_code == 200
    body = res.json()
    ids = {w["id"] for w in body["study_wikis"]}
    assert "present-day-ministry-of-jesus" in ids
