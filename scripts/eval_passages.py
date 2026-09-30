# scripts/eval_passages.py
"""Live retrieval eval for "Find passages" (uses the real embedder, LLM and
JEV — costs real API calls, so it is manual):

    set -a; . ./.env; set +a
    python scripts/eval_passages.py [--no-jev] [--limit N]

Reports, over chatbot/data/passage_eval.py:
  recall@10   share of must-see verses that fall inside a returned passage
  off-topic   share of off-topic queries that correctly return nothing
for the full pipeline and (unless --no-jev) again with JEV removed, so the
comparison shows whether the JEV filter earns its place. The with-JEV arm
also prints how many result sets were really JEV-verified; JEV fails open, so
anything below 100% means that arm is not a clean JEV measurement. Off-topic
results are classified quiet / returned results / other (unavailable, scope,
length or empty responses are "other", not a correct "nothing"). Without JEV
retrieval always returns something, so that arm's off-topic figure is
informational only. Tune the
thresholds in chatbot/passage_rank.py only with this script."""
import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chatbot import passage_index, passage_search  # noqa: E402
from chatbot.data.passage_eval import CONCEPT, OFF_TOPIC, PASSAGE  # noqa: E402


def _covered(index, passages, must_see) -> int:
    span_of = {c.ref: (c.first_id, c.last_id) for c in index.chunks}      # chunk refs are unique
    spans = [span_of[p["ref"]] for p in passages if p["ref"] in span_of]
    hits = 0
    for ref in must_see:
        vid = index.verse_id_for_ref(ref)
        if vid and any(a <= vid <= b for a, b in spans):
            hits += 1
    return hits


def _artifacts(result) -> list:
    return result.get("artifacts") or []


def _classify_off_topic(result) -> str:
    """'quiet' (correct nothing), 'returned' (results shown) or 'other'."""
    if _artifacts(result):
        return "returned"
    route = result.get("route") or ""
    if route.startswith("passages → JEV filtered all") or route.startswith("passages → no candidates"):
        return "quiet"
    return "other"


def _verified_counts(results) -> tuple:
    """(n_verified, n_with_results) over a list of search results."""
    with_results = [r for r in results if _artifacts(r)]
    return sum(1 for r in with_results if _artifacts(r)[0]["params"].get("verified")), len(with_results)


async def _run(label: str, limit, jev: bool) -> None:
    index = passage_index.get_index()
    assert index is not None, "passage index is unavailable"
    total = hit = 0
    per_group = {}
    results = []
    for group, items in (("concept", CONCEPT), ("passage", PASSAGE)):
        g_total = g_hit = 0
        for item in items[:limit]:
            result = await passage_search.search(item["query"])
            results.append(result)
            passages = (_artifacts(result) or [{"params": {"passages": []}}])[0]["params"]["passages"]
            g_total += len(item["must_see"])
            g_hit += _covered(index, passages, item["must_see"])
        per_group[group] = (g_hit, g_total)
        total, hit = total + g_total, hit + g_hit
    counts = {"quiet": 0, "returned": 0, "other": 0}
    off = OFF_TOPIC[:limit]
    for query in off:
        counts[_classify_off_topic(await passage_search.search(query))] += 1
    n_ver, n_res = _verified_counts(results)
    print(f"[{label}] recall@10 overall {hit}/{total} = {hit / max(total, 1):.0%}; "
          + ", ".join(f"{g} {h}/{t}" for g, (h, t) in per_group.items())
          + f"; verified {n_ver}/{n_res} queries" + ("" if jev else " (JEV disabled)")
          + f"; off-topic: quiet {counts['quiet']}/{len(off)}, returned results {counts['returned']}, other {counts['other']}"
          + ("" if jev else " (informational: without JEV, retrieval always returns something)"))
    if jev and n_ver < n_res:
        print(f"WARNING: JEV fell open for {n_res - n_ver} queries — this arm is NOT a clean JEV measurement")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-jev", action="store_true", help="only run the without-JEV arm")
    parser.add_argument("--limit", type=int, default=None, help="first N queries per group (cheap smoke run)")
    args = parser.parse_args()
    if not args.no_jev and os.getenv("TYPESAFE_API_KEY", "").strip():
        asyncio.run(_run("with JEV", args.limit, True))
    elif not args.no_jev:
        print("TYPESAFE_API_KEY not set: skipping the with-JEV arm")
    saved = os.environ.pop("TYPESAFE_API_KEY", None)
    try:
        asyncio.run(_run("without JEV", args.limit, False))
    finally:
        if saved is not None:
            os.environ["TYPESAFE_API_KEY"] = saved


if __name__ == "__main__":
    main()
