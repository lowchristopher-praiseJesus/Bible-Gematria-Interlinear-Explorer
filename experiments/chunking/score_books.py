"""Score every boundary in a sample of books with JEV (one book per genre).
Resumable: results/boundary_scores.json maps KJV verse id -> P(new_section)."""
import asyncio
import json
import os
import sys
import time

from common import HERE, load_verses
from run_experiment import BEFORE, AFTER, score_jev

BOOKS = {3: "Leviticus", 17: "Esther", 20: "Proverbs", 30: "Amos", 41: "Mark", 45: "Romans"}
CACHE = HERE / "results" / "boundary_scores.json"


def main():
    all_books = "--all" in sys.argv
    if not os.getenv("TYPESAFE_API_KEY", "").strip():
        sys.exit("TYPESAFE_API_KEY not set")
    verses = load_verses()
    CACHE.parent.mkdir(exist_ok=True)
    scores = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = []
    for i, v in enumerate(verses):
        if (not all_books and v["bnum"] not in BOOKS) or str(v["id"]) in scores:
            continue
        if i < BEFORE or i + AFTER > len(verses):
            continue
        window = verses[i - BEFORE:i + AFTER]
        if len({w["bnum"] for w in window}) != 1:
            continue                         # first verses of a book: no context
        todo.append((v["id"],
                     " ".join(w["text"] for w in verses[i - BEFORE:i]),
                     " ".join(w["text"] for w in verses[i:i + AFTER])))
    print(f"{len(todo)} boundaries to score ({len(scores)} cached)")
    t0 = time.perf_counter()
    for start in range(0, len(todo), 500):          # save progress every 500
        batch = todo[start:start + 500]
        s, lat, fails = asyncio.run(score_jev([(b, a) for _, b, a in batch]))
        for (vid, _, _), val in zip(batch, s):
            if val is not None:
                scores[str(vid)] = val
        CACHE.write_text(json.dumps(scores))
        print(f"  {start + len(batch)}/{len(todo)} done, failures so far in batch: {fails}")
    print(f"finished in {time.perf_counter() - t0:.0f}s; {len(scores)} scores cached")


if __name__ == "__main__":
    main()
