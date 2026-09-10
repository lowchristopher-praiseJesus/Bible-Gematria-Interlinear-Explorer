"""Deterministic seed-verse picker for Devotional mode's "Pick one for me".

The client holds a per-browser random `seed` and a monotonic `cursor`
(count of rotation devotionals delivered). This deals DEVOTIONAL_POOL as a
shuffled deck: `divmod(cursor, len(pool))` splits into an epoch (how many
full passes through the deck) and an offset within the current pass. Each
epoch is its own permutation, seeded by `f"{seed}:{epoch}"`, so a full
year is repeat-free and year two is a fresh order rather than a replay.

Pure: no clock, no module-global RNG, no network, no LLM. The string seed
path of random.Random is stable across Python versions (hash() is not).
"""

import random
from typing import List

from chatbot.data.devotional_verses import DEVOTIONAL_POOL


def _shuffled_pool(seed: int, epoch: int) -> List[str]:
    rng = random.Random(f"{seed}:{epoch}")
    pool = list(DEVOTIONAL_POOL)
    rng.shuffle(pool)
    return pool


def pick_from_rotation(seed: int, cursor: int) -> str:
    """One USFM reference from DEVOTIONAL_POOL for this (seed, cursor)."""
    if cursor < 0:
        cursor = 0
    epoch, offset = divmod(cursor, len(DEVOTIONAL_POOL))
    return _shuffled_pool(seed, epoch)[offset]
