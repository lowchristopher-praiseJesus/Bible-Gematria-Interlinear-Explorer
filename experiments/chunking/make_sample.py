"""Build a balanced, seeded sample of boundaries: N/2 real heading starts and N/2
non-boundaries, stratified over genre groups so poetry and law aren't swamped
by narrative. Each item is a position (KJV verse id) meaning "is there a
boundary immediately BEFORE this verse?"."""
import json
import random
import sys

from common import GROUND_TRUTH, SAMPLE, load_verses

# bnum ranges (1-66) -> genre group
GROUPS = {
    "law": range(1, 6), "history": range(6, 18), "poetry_wisdom": range(18, 23),
    "prophets": range(23, 40), "gospels_acts": range(40, 45), "epistles_rev": range(45, 67),
}
MIN_CONTEXT = 3      # need this many verses before, and 2 after, in the same book


def group_of(b):
    return next(g for g, r in GROUPS.items() if b in r)


def main(n=300, seed=7):
    truth = {int(k) for k in json.loads(GROUND_TRUTH.read_text())}
    verses = load_verses()
    by_id = {v["id"]: i for i, v in enumerate(verses)}
    eligible = {g: {"pos": [], "neg": []} for g in GROUPS}
    for i, v in enumerate(verses):
        if i < MIN_CONTEXT or i + 2 >= len(verses):
            continue
        window = verses[i - MIN_CONTEXT:i + 2]
        if len({w["bnum"] for w in window}) != 1:
            continue                      # keep windows inside one book
        eligible[group_of(v["bnum"])]["pos" if v["id"] in truth else "neg"].append(v["id"])
    rng = random.Random(seed)
    per_group = n // 2 // len(GROUPS)
    sample = []
    for g, pools in eligible.items():
        for label, key in ((1, "pos"), (0, "neg")):
            k = min(per_group, len(pools[key]))
            for vid in rng.sample(pools[key], k):
                sample.append({"id": vid, "group": g, "label": label})
            print(f"{g:14s} {key}: pool={len(pools[key]):5d} took={k}", file=sys.stderr)
    rng.shuffle(sample)
    SAMPLE.write_text(json.dumps(sample, indent=1))
    print(f"sample={len(sample)} positives={sum(s['label'] for s in sample)}")


if __name__ == "__main__":
    main()
