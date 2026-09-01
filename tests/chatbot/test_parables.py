from chatbot.data.parables import PARABLES, get_parable


def test_parables_have_unique_ids():
    ids = [p["id"] for p in PARABLES]
    assert len(ids) == len(set(ids))
    assert len(PARABLES) >= 30


def test_parables_have_required_fields():
    for p in PARABLES:
        assert p["id"] and p["name"] and p["reference"]
        assert ":" in p["reference"]


def test_get_parable_known_id():
    prodigal = get_parable("prodigal_son")
    assert prodigal is not None
    assert prodigal["reference"] == "Luke 15:11-32"


def test_get_parable_unknown_id():
    assert get_parable("not_a_real_parable") is None
