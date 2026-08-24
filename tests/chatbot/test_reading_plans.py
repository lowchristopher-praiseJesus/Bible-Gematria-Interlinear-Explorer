import pytest

from chatbot.data.reading_plans import (
    CANONICAL_ORDER,
    CHAPTER_COUNTS,
    CHRONOLOGICAL_ORDER,
    get_day_reading,
    get_reading_plan,
)


@pytest.mark.parametrize("plan", ["canonical", "chronological"])
def test_plan_has_365_days(plan):
    assert len(get_reading_plan(plan)) == 365


@pytest.mark.parametrize("plan", ["canonical", "chronological"])
def test_plan_covers_every_chapter_exactly_once(plan):
    schedule = get_reading_plan(plan)
    seen = []
    for day in schedule:
        for reading in day:
            seen.append((reading["book"], reading["chapter"]))
    assert len(seen) == len(set(seen)), "no chapter should be assigned twice"
    assert len(seen) == sum(CHAPTER_COUNTS.values())


@pytest.mark.parametrize("plan", ["canonical", "chronological"])
def test_chapters_within_a_book_stay_in_order(plan):
    schedule = get_reading_plan(plan)
    flat = [reading for day in schedule for reading in day]
    last_chapter_seen = {}
    for reading in flat:
        book, chapter = reading["book"], reading["chapter"]
        assert chapter == last_chapter_seen.get(book, 0) + 1
        last_chapter_seen[book] = chapter


def test_orders_are_permutations_of_the_same_66_books():
    assert set(CANONICAL_ORDER) == set(CHRONOLOGICAL_ORDER) == set(CHAPTER_COUNTS)
    assert len(CANONICAL_ORDER) == 66
    assert len(CHRONOLOGICAL_ORDER) == 66


def test_get_day_reading_returns_day_zero():
    first_day = get_day_reading("canonical", 0)
    assert first_day[0] == {"book": "Genesis", "chapter": 1}


def test_get_day_reading_rejects_out_of_range():
    with pytest.raises(ValueError):
        get_day_reading("canonical", 365)
    with pytest.raises(ValueError):
        get_day_reading("canonical", -1)
