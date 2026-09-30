# "Find passages" mode — design

Date: 2026-09-30 · Status: draft for review

## Purpose

A user gives either a **passage** ("Romans 8:28", "John 3:16–21") or a
**statement or question** ("Where is the rapture talked about in the Bible?") and
gets back a ranked list of relevant Bible passages. Every result has a short
reason and a link into the explorer.

Success: for a concept query the KJV words differently from ("rapture" → "caught
up", "twinkling of an eye"), the passages a reasonable reader expects appear in
the top 10; an off-topic query returns an honest "nothing found".

Out of scope (YAGNI): free-text synthesis across passages, streaming, a
"related passages" panel on `/explorer`, retrieval inside chat or Deep Study,
non-KJV translations, Apocrypha, non-English queries.

## Decisions taken during brainstorming

- Output is a ranked list with one LLM-written sentence of reason per result.
  No long synthesis.
- Input may be a reference/range **or** a free-text statement.
- Pipeline "B": hybrid retrieval (embeddings + keyword) → **JEV relevance filter**
  → LLM reasons. JEV is a separate stage that fails open; without it the feature
  still works.
- Embed our own chunks from `Complete.db` rather than using a published embedding
  dataset (wrong translation or unnamed model; embedding 31k verses is cheap).
- Chunk boundaries were produced by JEV in `experiments/chunking/`
  (threshold 0.7, min 2 / max 16 verses, no cut after a speech introduction).
  Whole Bible: 4,284 chunks, every verse in exactly one chunk, median 6 verses.

## Where it lives

New chat mode `passages` ("Find passages"): a tile on the mode picker, an inline
`passage_search` artifact of ranked cards. The artifact carries its data
(reference, text, reason, source) so reloads and share links redraw it. Same
wiring pattern as the other structured modes: `GET /passages/status` hides the
tile when the feature is unavailable; a `mode == "passages"` branch in
`post_chat` and `_stream_chat_response` (whole reply in one `final` event).

## Offline build (committed as data)

`scripts/build_passage_index.py`:

1. Reads the chunk boundaries and writes `chatbot/data/passage_chunks.json`
   (list of `[first_verse_id, last_verse_id]`, ≈65 KB). The raw JEV boundary
   scores stay in `experiments/` (gitignored); re-cutting needs no new API calls.
2. Embeds each chunk with its book and chapter prepended
   (`"Mark 4 — <verse text…>"`) and writes `chatbot/data/passage_embeddings.npy`
   (float32, one row per chunk, L2-normalised) plus
   `chatbot/data/passage_index_meta.json` recording the embedding model name and
   dimension.
3. Optionally imports TSK cross-references (see below).

The embedding model is a small local ONNX model (candidate: `BAAI/bge-small-en-v1.5`
via `fastembed`, 384-d) so the chatbot image does not need PyTorch. Verified while
planning: the model is MIT-licensed, 384-d, about 67 MB quantized; query latency and
image-size increase are measured in the implementation plan's Task 4.

## Runtime units

| Unit | Job | Depends on |
|---|---|---|
| `chatbot/passage_index.py` | Load chunks + vectors once (double-checked lock); `nearest(vector, k)` by brute-force cosine; chunk lookup by verse id; refuses to load if the meta's model name ≠ the runtime model | numpy, data files |
| `chatbot/passage_embed.py` | Embed a query with the local model; returns `None` on any failure | fastembed |
| `chatbot/jev_client.py` | One Choice request per candidate (concurrency 8) judging a passage against the query; a failed candidate is skipped, all failing raises `JevUnavailable` | httpx, `TYPESAFE_API_KEY` |
| `chatbot/passage_rank.py` | **Pure functions**: reciprocal rank fusion, the JEV filter, ordering and cap | none |
| `chatbot/passage_search.py` | Orchestrator; returns the result dict | all of the above, existing reference parser, keyword search, LLM client |

`Complete.db` is not modified; the chunk table is a separate file.

## Pipeline

**1. Classify (no LLM).** If the text parses as a verse reference or range it is a
*passage query*, otherwise a *statement query*. A passage longer than 25 verses is
rejected with a message asking for a narrower range (matches Deep Study's
`MAX_PASSAGE_VERSES`).

**2. Build queries.**
- Passage query: the passage text itself; its own chunk(s) are excluded from
  results; TSK cross-references of its verses are an extra candidate source,
  mapped to the chunks containing the linked verses.
- Statement query: one LLM call rewrites it into 3–5 KJV-style phrases, kept
  alongside the original statement ("rapture" → "caught up together in the
  clouds", "the trump of God", "in the twinkling of an eye"). If the call fails,
  only the original statement is used.

**3. Retrieve and merge (no LLM).** For each query: embed it, take the top 20
chunks by cosine; also run an in-memory BM25 keyword search over the chunk texts
(the existing English full-text search is a `LIKE` full scan of one literal
substring, unsuited to multi-phrase queries). Merge with reciprocal rank fusion, dedupe by chunk, keep the
top 30 candidates. Each candidate records its sources (`embedding`, `keyword`,
`cross_reference`).

**4. JEV relevance filter.** One request per candidate (concurrency 8; a single
request of 30 chunk-sized passages risks JEV's weakness with large unfocused
input), each a Choice:
`directly` / `partly` / `tangentially` / `not_relevant` ("does this passage
address the query?"). A pure function in `passage_rank.py` keeps `directly` and
`partly` at or above a confidence floor, orders by JEV score with retrieval rank as
tie-break, and caps at 10. Thresholds are named constants. Nothing surviving →
"no passages found that address this". The passage text sent is the chunk text.
The request shape follows the JEV API's Choice question (`state`, `questions`,
`criteria` with a `what` and `examples` per option), which `experiments/chunking/`
already exercises.

**5. Reasons.** One batched LLM call: the query plus the surviving passages'
text; one sentence per passage, stating only what the passage says and taking no
doctrinal position. A reason it fails to produce is left empty, never invented.

**6. Assemble.** Result dict: query, query type, phrasings used, whether the JEV
filter ran, and ranked cards `{ref_start, ref_end, text, reason, sources}`.

## Failure handling

Every dependency fails open to the next-best result; none may crash the turn.

| Failure | Behaviour |
|---|---|
| JEV: no key, error, or 5 s timeout | Un-filtered top 10 from retrieval, marked "relevance not verified" |
| LLM rewrite fails | Original statement is the only query |
| LLM reasons fails | Cards without a reason line |
| Embedding model fails to load/run | Keyword-only retrieval and a "semantic search unavailable" banner |
| Index files missing, or embedding model ≠ meta | `GET /passages/status` reports unavailable; tile hidden (availability does not depend on JEV) |
| Nothing relevant after the filter | Plain "no passages found"; no filler results |

Limits: query ≤ 500 characters; passage ≤ 25 verses; ≤ 30 JEV requests per search;
one reasons call of ≤ 10; overall budget ≈ 15 s, a stage over its share is
skipped rather than awaited. Queries go to the LLM provider (already true of chat)
and, for the filter, to TypeSafe. Reasons on contested topics (e.g. the rapture)
present passages people cite and take no position.

## TSK cross-references

Source: OpenBible.info's TSK-derived cross-references or
`CrossReferences-org/bible-cross-references` (CC-BY / CC BY 4.0). Attribution goes
in the artifact footer and `README`. Imported to `chatbot/data/` as a compact
verse-id → `[target verse id, votes]` table (votes ≥ 5, ≤ 25 per verse). Verified while
planning: every reference maps to `Complete.db` except `3John.1.15`; the file is CC-BY.

## Testing and evaluation

Unit tests (no network): RRF, the JEV filter (empty, low-confidence, cap, ordering),
input classification, the index (fixed small vectors; model-name mismatch refused),
one test per failure row above, the endpoint with LLM/JEV/embedder stubbed, and the
frontend artifact (cards, "no passages", "relevance not verified", banner).
Build-time tests: the chunks cover all 31,102 verses exactly once; the embeddings
have one row per chunk.

Retrieval eval (live, manual): `chatbot/data/passage_eval.py`, ≈40 labelled queries
— concept queries (rapture, speaking in tongues, antichrist), passage queries, and
off-topic queries that must return nothing. Expected passages are verified against
`Complete.db` by a test. `scripts/eval_passages.py` reports recall of the must-see
passages in the top 10, the fraction of off-topic queries correctly returning
nothing, and both numbers with the JEV filter off (that comparison shows whether
the filter earns its place). Thresholds are tuned only with this script; run it
before relying on the JEV thresholds.

## Known gaps

- Chunk boundaries are validated only against BSB section headings (precision
  ≈0.58, recall ≈0.81 at ±1 verse); many extra cuts look like real topic shifts
  the BSB does not mark, but this is unmeasured.
- Recall figures depend on the eval labelling, which is subjective for contested
  topics.
- TypeSafe pricing was not found in the docs; usage per search is one JEV request.
