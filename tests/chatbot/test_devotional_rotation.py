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


# A failure here means the (seed,cursor)->verse mapping changed — existing
# clients' decks were silently reshuffled and will re-serve verses. Only
# update these literals for a DELIBERATE rotation reset. The mapping depends
# on the seed-string format f"{seed}:{epoch}", DEVOTIONAL_POOL's exact
# contents/order, and random.shuffle's algorithm — all otherwise untested.
def test_rotation_sequence_is_pinned():
    assert pick_from_rotation(42, 0) == "GEN 8:22"
    assert pick_from_rotation(42, 1) == "PRO 3:12"
    # Epoch 1 (cursor == len(pool)) — a fresh permutation, offset 0.
    assert pick_from_rotation(7, N) == "DEU 8:3"
