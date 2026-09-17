import pytest

from chatbot import devotional_of_day as dod


@pytest.fixture
def db():
    database = dod.get_db("sqlite:///:memory:")
    dod.init_db(database)
    return database


def test_get_for_date_returns_none_when_absent(db):
    assert dod.get_for_date(db, "2026-09-17") is None


def test_capture_then_get_round_trips(db):
    won = dod.capture_if_absent(
        db,
        reference="JHN 14:27",
        translations={"eng-KJV": "Peace I leave with you..."},
        text="Some devotional text.",
        date_gmt8="2026-09-17",
    )
    assert won is True

    row = dod.get_for_date(db, "2026-09-17")
    assert row["reference"] == "JHN 14:27"
    assert row["translations"] == {"eng-KJV": "Peace I leave with you..."}
    assert row["text"] == "Some devotional text."


def test_second_capture_same_day_loses_the_race(db):
    first = dod.capture_if_absent(
        db, reference="JHN 14:27", translations={}, text="First.", date_gmt8="2026-09-17",
    )
    second = dod.capture_if_absent(
        db, reference="PSA 23:1", translations={}, text="Second.", date_gmt8="2026-09-17",
    )
    assert first is True
    assert second is False
    # The canonical row stays the first writer's — the "losing" caller's own
    # generation is simply never persisted, never overwrites it.
    assert dod.get_for_date(db, "2026-09-17")["text"] == "First."


def test_different_dates_are_independent(db):
    dod.capture_if_absent(db, reference="A", translations={}, text="Day one.", date_gmt8="2026-09-17")
    dod.capture_if_absent(db, reference="B", translations={}, text="Day two.", date_gmt8="2026-09-18")
    assert dod.get_for_date(db, "2026-09-17")["text"] == "Day one."
    assert dod.get_for_date(db, "2026-09-18")["text"] == "Day two."


def test_get_today_uses_todays_date(db, monkeypatch):
    monkeypatch.setattr(dod, "today_gmt8", lambda: "2026-09-17")
    dod.capture_if_absent(db, reference="A", translations={}, text="Today's pick.", date_gmt8="2026-09-17")
    assert dod.get_today(db)["text"] == "Today's pick."


def test_today_gmt8_uses_a_fixed_utc_plus_8_offset(monkeypatch):
    import datetime as real_datetime

    class FixedDatetime(real_datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            # 2026-09-17 20:00 UTC -> 2026-09-18 04:00 GMT+8: the date rolls
            # over even though it's still "today" in UTC.
            return real_datetime.datetime(2026, 9, 17, 20, 0, tzinfo=real_datetime.timezone.utc)

    monkeypatch.setattr(dod, "datetime", FixedDatetime)
    assert dod.today_gmt8() == "2026-09-18"
