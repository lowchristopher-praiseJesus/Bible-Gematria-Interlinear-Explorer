from pathlib import Path

from chatbot.apologetics_import import parse_description, parse_further_reading, parse_short_filename

FIX = Path(__file__).parent / "fixtures" / "apologetics"


def test_filename():
    assert parse_short_filename("03 The Resurrection - script.txt") == (3, "The Resurrection")
    assert parse_short_filename("12 Human Worth - The Price Tag.mp4") == (12, "Human Worth")
    assert parse_short_filename("Did Jesus Really Die on the Cross.mp4") is None


def test_description_strips_title_reading_hashtags_and_boilerplate():
    d = parse_description((FIX / "01 Historical Reliability - description.txt").read_text())
    assert d["summary"].startswith("A professor calls the Gospels")
    for gone in ("TITLE:", "DESCRIPTION:", "#Shorts", "Further reading", "Subscribe", "50-part series", "fictional"):
        assert gone not in d["summary"]
    # #1 and #2 carry no fiction note in their descriptions.
    assert d["fiction_note"] is None


def test_fiction_note_after_reading_line():
    d = parse_description((FIX / "03 The Resurrection - description.txt").read_text())
    assert d["fiction_note"] == "(The magistrate is a fictional character representing the Roman authorities.)"
    assert d["summary"].endswith("Could you hold out if you knew it was a lie? 👇")
    assert [i["text"] for i in d["further_reading"]] == [
        "Acts 5 & 12", "Acts 16:25", "1 Clement 5", "Josephus, Antiquities 20.9.1", "John 21",
    ]


def test_further_reading_verse_range_and_plain_items():
    items = parse_further_reading('1 Corinthians 15:3–7 · Arrian, "Anabasis of Alexander"')
    assert items == [
        {"text": "1 Corinthians 15:3–7", "refs": ["1CO 15:3-7"]},
        {"text": 'Arrian, "Anabasis of Alexander"', "refs": []},
    ]


def test_further_reading_whole_and_combined_chapters():
    items = parse_further_reading("Acts 5 & 12 · John 21 · Acts 2 · Acts 16:25")
    assert [i["refs"] for i in items] == [["ACT 5:1", "ACT 12:1"], ["JHN 21:1"], ["ACT 2:1"], ["ACT 16:25"]]


def test_non_scripture_items_with_numbers_are_plain():
    items = parse_further_reading(
        "Josephus, Antiquities 20.9.1 · Summa Theologiae I–II, Q. 95–96 · 1 Clement 5"
    )
    assert [i["refs"] for i in items] == [[], [], []]


def test_scripture_item_with_trailing_note_keeps_its_ref():
    assert parse_further_reading("Amos 7:7–8 (the plumb line)")[0]["refs"] == ["AMO 7:7-8"]


def test_description_without_scripture():
    d = parse_description((FIX / "10 Divine Lawgiver - description.txt").read_text())
    assert d["further_reading"] and all(i["refs"] == [] for i in d["further_reading"])
