# "Is that in the Bible?" Mode Design Spec

**Date:** 2026-09-26
**Status:** Approved for planning

## Purpose

"Is that in the Bible?" (internal id `misquote`) checks whether a saying
someone has heard — "Money is the root of all evil", "God helps those who
help themselves", "Spare the rod, spoil the child" — is really in the
Bible. It is layered:

1. **Fast verdict card** — one of six verdicts plus up to three real
   verses, fully grounded in `Complete.db`.
2. **Optional "Explain"** — an LLM follow-up giving where the saying
   actually comes from and what the real verse means in context.

It is the first feature to use TypeSafe's **JEV** model
(<https://docs.typesafe.ai/>) as its classifier. JEV does not generate
text; it answers typed questions (here: one Choice per candidate verse)
with calibrated probabilities and a confidence. The existing LLM provider
is used only to *suggest* candidate verses and to write the Explain text —
it never decides the verdict.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Purpose | Both, layered: verdict card first, optional Explain |
| Apocrypha | Searched; an Apocrypha-only match gets its own verdict ("In the Apocrypha, not the 66-book canon") |
| Entry points | Mode-picker tile **and** freeform chat detection ("is '…' in the Bible?") |
| JEV unavailable | Honest error, never a verdict without JEV. Tile hidden when no key is configured |
| Candidate retrieval | Approach B: in-memory keyword candidates ∪ one LLM "which verses?" suggestion call, verified against the corpus |
| Language / text | English sayings only; KJV (`Complete.text_1769`) + 1611 Apocrypha (`APOC.text`) |

## Verdicts

| Verdict id | Label | Meaning |
|---|---|---|
| `verbatim` | Word for word | The saying appears word for word in a canonical verse |
| `paraphrase` | Paraphrase | A canonical verse says the same thing in different/condensed words |
| `distorted` | Distorted | A canonical verse is the source, but the saying changes its meaning |
| `apocrypha_only` | In the Apocrypha only | Only an Apocrypha verse matches (sub-label: `verbatim` / `paraphrase` / `distorted`) |
| `not_in_bible` | Not in the Bible | No candidate is plausibly the source; up to 3 related verses shown as "what the Bible does say" |
| `unclear` | Unclear | Evidence is mixed; the closest verses are shown without a verdict |

Canonical matches always outrank Apocrypha matches.

## Architecture

### New backend modules

**`chatbot/bible_corpus.py`**. Loads the whole verse corpus into memory once, lazily and thread-safely, on first use: 31,102 `Complete` rows (tags stripped the way `search_english_sync` strips them) plus 5,705 `APOC` rows, about 6 MB. Each entry is `{ref, text, source: "canon"|"apocrypha", stems: set[str], tokens: list[str]}`.
- `normalize(text) -> list[str]` handles both translations' spellings:
  - Strips `<f data=…>…</f>` footnotes (APOC embeds these) and all other tags.
  - Lowercases, maps `ſ`→`s` and `&`→`and`, and folds `v`→`u` and `j`→`i`, so the 1611 "vnto"/"Ieruſalem" and the modern spellings meet.
  - Removes punctuation and splits into words.
- `stem(word)` first changes a trailing `ie` to `y` ("mightie" → "mighty"), then removes one of the endings `eth`/`est`/`ing`/`ed`/`es`/`s` (only if at least 2 letters remain), then a trailing `e` from words longer than 3 letters, then keeps the first 6 letters. So "goeth" and "goes" both become `go`, and "spareth" and "spare" both become `spar`. Archaic pronouns such as thee, thou and ye are stopwords, so they're skipped rather than mapped to modern forms.
- `exact_match(saying) -> list[ExactHit]` finds verses whose stemmed word sequence contains the saying's whole stemmed word sequence, in order and consecutively. `ExactHit = {verse, whole_verse: bool}`. `whole_verse` is true when the saying covers the entire verse.
- `keyword_candidates(saying, k=25) -> list[Verse]` drops stopwords from the saying, takes a prefix stem of each remaining word (so "spare" matches "spareth"), and scores each verse as `matched_stems + 0.5 × matched_adjacent_pairs`. It returns the top `k` with score > 0.
- `lookup(ref) -> Verse | None` resolves a reference from either table.

No per-check SQL is run, because the existing `REPLACE(...) LIKE` full scan is too slow to call repeatedly.

**`chatbot/jev_client.py`** is a thin async client that calls JEV's documented HTTP API, `POST https://api.typesafe.ai/v1/systemone`, with `httpx`, which the app already depends on.
- It deliberately doesn't use `typesafe-sdk`. The SDK's response attributes are only partly documented, the HTTP request and response format is fully documented, and this avoids adding a dependency.
- `is_configured() -> bool` reports whether `TYPESAFE_API_KEY` is set.
- `async judge(saying, candidates) -> list[Judgment]`: see *JEV request*. `Judgment = {ref, probabilities: dict[str, float], confidence: float}`, read from the response's `answers[<question id>]`.
- Any HTTP error, a non-2xx status (401/422/429/529), a malformed response, or a timeout (`MISQUOTE_JEV_TIMEOUT`, default 10 s) raises `JevUnavailable`.

**`chatbot/misquote.py`** is the orchestrator.
- `async check(saying) -> dict` returns a chat response dict containing the bubble text and the `misquote` artifact.
- `verdict_from(exact_hits, judgments, candidates) -> Verdict` is a **pure function** holding all the thresholds as named module constants.
- `async suggest_refs(saying) -> list[str]` makes one `simple_completion` call ("Which Bible verses, if any, might this saying come from? Reply with references only, or NONE."). It parses the reply with `_find_flexible_verse_refs` and keeps only references that `bible_corpus.lookup` resolves. On any failure it returns `[]` (fail open).
- `async explain(params) -> dict` backs the Explain endpoint.

**`chatbot/data/misquote_eval.py`**: about 40 labelled sayings for the live evaluation script.

### Data flow of a check

```
saying (1..300 chars, else polite length error)
  ├─ exact_match() ── whole-verse hit ──► verbatim (canon) / apocrypha_only+verbatim; JEV not called
  │                └─ partial hit ──► becomes a candidate (listed first), JEV still judges it
  ├─ keyword_candidates(k=25) ─┐   (run concurrently)
  └─ suggest_refs() ───────────┤
                               ▼
           merge + dedupe, cap 30 (LLM suggestions kept first, then keyword order)
                               ▼
           jev_client.judge()  ── JevUnavailable ──► "The checker is unavailable right now."
                               ▼
           verdict_from()
                               ▼
           bubble text + `misquote` artifact
```

If `jev_client.is_configured()` is false, `check()` returns the unavailable
message immediately.

## JEV request

- **State:** the saying only, capped at 300 characters. JEV's jev-1.13 list of known limitations says accuracy drops when the state carries text unrelated to the decision.
- **Questions:** one Choice per candidate, named `c0 … cN`, all in a single request. The candidate's reference and text go in the question's structured `instructions`, for example: `How does this verse relate to the saying? Verse (Proverbs 16:18): "Pride goeth before destruction, and an haughty spirit before a fall."`
- **Criteria**, the same for every question. Each option has a `what` plus short `examples`, to guard against JEV's tendency to read instructions literally:

  | Option | Description |
  |---|---|
  | `same_meaning` | The verse says what the saying says, possibly in different, condensed or modernized words |
  | `meaning_changed` | The verse is clearly the source, but the saying drops or alters words so its meaning shifts |
  | `related_only` | Same topic, but not the source of the saying |
  | `unrelated` | No real connection |

- **Model:** `TYPESAFE_MODEL`, default `jev-latest`.

**Spike before building (the first implementation task).** The docs don't say how well JEV handles one request whose questions each carry a different verse in their instructions. Run `scripts/eval_misquote.py` both ways:
- **(a)** a single batched request, as described above;
- **(b)** one request per candidate, with the state set to the saying plus that verse and a single question, run at most 8 at a time.

Adopt whichever scores better on the eval set; if they're tied, pick the faster one. Only `jev_client.judge()` changes between the two, and its interface stays the same.

## Verdict logic (`verdict_from`)

For each judged candidate: `source = P(same_meaning) + P(meaning_changed)`.
Starting constants (tuned with the eval set):
`SOURCE_MIN = 0.70`, `CONFIDENCE_MIN = 0.60`, `NOT_IN_BIBLE_MAX = 0.20`,
`CONFIDENT_LABEL_MIN = 0.85`.

1. A canonical **whole-verse** exact hit gives `verbatim`. Otherwise an Apocrypha-only whole-verse exact hit gives `apocrypha_only` with sub-label `verbatim`. JEV isn't called in either case.

   A **partial** exact hit is never trusted on its own. "Money is the root of all evil" is a word-for-word fragment of 1 Timothy 6:10, and it's the model example of a *distorted* saying.
2. Take the best canonical candidate by `source`. If `source ≥ SOURCE_MIN` and its `confidence ≥ CONFIDENCE_MIN`:
   - `P(meaning_changed) ≥ P(same_meaning)` gives `distorted`;
   - otherwise, a partial exact hit gives `verbatim`, and any other candidate gives `paraphrase`.
3. Otherwise, run the same test on the best Apocrypha candidate. A pass gives `apocrypha_only`, with sub-label `verbatim`, `paraphrase` or `distorted`, chosen by the same rule as step 2.
4. Else if **every** candidate has `source ≤ NOT_IN_BIBLE_MAX` →
   `not_in_bible`; attach up to 3 candidates with the highest
   `P(related_only)` (only those with `P(related_only) ≥ 0.5`) as
   `role: related`.
5. Else → `unclear`; attach the top 3 by `source` as `role: related`.

The source verse for steps 2–3 is shown as `role: source`; the next two
candidates with `source ≥ SOURCE_MIN` are shown as additional sources.

**Confidence label.** For `verbatim` it's always "Confident". Otherwise it's "Confident" when the deciding candidate's `confidence ≥ CONFIDENT_LABEL_MIN`, and "Fairly sure" when it's lower. `unclear` and `not_in_bible` get no label. Raw probabilities are never shown to the user.

**Priority of errors.** A false `verbatim` or `paraphrase` on a saying that isn't in the Bible is the worst possible error. When tuning, the thresholds move towards `unclear` rather than risk that error.

**Adversarial input.** The saying is user text inside the JEV state, so it can only steer the verdict on itself. Every verse the card shows is real text from the corpus, and generated text is never presented as scripture.

## API

### `mode == "misquote"`

Branches in both `post_chat` and `_stream_chat_response` in `chatbot/api.py`, mirroring `character`:
- A non-empty message calls `misquote.check(message)` and returns the whole reply in one `final` event, with no token streaming.
- An empty message goes to the existing `router.build_mode_primer()`, which gains a `mode == "misquote"` branch. It returns the static opening message, "Type a saying and I'll check whether it's really in the Bible.", with four example follow-up chips: "Money is the root of all evil", "God helps those who help themselves", "Spare the rod, spoil the child", "This too shall pass". It makes no LLM call.
- Results carry **no** `follow_up_questions`. In this mode every message is treated as a saying, so a chip like "Explain this" would be checked as a saying. Explain and Check another are buttons on the card instead.

### Freeform detection

`route_deterministic` gains `extract_saying(message) -> str | None` (in `misquote.py`). It is deliberately narrow, because a topic question like "does the Bible say anything about divorce?" must **not** be treated as a saying to check. It matches only:
- a **quoted** saying, in straight or curly single or double quotes, of at least 3 words, in a message that also mentions "Bible", "scripture" or "biblical" (e.g. `Is "money is the root of all evil" in the Bible?`, `Where does the Bible say 'spare the rod'?`);
- the unquoted forms "does the Bible (really) say that X" and "is it (really) in the Bible that X", where the word **"that"** is required.

It returns the saying with surrounding quotes and a trailing "?" removed, or `None`. It runs only when `jev_client.is_configured()`. A match returns `misquote.check(saying)` with `record_routing("deterministic: misquote check")`. Without JEV the regex is skipped and the message falls through to the normal LLM chat, exactly as today.

### `GET /misquote/status`

Returns `{ "available": bool }`, which reports only whether a key is configured, with no call to JEV. The frontend calls it once, when the mode picker loads.

### `POST /misquote/explain`

Request: the `misquote` artifact params. The server:
1. Loads each shown verse plus two verses either side of it using `bible_corpus.context(verse, radius=2)`, which works for both canon and Apocrypha and stays within the same chapter.
2. Makes one LLM call covering where the saying really comes from (attributions hedged, e.g. "often attributed to…", never stated as fact unless well established) and what the real verse means in its context.
3. Runs `wiki_refs.resolve_scripture_refs` on the reply.

Response: `{ "message": markdown }`. On failure it returns `{ "message": "I couldn't explain this one right now." }` with a 200 status, and logs the details server-side.

## Artifact and frontend

**Artifact** `{ type: "misquote", label: "View check ▸", params }`, with these params:

```
saying: string
verdict: "verbatim"|"paraphrase"|"distorted"|"apocrypha_only"|"not_in_bible"|"unclear"
sub_label: "verbatim"|"paraphrase"|"distorted"|null
confidence_label: "Confident"|"Fairly sure"|null
verses: [{ ref, text, source: "canon"|"apocrypha", role: "source"|"related" }]
```

The verse text is copied into the params, so reloads and share links redraw the card exactly, without re-running the check.

**Bubble text** is one line per verdict, e.g.
"**Distorted**: this is a real verse, but the saying changes its meaning. *1 Timothy 6:10*".

**`frontend/src/components/artifacts/MisquoteArtifact.tsx`:**
- A verdict badge with a distinct colour and icon for each of the six verdicts, using the existing theme tokens.
- The saying in a quote block, and the confidence label when there is one.
- Up to three verse cards. Each links to `/explorer?reference=…`, and Apocrypha verses are tagged "Apocrypha".
- For `paraphrase` and `distorted` (including the Apocrypha sub-labels), verse words missing from the saying are highlighted: normalized word-set difference, frontend only, no model.
- Buttons for **Explain** and **Check another**:
  - **Explain** POSTs to `/misquote/explain` and appends the reply to the current session as an assistant message, so it's saved and shared. The button shows a loading state while it waits.
  - **Check another** focuses the chat input.

**Other frontend changes:**
- `SessionMode` gains `'misquote'`, and the `ArtifactPane` switch renders `MisquoteArtifact`.
- `ModePickerScreen` gains an "Is that in the Bible?" tile, shown only when `/misquote/status` returns `available: true`. It starts the session through the existing primer flow (empty message).
- Clicking a primer chip sends that saying as a message.
- Freeform sessions render the same bubble and card with no other changes.

## Errors and limits

| Situation | Behaviour |
|---|---|
| JEV not configured (mode session) | "The checker is unavailable right now. Please try again later.", with no card |
| JEV error/timeout | Same message; logged server-side |
| JEV not configured (freeform) | Regex skipped; normal LLM chat |
| Suggestion LLM fails | Continue with keyword candidates only |
| No candidates at all | `not_in_bible` with no related verses (JEV not called) |
| Saying empty or > 300 chars | "Please give me just the saying, under about 300 characters." |
| Explain fails | "I couldn't explain this one right now."; the card is unaffected |

## Testing

Unit tests, in `tests/chatbot/`, make no real JEV or LLM calls:
- `test_bible_corpus.py`: row counts (31,102 / 5,705); `normalize` handling 1611 spelling and footnote tags; `stem` merging archaic and modern word endings; `exact_match` ignoring case and punctuation and flagging whole-verse vs partial hits; the source verse ranking in the top 25 for known sayings; `lookup` resolving both tables.
- `test_misquote_verdict.py`: table-driven tests of `verdict_from` covering every branch and threshold edge, canon beating Apocrypha, and the `not_in_bible` related-verse filter.
- `test_misquote_check.py`: the whole check with fake JEV and LLM responses. Suggested references that don't exist are dropped; LLM failure falls back to keywords only; JEV failure and a missing key produce the unavailable message; the length cap is enforced; a whole-verse exact hit never calls JEV, while a partial hit ("money is the root of all evil") is sent to JEV and can come back `distorted`.
- `test_chat_endpoint_misquote.py`: `mode=misquote` through `post_chat` and the streaming path; the primer; freeform regex routing, including that it's skipped when unconfigured; `/misquote/status`.
- `test_misquote_explain_endpoint.py`: context verses are loaded, references are linked, and failure gives the honest message.

Frontend tests:
- `MisquoteArtifact.test.tsx`: each verdict's badge, the omitted-word highlighting, Explain appending a message, Explain's failure state.
- `ModePickerScreen.test.tsx`: the tile is hidden when `available: false`.

**Live evaluation.** `scripts/eval_misquote.py` runs by hand against the real JEV and is not part of CI.
- It runs the ~40 labelled sayings (about 10 each of verbatim, paraphrase, distorted and not in the Bible, plus about 4 Apocrypha-only) and prints a confusion matrix plus how long each request took.
- It's used for the batched-vs-separate spike and for threshold tuning.
- Acceptance bar: **zero** `verbatim` or `paraphrase` verdicts on `not_in_bible` sayings, and at least 80% correct overall.

## Deployment

- No new Python dependency, since `jev_client` uses the existing `httpx`.
- New environment variables, added to `.env.example` and `docker-compose.yml`:
  - `TYPESAFE_API_KEY`: when unset, the mode is disabled and the tile hidden.
  - `TYPESAFE_MODEL`: defaults to `jev-latest`.
  - `MISQUOTE_JEV_TIMEOUT`: defaults to 10 seconds.
- No new volumes or Docker changes. The corpus is built from the already-mounted `Complete.db`.
- `DEPLOYMENT.md` gets an "Is that in the Bible? (JEV)" section covering the key and how to verify the mode works.
- `CLAUDE.md` gets a mode section, in the same style as the others.

## Out of scope for v1

- A semantic search index (approach C).
- Sayings in languages other than English, and translations other than KJV.
- A curated table of where famous sayings come from. If the Explain step's attributions prove unreliable, a small `parables.py`-style table is the obvious next step.
- Re-running old checks when thresholds change. Saved cards keep their original verdict.
