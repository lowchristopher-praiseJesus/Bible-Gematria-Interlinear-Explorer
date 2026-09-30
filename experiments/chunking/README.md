# Chunk-boundary experiment

Produced `chatbot/data/passage_chunks.json`.

1. `fetch_ground_truth.py` — BSB section headings (public domain, bible.helloao.org) → `ground_truth.json`.
2. `make_sample.py` + `run_experiment.py` — 300 balanced boundaries; JEV vs a TF-IDF baseline (JEV AUC 0.924 vs 0.635).
3. `score_books.py --all` — JEV P(new_section) for every boundary (≈30,800 calls) → `results/boundary_scores.json` (gitignored; re-cutting needs no new calls).
4. `build_chunks.py --all` — threshold 0.7, min 2 / max 16 verses, no cut after a speech introduction ("…saying,") → `results/chunks_all.json`, copied to `chatbot/data/passage_chunks.json`.

Needs `TYPESAFE_API_KEY` (`set -a; . ../../.env; set +a`).
