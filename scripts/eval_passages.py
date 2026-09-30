# scripts/eval_passages.py
"""Live retrieval eval for "Find passages" (uses the real embedder, LLM and
JEV — costs real API calls, so it is manual):

    set -a; . ./.env; set +a
    python scripts/eval_passages.py [--no-jev] [--limit N]

Reports, over chatbot/data/passage_eval.py:
  recall@10   share of must-see verses that fall inside a returned passage
  off-topic   share of off-topic queries that correctly return nothing
for the full pipeline and (unless --no-jev) again with JEV removed, so the
comparison shows whether the JEV filter earns its place. Tune the
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


async def _run(label: str, limit) -> None:
    index = passage_index.get_index()
    assert index is not None, "passage index is unavailable"
    total = hit = 0
    per_group = {}
    for group, items in (("concept", CONCEPT), ("passage", PASSAGE)):
        g_total = g_hit = 0
        for item in items[:limit]:
            result = await passage_search.search(item["query"])
            passages = (result.get("artifacts") or [{"params": {"passages": []}}])[0]["params"]["passages"]
            g_total += len(item["must_see"])
            g_hit += _covered(index, passages, item["must_see"])
        per_group[group] = (g_hit, g_total)
        total, hit = total + g_total, hit + g_hit
    quiet = 0
    for query in OFF_TOPIC[:limit]:
        result = await passage_search.search(query)
        quiet += 0 if result.get("artifacts") else 1
    print(f"[{label}] recall@10 overall {hit}/{total} = {hit / max(total, 1):.0%}; "
          + ", ".join(f"{g} {h}/{t}" for g, (h, t) in per_group.items())
          + f"; off-topic returning nothing {quiet}/{len(OFF_TOPIC[:limit])}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-jev", action="store_true", help="only run the without-JEV arm")
    parser.add_argument("--limit", type=int, default=None, help="first N queries per group (cheap smoke run)")
    args = parser.parse_args()
    if not args.no_jev and os.getenv("TYPESAFE_API_KEY", "").strip():
        asyncio.run(_run("with JEV", args.limit))
    saved = os.environ.pop("TYPESAFE_API_KEY", None)
    try:
        asyncio.run(_run("without JEV", args.limit))
    finally:
        if saved is not None:
            os.environ["TYPESAFE_API_KEY"] = saved


if __name__ == "__main__":
    main()
