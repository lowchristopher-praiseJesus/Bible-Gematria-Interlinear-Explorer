"""Tests for _resolve_verse_reference — the flexible reference parser
behind Verse of the Day's free-text input, which accepts full book
names, USFM codes, common abbreviations, and verse ranges."""

import pytest

from chatbot.router import _resolve_verse_reference


@pytest.mark.parametrize(
    "text,expected",
    [
        ("1 Th 4:16", "1TH 4:16"),
        ("1Th 4:16", "1TH 4:16"),
        ("1 Thess 4:16", "1TH 4:16"),
        ("1 Thessalonians 4:16", "1TH 4:16"),
        ("1TH 4:16", "1TH 4:16"),
        ("John 3:16", "JHN 3:16"),
        ("Jn 3:16", "JHN 3:16"),
        ("Gen 1:1", "GEN 1:1"),
        ("Ps 23:1", "PSA 23:1"),
        ("Rev 21:4", "REV 21:4"),
    ],
)
def test_resolves_full_names_usfm_codes_and_abbreviations(text, expected):
    assert _resolve_verse_reference(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("1 Thessalonians 4:13-18", "1TH 4:13-18"),
        ("1 Thess 4:13-18", "1TH 4:13-18"),
        ("1 Th 4:13-18", "1TH 4:13-18"),
        ("John 3:16-18", "JHN 3:16-18"),
    ],
)
def test_resolves_verse_ranges(text, expected):
    assert _resolve_verse_reference(text) == expected


@pytest.mark.parametrize("text", ["not a reference", "Th 4:16", "Thessalonians", "4:16"])
def test_returns_none_for_unresolvable_input(text):
    assert _resolve_verse_reference(text) is None
