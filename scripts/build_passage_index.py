# scripts/build_passage_index.py
"""Embed every chunk (book/chapter prepended) and write the committed index
files. Run once, or whenever passage_chunks.json or the model changes:

    python scripts/build_passage_index.py

Outputs chatbot/data/passage_embeddings.npy (float32, one row per chunk,
L2-normalised), passage_verse_embeddings.npy (float16, one row per verse) and
passage_index_meta.json (model, dim, chunk count, verse_rows)."""
import json
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chatbot import passage_embed, passage_index  # noqa: E402

BATCH = 256


def main() -> None:
    verses = passage_index.load_verses()
    pairs = json.loads(passage_index.CHUNKS_FILE.read_text())
    chunks = passage_index.build_chunks(pairs, verses)
    print(f"embedding {len(chunks)} chunks with {passage_embed.MODEL_NAME}")
    started = time.time()
    parts = []
    for i in range(0, len(chunks), BATCH):
        parts.append(passage_embed.embed_passages([c.embed_text for c in chunks[i:i + BATCH]]))
        print(f"  {min(i + BATCH, len(chunks))}/{len(chunks)}")
    vectors = np.concatenate(parts).astype(np.float32)
    assert vectors.shape == (len(chunks), passage_embed.EMBED_DIM), vectors.shape
    np.save(passage_index.VECTORS_FILE, vectors)
    # Per-verse vectors (max-pooled per chunk at query time); ref-prefixed like "Genesis 1:1 — text".
    verse_parts = []
    for i in range(0, len(verses), BATCH):
        verse_parts.append(passage_embed.embed_passages([f"{v.ref} — {v.text}" for v in verses[i:i + BATCH]]))
        print(f"  verses {min(i + BATCH, len(verses))}/{len(verses)}")
    verse_vectors = np.concatenate(verse_parts).astype(np.float32)
    assert verse_vectors.shape == (len(verses), passage_embed.EMBED_DIM), verse_vectors.shape
    np.save(passage_index.VERSE_VECTORS_FILE, verse_vectors.astype(np.float16))  # normalised in fp32, stored fp16
    passage_index.META_FILE.write_text(json.dumps({
        "model": passage_embed.MODEL_NAME,
        "dim": int(vectors.shape[1]),
        "chunks": len(chunks),
        "verse_rows": len(verses),
        "built": date.today().isoformat(),
    }, indent=1))
    print(f"done in {time.time() - started:.0f}s → {passage_index.VECTORS_FILE.name} "
          f"({passage_index.VECTORS_FILE.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
