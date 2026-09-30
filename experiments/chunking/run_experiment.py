"""Score three boundary detectors against BSB section headings on sample.json.

  tfidf  : 1 - cosine(TF-IDF of 3 verses before, 2 verses from the boundary on). Free baseline.
  dense  : same, with sentence-transformers embeddings (only if installed; --dense MODEL).
  jev    : TypeSafe JEV Choice per boundary (needs TYPESAFE_API_KEY; skipped otherwise).

Metrics per method: ROC-AUC, best-threshold F1, and per-genre AUC. Latency and
request count are reported for JEV so cost can be extrapolated to 31,102 boundaries.
Results are cached in results/ so a re-run never re-pays for JEV calls."""
import argparse
import asyncio
import json
import os
import time
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import f1_score, precision_recall_curve, roc_auc_score

from common import HERE, SAMPLE, load_verses

BEFORE, AFTER = 3, 2
RESULTS = HERE / "results"
OPTIONS = ("new_section", "same_section")
CRITERIA = {
    "new_section": {
        "what": "The last verse of the passage begins a new section: a new topic, scene, speaker "
                "address, time or place, or a shift from one kind of material to another.",
        "examples": ["A story about a journey followed by a verse opening a new episode at a different place."],
    },
    "same_section": {
        "what": "The last verse continues the same section: the same thought, scene or "
                "sentence-level argument carries on from the verses before it.",
        "examples": ["A verse that completes a sentence begun in the previous verse."],
    },
}


def windows(sample, verses):
    idx = {v["id"]: i for i, v in enumerate(verses)}
    out = []
    for s in sample:
        i = idx[s["id"]]
        out.append((" ".join(v["text"] for v in verses[i - BEFORE:i]),
                    " ".join(v["text"] for v in verses[i:i + AFTER])))
    return out


def score_tfidf(wins):
    corpus = [t for pair in wins for t in pair]
    m = TfidfVectorizer(stop_words="english", sublinear_tf=True).fit_transform(corpus)
    scores = []
    for k in range(len(wins)):
        a, b = m[2 * k], m[2 * k + 1]
        na, nb = np.sqrt(a.multiply(a).sum()), np.sqrt(b.multiply(b).sum())
        cos = (a.multiply(b).sum() / (na * nb)) if na and nb else 0.0
        scores.append(1.0 - float(cos))
    return scores


def score_dense(wins, model_name):
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(model_name)
    e = model.encode([t for pair in wins for t in pair], normalize_embeddings=True, batch_size=64)
    return [1.0 - float(np.dot(e[2 * k], e[2 * k + 1])) for k in range(len(wins))]


async def score_jev(wins, concurrency=8):
    import httpx
    key = os.getenv("TYPESAFE_API_KEY", "").strip()
    url = os.getenv("TYPESAFE_API_URL", "https://api.typesafe.ai/v1/systemone")
    model = os.getenv("TYPESAFE_MODEL", "jev-latest")
    sem = asyncio.Semaphore(concurrency)
    lat, failures = [], 0

    async def one(client, before, after):
        nonlocal failures
        body = {
            "state": {"passage_so_far": before, "last_verse_and_next": after},
            "model": model,
            "questions": {"c0": {
                "type": "choice",
                "instructions": "Does the first verse of 'last_verse_and_next' begin a new section "
                                "relative to 'passage_so_far'?",
                "criteria": CRITERIA}},
        }
        async with sem:
            t0 = time.perf_counter()
            try:
                r = await client.post(url, json=body, headers={"Authorization": f"Bearer {key}"})
                r.raise_for_status()
                ans = r.json()["answers"]["c0"]
                lat.append(time.perf_counter() - t0)
                return float(ans["probabilities"].get("new_section", 0.0))
            except Exception as exc:
                failures += 1
                print("JEV failure:", repr(exc)[:120])
                return None

    async with httpx.AsyncClient(timeout=30) as client:
        scores = await asyncio.gather(*(one(client, b, a) for b, a in wins))
    return scores, lat, failures


def best_f1(y, s):
    p, r, th = precision_recall_curve(y, s)
    f = 2 * p * r / np.maximum(p + r, 1e-9)
    k = int(np.nanargmax(f[:-1]))
    return float(f[k]), float(th[k])


def report(name, y, s, groups):
    keep = [i for i, v in enumerate(s) if v is not None]
    y_, s_ = np.array([y[i] for i in keep]), np.array([s[i] for i in keep])
    line = {"method": name, "n": len(keep), "auc": round(roc_auc_score(y_, s_), 3)}
    line["best_f1"], line["at_threshold"] = (round(x, 3) for x in best_f1(y_, s_))
    per = {}
    for g in sorted(set(groups)):
        ix = [j for j, i in enumerate(keep) if groups[i] == g]
        yy, ss = y_[ix], s_[ix]
        per[g] = round(roc_auc_score(yy, ss), 3) if len(set(yy)) == 2 else None
    line["auc_by_genre"] = per
    return line


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dense", metavar="MODEL", help="e.g. BAAI/bge-small-en-v1.5 (needs sentence-transformers)")
    ap.add_argument("--no-jev", action="store_true")
    ap.add_argument("--limit", type=int, help="score only the first N sample items (cheap smoke test)")
    a = ap.parse_args()

    verses, sample = load_verses(), json.loads(SAMPLE.read_text())
    if a.limit:
        sample = sample[:a.limit]
    wins = windows(sample, verses)
    y, groups = [s["label"] for s in sample], [s["group"] for s in sample]
    RESULTS.mkdir(exist_ok=True)
    out = [report("tfidf", y, score_tfidf(wins), groups)]
    if a.dense:
        out.append(report(f"dense:{a.dense}", y, score_dense(wins, a.dense), groups))
    if not a.no_jev:
        if not os.getenv("TYPESAFE_API_KEY", "").strip():
            print("TYPESAFE_API_KEY not set: skipping JEV")
        else:
            cache = RESULTS / f"jev_{len(sample)}.json"
            if cache.exists():
                s = json.loads(cache.read_text())["scores"]
            else:
                t0 = time.perf_counter()
                s, lat, fails = asyncio.run(score_jev(wins))
                cache.write_text(json.dumps({"scores": s}))
                print(f"JEV: {len(wins)} requests in {time.perf_counter()-t0:.1f}s, "
                      f"median latency {np.median(lat):.2f}s, failures {fails}")
            out.append(report("jev", y, s, groups))
    for line in out:
        print(json.dumps(line))
    (RESULTS / "summary.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
