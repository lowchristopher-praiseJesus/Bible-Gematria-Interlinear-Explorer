#!/usr/bin/env python3
"""Build the "Defend the Faith" manifest.

Reads the hand-edited track file (chatbot/data/apologetics_tracks.json) and
the shorts' source folder (default ~/Documents/Apologetics/Shorts, one
"<NN> <Subject> - script.txt" / "- description.txt" / "- thumbnail.jpg" per
short), fetches each uploaded short's title from YouTube oEmbed, and writes
chatbot/data/apologetics_shorts.json plus resized thumbnails under
frontend/public/apologetics/thumbs/. Re-run after adding a short, adding a
track, or renaming a video on YouTube.

    python scripts/import_apologetics_shorts.py [--source DIR] [--no-thumbs]
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Dict, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from chatbot.apologetics_import import parse_description, parse_short_filename  # noqa: E402

TRACKS_PATH = ROOT / "chatbot" / "data" / "apologetics_tracks.json"
MANIFEST_PATH = ROOT / "chatbot" / "data" / "apologetics_shorts.json"
THUMBS_DIR = ROOT / "frontend" / "public" / "apologetics" / "thumbs"
DEFAULT_SOURCE = Path.home() / "Documents" / "Apologetics" / "Shorts"
OEMBED = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={id}&format=json"


class ImportError_(Exception):
    """A loud import failure: missing files, unknown short, failed title fetch."""


def fetch_youtube_title(video_id: str) -> str:
    import httpx

    resp = httpx.get(OEMBED.format(id=video_id), timeout=10)
    resp.raise_for_status()
    return resp.json()["title"]


def _source_files(source: Path) -> Dict[int, Dict[str, Any]]:
    """Short number -> {subject, script, description, thumbnail} paths."""
    found: Dict[int, Dict[str, Any]] = {}
    for path in sorted(source.iterdir()):
        parsed = parse_short_filename(path.name)
        if not parsed:
            continue
        number, subject = parsed
        entry = found.setdefault(number, {"subject": subject})
        for kind, ending in (("script", " - script.txt"), ("description", " - description.txt"), ("thumbnail", " - thumbnail.jpg")):
            if path.name.endswith(ending):
                entry[kind] = path
    return {n: e for n, e in found.items() if "script" in e and "description" in e}


def build_manifest(source: Path, tracks: Dict[str, Any], fetch_title: Callable[[str], str]) -> Dict[str, Any]:
    files = _source_files(source)
    ids: Dict[str, str] = tracks.get("youtube_ids", {})
    for track in tracks["tracks"]:
        for n in track["shorts"]:
            if n not in files:
                raise ImportError_(f"track {track['id']!r} names short #{n}, but its script/description files are missing")

    shorts: Dict[str, Any] = {}
    for n in sorted(files):
        entry = files[n]
        video_id: Optional[str] = ids.get(str(n))
        if video_id:
            try:
                title = fetch_title(video_id)
            except Exception as exc:  # noqa: BLE001 — any failure is a loud import failure
                raise ImportError_(f"could not fetch the YouTube title for short #{n} ({video_id}): {exc}") from exc
        else:
            title = entry["subject"]
        desc = parse_description(entry["description"].read_text(encoding="utf-8"))
        shorts[str(n)] = {
            "number": n,
            "subject": entry["subject"],
            "title": title,
            "youtube_id": video_id,
            "summary": desc["summary"],
            "fiction_note": desc["fiction_note"],
            "script": entry["script"].read_text(encoding="utf-8"),
            "further_reading": desc["further_reading"],
            "thumbnail": f"/apologetics/thumbs/{n:02d}.jpg",
        }
    return {
        "tracks": [
            {"id": t["id"], "title": t["title"], "blurb": t.get("blurb", ""), "shorts": list(t["shorts"])}
            for t in tracks["tracks"]
        ],
        "shorts": shorts,
    }


def _write_thumbs(source: Path) -> int:
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for n, entry in _source_files(source).items():
        thumb = entry.get("thumbnail")
        if not thumb:
            continue
        dest = THUMBS_DIR / f"{n:02d}.jpg"
        subprocess.run(
            ["sips", "-Z", "480", "-s", "format", "jpeg", "-s", "formatOptions", "70", str(thumb), "--out", str(dest)],
            check=True, capture_output=True,
        )
        count += 1
    return count


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    ap.add_argument("--no-thumbs", action="store_true")
    args = ap.parse_args(argv)
    tracks = json.loads(TRACKS_PATH.read_text(encoding="utf-8"))
    try:
        manifest = build_manifest(args.source.expanduser(), tracks, fetch_youtube_title)
    except ImportError_ as exc:
        print(f"import failed: {exc}", file=sys.stderr)
        return 1
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(manifest['shorts'])} shorts, {len(manifest['tracks'])} tracks -> {MANIFEST_PATH.relative_to(ROOT)}")
    if not args.no_thumbs:
        print(f"wrote {_write_thumbs(args.source.expanduser())} thumbnails -> {THUMBS_DIR.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
