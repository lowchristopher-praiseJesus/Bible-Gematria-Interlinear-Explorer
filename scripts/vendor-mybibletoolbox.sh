#!/usr/bin/env bash
#
# Copy the pieces of mybibletoolbox-code that chatbot/tools.py imports at
# start-up into vendor/mybibletoolbox-code/ so Dockerfile.chatbot can bake them
# into the image (COPY can only see paths inside the build context).
#
# What gets vendored (all read at chatbot import time):
#   src/                                   multi-translation fetch + commentary merge + get_strongs
#   .claude/skills/quote-bible/scripts/    book_codes, biblehub_fetcher, biblehub_urls, version_codes
#   bible-study-tools/tool-registry.yaml   registry consumed by scripture_study.load_tool_registry()
#   data/commentary/ , data/strongs/       EMPTY stubs so src/config.py's import-time data-dir
#                                          check passes in degraded (no-corpus) mode. The real
#                                          4.4 GB corpus is bind-mounted over data/ for full fidelity.
#
# Usage:
#   scripts/vendor-mybibletoolbox.sh [SOURCE_DIR]
#   MYBIBLETOOLBOX_SRC=/path/to/mybibletoolbox-code scripts/vendor-mybibletoolbox.sh
#
# Default SOURCE_DIR: ~/Documents/mybibletoolbox-code
set -euo pipefail

SRC="${1:-${MYBIBLETOOLBOX_SRC:-$HOME/Documents/mybibletoolbox-code}}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$REPO_ROOT/vendor/mybibletoolbox-code"

if [ ! -d "$SRC/src" ]; then
  echo "error: '$SRC/src' not found. Point this at a mybibletoolbox-code checkout:" >&2
  echo "       scripts/vendor-mybibletoolbox.sh /path/to/mybibletoolbox-code" >&2
  exit 1
fi

echo "Vendoring from: $SRC"
echo "            to: $DEST"

rm -rf "$DEST"
mkdir -p "$DEST/.claude/skills/quote-bible" \
         "$DEST/bible-study-tools" \
         "$DEST/data/commentary" \
         "$DEST/data/strongs"

rsync -a --exclude '__pycache__/' --exclude '*.pyc' \
  "$SRC/src/" "$DEST/src/"

rsync -a --exclude '__pycache__/' --exclude '*.pyc' \
  "$SRC/.claude/skills/quote-bible/scripts" "$DEST/.claude/skills/quote-bible/"

cp "$SRC/bible-study-tools/tool-registry.yaml" \
   "$DEST/bible-study-tools/tool-registry.yaml"

# Keep the empty data subdirs in git so the image builds without the corpus.
touch "$DEST/data/commentary/.gitkeep" "$DEST/data/strongs/.gitkeep"

echo
echo "Done. Vendored tree size:"
du -sh "$DEST"
