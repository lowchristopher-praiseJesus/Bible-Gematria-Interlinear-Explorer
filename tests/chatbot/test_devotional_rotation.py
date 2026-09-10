from chatbot.data.devotional_verses import DEVOTIONAL_POOL
from chatbot.devotional_rotation import pick_from_rotation

N = len(DEVOTIONAL_POOL)


def test_same_seed_and_cursor_is_deterministic():
    a = pick_from_rotation(42, 7)
    b = pick_from_rotation(42, 7)
    assert a == b
    assert a in DEVOTIONAL_POOL


def test_one_epoch_covers_every_verse_exactly_once():
    picks = [pick_from_rotation(1234, c) for c in range(N)]
    assert sorted(picks) == sorted(DEVOTIONAL_POOL)
    assert len(set(picks)) == N


def test_different_seeds_give_a_different_order():
    order_a = [pick_from_rotation(1, c) for c in range(N)]
    order_b = [pick_from_rotation(2, c) for c in range(N)]
    assert order_a != order_b


def test_cursor_past_the_pool_starts_a_new_epoch_without_raising():
    first_epoch = [pick_from_rotation(9, c) for c in range(N)]
    second_epoch = [pick_from_rotation(9, c) for c in range(N, 2 * N)]
    assert sorted(second_epoch) == sorted(DEVOTIONAL_POOL)  # still a permutation
    assert first_epoch != second_epoch                      # reshuffled
    assert pick_from_rotation(9, N * 5 + 3) in DEVOTIONAL_POOL


def test_negative_cursor_clamps_to_zero():
    assert pick_from_rotation(77, -5) == pick_from_rotation(77, 0)
