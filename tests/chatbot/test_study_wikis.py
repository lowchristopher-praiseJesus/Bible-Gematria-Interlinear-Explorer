from chatbot.data.study_wikis import STUDY_WIKI_LIBRARY, get_registered


def test_library_has_the_present_day_ministry_series():
    ids = [w["id"] for w in STUDY_WIKI_LIBRARY]
    assert "present-day-ministry-of-jesus" in ids
    assert len(ids) == len(set(ids))  # unique ids


def test_registered_entries_have_required_fields():
    for entry in STUDY_WIKI_LIBRARY:
        assert entry["id"] and entry["title"] and entry["speaker"] and entry["description"] and entry["path"]


def test_get_registered_known_and_unknown():
    entry = get_registered("present-day-ministry-of-jesus")
    assert entry is not None
    assert entry["speaker"] == "Joseph Prince"
    assert get_registered("not-a-real-series") is None
