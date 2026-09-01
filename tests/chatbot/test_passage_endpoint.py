"""Tests for GET /passage — chapter/verse-range reads hydrated with
multiple translations (the same fetch_verse_translations() source Verse
of the Day uses), backing the Parable Study and Bible in a Year inline
chat readings."""

import pytest


@pytest.mark.asyncio
async def test_passage_whole_chapter(client, monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"KJV text for {reference}", "eng-NIV": f"NIV text for {reference}"}

    monkeypatch.setattr("chatbot.api.fetch_verse_translations", fake_fetch)
    res = client.get("/passage", params={"reference": "Job 1"})
    assert res.status_code == 200
    body = res.json()
    assert body["book"] == "Job"
    assert body["chapter"] == 1
    assert body["verseCount"] == 22
    first = body["verses"][0]
    assert first["vnum"] == 1
    assert first["ref"] == "Job 1:1"
    assert first["translations"] == {"eng-KJV": "KJV text for JOB 1:1", "eng-NIV": "NIV text for JOB 1:1"}


@pytest.mark.asyncio
async def test_passage_verse_range(client, monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"KJV text for {reference}"}

    monkeypatch.setattr("chatbot.api.fetch_verse_translations", fake_fetch)
    res = client.get("/passage", params={"reference": "Luke 15:11-32"})
    assert res.status_code == 200
    body = res.json()
    assert body["verseCount"] == 22
    assert [v["vnum"] for v in body["verses"]] == list(range(11, 33))


@pytest.mark.asyncio
async def test_passage_single_verse(client, monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": f"KJV text for {reference}"}

    monkeypatch.setattr("chatbot.api.fetch_verse_translations", fake_fetch)
    res = client.get("/passage", params={"reference": "Matthew 13:44"})
    assert res.status_code == 200
    body = res.json()
    assert body["verseCount"] == 1
    assert body["verses"][0]["vnum"] == 44


def test_passage_invalid_reference(client):
    res = client.get("/passage", params={"reference": "not a reference"})
    assert res.status_code == 400


def test_passage_unknown_chapter(client):
    res = client.get("/passage", params={"reference": "Job 999"})
    assert res.status_code == 404


def test_passage_fast_returns_local_kjv_without_any_external_fetch(client, monkeypatch):
    # fast=true must not touch fetch_verse_translations at all — the point
    # is to skip the slow per-verse web fetch entirely and answer straight
    # from Complete.db.
    def fail_if_called(*args, **kwargs):
        raise AssertionError("fast=true should never call fetch_verse_translations")

    monkeypatch.setattr("chatbot.api.fetch_verse_translations", fail_if_called)
    res = client.get("/passage", params={"reference": "Job 1", "fast": "true"})
    assert res.status_code == 200
    body = res.json()
    assert body["verseCount"] == 22
    first = body["verses"][0]
    assert first["vnum"] == 1
    assert first["translations"]["eng-KJV"].startswith("There was a man in the land of Uz")
    # Only the KJV comes back in the fast path — no other translations.
    assert list(first["translations"].keys()) == ["eng-KJV"]


@pytest.mark.asyncio
async def test_passage_tolerates_per_verse_fetch_failure(client, monkeypatch):
    async def flaky_fetch(reference, languages=None):
        if reference.endswith(":2"):
            raise RuntimeError("network down")
        return {"eng-KJV": f"KJV text for {reference}"}

    monkeypatch.setattr("chatbot.api.fetch_verse_translations", flaky_fetch)
    res = client.get("/passage", params={"reference": "Job 1"})
    assert res.status_code == 200
    body = res.json()
    verse_two = next(v for v in body["verses"] if v["vnum"] == 2)
    assert verse_two["translations"] == {}
    verse_one = next(v for v in body["verses"] if v["vnum"] == 1)
    assert verse_one["translations"] != {}
