"""Turn per-boundary JEV scores into chunks with deterministic rules, then compare
the cuts with BSB headings. Threshold/size rules live here, not in JEV.

Rules: cut before verse i if score>=THRESHOLD, the previous verse is not a speech
introduction ("...saying,"), and the chunk so far has >= MIN verses. A chunk that
reaches MAX verses is cut at its highest-scoring boundary (>= MIN from its start)."""
import json
import re
import statistics
import sys

from common import HERE, load_verses
from score_books import BOOKS, CACHE

THRESHOLD, MIN_V, MAX_V = 0.7, 2, 16
INTRO_RE = re.compile(r"(saying|said|spake|spoke|answered|and said)[,:]?\s*[\"“”]?$", re.I)


def chunk_book(vs, scores):
    """vs: verses of one book. Returns list of (start_idx, end_idx_exclusive)."""
    chunks, start = [], 0
    for i in range(1, len(vs) + 1):
        n = i - start
        if i == len(vs):
            chunks.append((start, i)); break
        s = scores.get(str(vs[i]["id"]), 0.0)
        intro = bool(INTRO_RE.search(vs[i - 1]["text"].rstrip()))
        if n >= MIN_V and s >= THRESHOLD and not intro:
            chunks.append((start, i)); start = i
        elif n >= MAX_V:
            cands = [(scores.get(str(vs[j]["id"]), 0.0), j) for j in range(start + MIN_V, i + 1)
                     if j < len(vs) and not INTRO_RE.search(vs[j - 1]["text"].rstrip())]
            cut = max(cands)[1] if cands else i
            chunks.append((start, cut)); start = cut
    return [c for c in chunks if c[1] > c[0]]


def main():
    verses = load_verses()
    scores = json.loads(CACHE.read_text())
    truth = {int(k): h for k, h in json.load(open(HERE / "ground_truth.json")).items()}
    chunks_json = []
    out, tot = [], dict(cuts=0, hit0=0, hit1=0, bsb=0, bsb_hit0=0, bsb_hit1=0)
    books = {v['bnum']: v['ref'].rsplit(' ', 1)[0] for v in verses if v['vnum'] == 1 and v['cnum'] == 1} if '--all' in sys.argv else BOOKS
    for bnum, name in books.items():
        vs = [v for v in verses if v["bnum"] == bnum]
        chunks = chunk_book(vs, scores)
        cut_ids = {vs[a]["id"] for a, _ in chunks if a > 0}
        bsb = {i for i in truth if vs[0]["id"] <= i <= vs[-1]["id"] and i != vs[0]["id"]}
        hit0 = len(cut_ids & bsb)
        near = lambda x, S: any(abs(x - y) <= 1 for y in S)
        hit1 = sum(1 for c in cut_ids if near(c, bsb))
        bsb_hit1 = sum(1 for b in bsb if near(b, cut_ids))
        lens = [b - a for a, b in chunks]
        print(f"{name:12s} verses={len(vs):4d} chunks={len(chunks):4d} avg={statistics.mean(lens):.1f} "
              f"max={max(lens)} | cuts on BSB heading: exact {hit0}/{len(cut_ids)}, ±1 {hit1}/{len(cut_ids)} | "
              f"BSB headings recovered: exact {hit0}/{len(bsb)}, ±1 {bsb_hit1}/{len(bsb)}")
        for k, v in dict(cuts=len(cut_ids), hit0=hit0, hit1=hit1, bsb=len(bsb), bsb_hit0=hit0, bsb_hit1=bsb_hit1).items():
            tot[k] += v
        chunks_json += [[vs[a]['id'], vs[b-1]['id']] for a, b in chunks]
        for a, b in chunks:
            out.append(f"### {vs[a]['ref']} – {vs[b-1]['ref']}  ({b-a} verses)"
                       + (f"  — BSB: {truth[vs[a]['id']]}" if vs[a]['id'] in truth else "") + "\n"
                       + " ".join(f"[{v['vnum']}] {v['text']}" for v in vs[a:b]) + "\n")
    print(f"TOTAL cuts={tot['cuts']}: precision exact {tot['hit0']/tot['cuts']:.2f}, ±1 {tot['hit1']/tot['cuts']:.2f} | "
          f"recall exact {tot['bsb_hit0']/tot['bsb']:.2f}, ±1 {tot['bsb_hit1']/tot['bsb']:.2f}")
    (HERE / "results" / ("chunks_all.md" if "--all" in sys.argv else "chunks.md")).write_text("\n".join(out))
    if "--all" in sys.argv:
        (HERE / "results" / "chunks_all.json").write_text(json.dumps(chunks_json))


if __name__ == "__main__":
    main()
