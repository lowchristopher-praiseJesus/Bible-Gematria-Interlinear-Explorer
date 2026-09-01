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


def test_get_wiki_page_known(client):
    res = client.get("/study-wikis/present-day-ministry-of-jesus/pages/grace")
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Grace"
    assert body["kind"] == "concept"
    assert "Joseph Prince" in body["citation"]


def test_get_wiki_page_unknown_series_404(client):
    res = client.get("/study-wikis/not-a-real-series/pages/grace")
    assert res.status_code == 404


def test_get_wiki_page_unknown_slug_404(client):
    res = client.get("/study-wikis/present-day-ministry-of-jesus/pages/not-a-real-slug")
    assert res.status_code == 404
