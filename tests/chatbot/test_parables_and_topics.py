from chatbot.data.parables import PARABLES, get_parable
from chatbot.data.topics import TOPICS, get_topic


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


def test_topics_have_unique_ids():
    ids = [t["id"] for t in TOPICS]
    assert len(ids) == len(set(ids))
    assert len(TOPICS) >= 5


def test_topics_have_seed_references():
    for t in TOPICS:
        assert t["id"] and t["name"]
        assert len(t["seed_references"]) >= 1
        for ref in t["seed_references"]:
            assert ":" in ref


def test_get_topic_known_and_unknown():
    holiness = get_topic("holiness")
    assert holiness is not None
    assert get_topic("not_a_real_topic") is None
