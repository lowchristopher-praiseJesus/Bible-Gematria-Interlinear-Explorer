"""Tests for GET /book_context/{book} endpoint."""

import pytest


def test_get_book_context_by_usfm(client):
    res = client.get("/book_context/MAT")
    assert res.status_code == 200
    body = res.json()
    assert body["book_name"] == "Matthew"
    assert "sections" in body


def test_get_book_context_by_full_name(client):
    res = client.get("/book_context/John")
    assert res.status_code == 200
    assert res.json()["book_name"] == "John"


def test_get_book_context_unknown_book(client):
    res = client.get("/book_context/Genesis")
    assert res.status_code == 404
