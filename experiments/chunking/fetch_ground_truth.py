"""Download BSB section headings (public domain, bible.helloao.org) and map each
to the KJV verse it precedes. Writes ground_truth.json = {kjv_verse_id: heading}.

A heading before BSB verse N of chapter C marks a boundary between the previous
verse and verse N. Verse numbering differs slightly between BSB and KJV in a few
places (Psalm titles, 3 John, etc.); headings that don't map to a KJV verse are
counted and dropped."""
import json
import sys
import time

import httpx

from common import GROUND_TRUTH, load_verses

BASE = "https://bible.helloao.org/api/BSB"


def main():
    verses = load_verses()
    by_bcv = {(v["bnum"], v["cnum"], v["vnum"]): v["id"] for v in verses}
    with httpx.Client(timeout=30, follow_redirects=True) as c:
        books = c.get(f"{BASE}/books.json").json()["books"]
        truth, dropped, chapters = {}, 0, 0
        for order, b in enumerate(books, start=1):
            for ch in range(1, b["numberOfChapters"] + 1):
                for attempt in range(3):
                    try:
                        data = c.get(f"{BASE}/{b['id']}/{ch}.json").json()
                        break
                    except Exception:
                        time.sleep(1)
                else:
                    sys.exit(f"failed {b['id']} {ch}")
                chapters += 1
                pending = None
                for item in data["chapter"]["content"]:
                    if item["type"] == "heading":
                        pending = " ".join(str(x) for x in item["content"])
                    elif item["type"] == "verse" and pending:
                        vid = by_bcv.get((order, ch, item["number"]))
                        if vid is None:
                            dropped += 1
                        else:
                            truth[str(vid)] = pending
                        pending = None
            print(b["id"], len(truth), file=sys.stderr)
    GROUND_TRUTH.write_text(json.dumps(truth, indent=0))
    print(f"chapters={chapters} headings={len(truth)} dropped={dropped}")


if __name__ == "__main__":
    main()
