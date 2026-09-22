import re
from pathlib import Path

from chatbot import character_loader

CHARACTERS_DIR = Path(__file__).resolve().parents[2] / "characters"


def _readme_ids():
    text = (CHARACTERS_DIR / "README.md").read_text(encoding="utf-8")
    return re.findall(r"^\|\s*\[[^\]]+\]\(([a-z_]+)\.md\)", text, flags=re.MULTILINE)


def test_lists_every_profile_except_jesus():
    ids = [c["id"] for c in character_loader.list_characters()]
    assert "jesus" not in ids
    assert set(ids) == set(_readme_ids()) - {"jesus"}
    assert len(ids) == len(set(ids)) == 49


def test_every_listed_character_has_a_profile_file():
    for c in character_loader.list_characters():
        assert (CHARACTERS_DIR / f"{c['id']}.md").is_file(), c["id"]


def test_entry_shape_comes_from_the_readme_tables():
    by_id = {c["id"]: c for c in character_loader.list_characters()}
    david = by_id["david"]
    assert david["name"] == "David"
    assert david["testament"] == "OT"
    assert david["summary"].startswith("The shepherd boy from Bethlehem")
    assert by_id["mary_mother"]["name"] == "Mary (Mother of Jesus)"
    assert by_id["peter"]["testament"] == "NT"


def test_testament_split_is_39_old_and_10_new():
    entries = character_loader.list_characters()
    assert sum(c["testament"] == "OT" for c in entries) == 39
    assert sum(c["testament"] == "NT" for c in entries) == 10


def test_get_character_returns_entry_plus_full_profile():
    c = character_loader.get_character("david")
    assert c["name"] == "David"
    assert "Goliath" in c["profile"]
    assert "Bathsheba" in c["profile"]


def test_profile_has_relative_markdown_links_flattened_to_names():
    profile = character_loader.get_character("david")["profile"]
    assert ".md)" not in profile
    assert "Goliath" in profile


def test_jesus_is_excluded_even_by_id():
    assert character_loader.get_character("jesus") is None


def test_unknown_or_unsafe_id_returns_none():
    assert character_loader.get_character("not-a-person") is None
    assert character_loader.get_character("../README") is None
    assert character_loader.get_character("") is None


def test_chatbot_image_ships_the_profiles():
    # The loader reads <repo root>/characters/, i.e. /app/characters in the
    # container; without this COPY the picker would silently be empty.
    dockerfile = (CHARACTERS_DIR.parent / "Dockerfile.chatbot").read_text(encoding="utf-8")
    assert re.search(r"^COPY\s+characters/\s+\./characters/", dockerfile, flags=re.MULTILINE)
