# Deep Study Mode Design Spec

**Date:** 2026-09-16
**Status:** Approved for planning

## Purpose

Add a **Deep Study** mode alongside the existing modes (Bible in a Year,
Verse of the Day, Parable Study, Topical Study, Devotional, Socratic Study,
Ask Anything). The user names a passage; the backend runs it through
a fixed 8-phase interpretive methodology, streaming each phase into the chat
as it completes, and finishes with a **Final Verified Interpretation**. The
completed run is also written to the artifact pane as one scrollable report.

The eight phases are:

1. **Contextual & Historical Scope Intake** — the Miles Coverdale 8-point
   scan, plus audience classification (written *TO* the Jew, the Gentile, or
   the Church, versus written *FOR* the believer).
2. **Inter-Textual Semantic Analysis** — define words and idioms from
   scriptural usage, not external dictionaries.
3. **Factual Record vs. Absolute Truth** — distinguish what Scripture
   faithfully *records* from what it asserts as divine truth.
4. **Two-or-Three Witnesses Verification** — no interpretation stands on an
   isolated verse.
5. **Priority Resolution** — clear passages govern obscure ones, never the
   reverse.
6. **Covenantal & Cross-Filtering** — rightly divide Law and Grace at the
   cross.
7. **Typological, Divine Title & Name Mapping** — Christ-first typology,
   *Elohim* vs. *Yahweh*, Hebrew/Greek root meanings.
8. **Output Validation & Hermeneutical Guardrails** — the Heart & Love
   Test, the Cross Test, and the Grace Test.

After the report, the session stays open: subsequent turns are ordinary
grounded Q&A answered *in light of* the completed run, not a re-run.

### Doctrinal position (deliberate)

The methodology encoded here takes a specific free-grace / dispensational
position, and this design treats its rulings as **authoritative rather than
as one reading among several**. Phase output will therefore read as settled
on contested passages (Hebrews 6:4–6, Galatians 5:4, Job 1:21). This is the
intended behaviour of the mode, recorded here so it is understood as a
deliberate product decision rather than an accident of prompting.

### Naming

The mode is **"Deep Study"** to the user and **`hermeneutics`** in the code.
The codebase already separates the two (`reading_plan` → "Bible in a Year",
`verse` → "Verse of the Day", `topic` → "Topical Study"), so the identifier
stays precise for developers while the label stays in register with every
other mode name — plain English, no jargon.

"Deep Study" was chosen over "Hermeneutics" (the only term in the picker a
newcomer would have to look up) and over the method names in this tradition
— "Berean Study", "Rightly Dividing", "Search the Scriptures". Those last
ones are deliberately held in reserve: Acts 17:11's Bereans "searched the
scriptures daily whether those things were so", which is claim-testing —
precisely what this mode *redirects away from* (see *A claim is not a
passage*). Naming it Berean would invite the one input that gets bounced, and
the name properly belongs to a future claim-verification mode.

The icon is `Layers`, reading as the eight stacked phases. A scales icon was
rejected for implying the mode passes judgement, which Phase 8 deliberately
does not.

## Scope

**In scope:**

- A new `'hermeneutics'` member of `SessionMode`, with `MODE_LABELS`
  (`→ 'Deep Study'`), `MODE_ORDER` and `Layers` icon entries.
- A new `'hermeneutics_report'` member of the `ArtifactLink` type union,
  carrying the finished report inline (no fetch on open), exactly as
  `'devotional'` does.
- A new `PhaseResult` type and a `phases?: PhaseResult[]` field on
  `SessionMessage`.
- Additions to `ModeParams`: reuse of `reference`, plus `runDigest?: string`
  for post-report turns.
- A new `phase` SSE event type on `/chat/stream`, additive to the existing
  `stream` / `final` / `trace` contract.
- A new orchestrator (`chatbot/hermeneutics.py`), phase definitions
  (`chatbot/hermeneutics_phases.py`), and curated rulings data module
  (`chatbot/data/hermeneutic_rulings.py`).
- New dependency-free `Complete.db` lookups in `chatbot/bible_search.py`:
  per-word interlinear data and local Strong's entries.
- A **Deep Study** starter button in `ModePickerScreen`, a `PhaseList` chat
  component, and a `HermeneuticsArtifact` pane component.
- Description-based passage resolution (curated parable lookup, then an LLM
  fallback) with the resolved reference echoed back to the user, and
  classification of a doctrinal claim as something to redirect rather than
  run.

**Out of scope:**

- Resumable runs. A mid-run disconnect keeps the phases already delivered;
  recovery is the existing regenerate button. (See *Approaches considered*.)
- A claim-verification pipeline. A claim is detected and redirected here; a
  mode that actually adjudicates one across multiple passages (Phases 4, 5
  and 6 over a candidate set) is a separate spec.
- Fixing the same description gap in **Socratic Study**, which also accepts
  only regex-matched references today. `resolve_description` is deliberately
  kept local to `chatbot/hermeneutics.py`; promoting it to a shared module
  is a separate, easy follow-up once it has proved itself here.
- Chapter-length or whole-book runs. A chapter request is answered with a
  narrow-it-down reply.
- User-editable rulings. `RULINGS` is a curated code module, edited by
  commit, not a UI.
- Any change to `share_store.py` — phases persist on the message, so the
  existing share snapshot carries them unchanged.

## Approaches considered

Three ways to deliver eight progressive results over a transport whose
current contract assumes one answer per turn:

- **A — a new `phase` SSE event (chosen).** Additive event type carrying
  structured per-phase results; one `final` event assembles the report.
  Other modes are untouched, and the data stays structured end-to-end, so
  Phase 4's verified-witness list and Phase 8's verdicts are read as fields
  rather than parsed out of prose.
- **B — reuse `stream` chunks.** One growing markdown document through the
  existing chunk channel, with the frontend splitting on `### Phase N`
  headings. No backend contract change and livelier token-level streaming,
  but load-bearing UI structure would depend on the model reliably emitting
  an exact heading, and Phase 4's structured data has nowhere to live.
- **C — a job resource.** `POST` starts a run returning a `run_id`; the
  frontend streams or polls `/hermeneutics/run/<id>`. Survives reload and
  disconnect — genuinely valuable for a 90-second run — but adds storage and
  a lifecycle no other mode has, and would be the only mode not following
  the `/chat/stream` shape. Deferred under YAGNI; revisit if long runs are
  observed being lost in practice.

## Architecture

### Mode lifecycle

1. The user picks **Deep Study** from `ModePickerScreen`. `startWithChoices`
   posts a prompt asking for a passage, with a **"Surprise me"** pill (the
   same affordance Socratic Study offers).
2. The primer (`build_mode_primer`, `chatbot/router.py`) resolves the
   passage. "Surprise me" draws from `random_verse()` as Socratic's primer
   does.
3. Naming a passage runs the pipeline on `/chat/stream`. The passage may be
   named as a reference ("1 Thessalonians 4:15-18") **or described**
   ("the parable of the ten virgins") — see *Naming a passage* below.
4. Once the report lands, `runDigest` is persisted into `modeParams`.
   Subsequent turns are ordinary grounded Q&A carrying that digest.
5. Naming a **new** passage in a later turn starts a fresh run.

### Naming a passage

A user should not have to know chapter and verse to use the mode. Resolution
runs in three steps, first hit wins:

1. **Explicit reference** — `_detect_reference` (the regex path Socratic
   Study already uses), covering "John 3:16", "1 Thess 4:15-18", "Gen 1".
2. **Curated parable lookup** — a name match against the 42 entries in
   `chatbot/data/parables.py`, which already map names to references.
   Matching is normalised, so "the parable of the ten virgins", "ten
   virgins" and "the 10 virgins" all resolve to `MAT 25:1-13`. This is a
   local table lookup: no LLM call, no failure mode.
3. **LLM fallback** — anything else goes to one short completion that returns
   a reference. This is the path for every non-parable episode ("Jesus
   feeding the 5000", "the armour of God", "where Paul talks about his
   thorn"). No curated table of such episodes is introduced: parables are a
   closed set of 42, but narrative episodes have no natural boundary, so the
   list would need endless maintenance and still miss things. An episode with
   parallel gospel accounts (the feeding of the 5000 is in all four) resolves
   to whichever the model picks; the echo-back makes that choice visible and
   the user can name a different account on the next turn. The fallback
   follows `devotional.pick_verse_for_theme()`'s existing shape: parse the
   reply with `_find_flexible_verse_refs`, retry once, and give up cleanly
   rather than guessing.

### A claim is not a passage

The same LLM call that resolves a description also classifies the input, at
no extra cost, because some messages name no passage at all:

> "Verify this claim — Patriarchs like Abraham and Moses will get their
> resurrected body at the same time as Christ's Church."

Left to the fallback, that resolves to whatever single verse the model
associates with the proposition, and the mode streams eight phases about
*that* verse. The user asked a yes/no question and gets an essay on a passage
they never named — output that looks exactly as authoritative as a real run.
It is the worst failure this mode can produce, and the echo-back alone does
not prevent it, since a resolution is easy to read as confirmation rather
than substitution.

So a claim is **redirected, never run**: the mode says what it is and offers
the passage that bears on it most directly ("That's a claim to test rather
than a passage to interpret… The passage that bears on it most directly is
**1 Thessalonians 4:13-18** — shall I run that?"), with that run offered as a
follow-up pill. A claim that *cites* a passage ("verify this claim from
1 Thess 4:16 — …") is not redirected: the explicit reference wins, and the
run proceeds on the verse the user named.

The shape mismatch behind this is worth recording. Phases 1, 2, 3, 6 and 7
are passage-oriented — they need one text. Phases 4 (witnesses) and 5 (clear
vs. obscure) are inherently *claim*-oriented: they are exactly the machinery
for testing a proposition across several passages. A claim-verification
pipeline reusing those phases is a natural successor to this spec, and is
deliberately left to its own design conversation once Phase 4's real output
can be seen.

**A resolution the user did not type verbatim is always echoed back** — "Reading
that as **Matthew 25:1-13** — running it now." A wrong guess is then visible
and correctable on the next turn instead of silently analysing the wrong
passage. An explicit reference needs no echo.

If all three steps fail, the mode asks for a reference rather than running
on a guess.

**Whatever resolved it, the passage is then verified to have text** before any
phase runs. `list_passage_verses_sync` returns nothing for a chapter or range
`Complete.db` has no rows for, so an LLM-resolved description — or an
explicit reference with a typo — can name a passage that does not exist, and
every phase would then run on an empty string and produce a confident,
wholly ungrounded report. Phase 4 already refuses to cite a witness it cannot
fetch; the passage the entire run is about gets the same guarantee. The check
runs *before* the echo-back, so an unusable resolution never announces itself
as though the run were starting.

### Passage scope

A single verse or a verse range of **at most 25 verses**. A chapter-sized or
longer request is answered with a narrowing question ("That's 31 verses —
which part carries the point you're after?") rather than a run. This caps
Phase 2 and Phase 7 lookups, which scale with the number of original-language
words.

The limit is set by the parable corpus, which is the natural stress case for
named passages: **12 of the 42 curated parables exceed 12 verses**, including
the Ten Virgins (Matthew 25:1-13, 13 verses) that Phase 5's own worked
example turns on, and the Prodigal Son (Luke 15:11-32) at 22. A cap of 25
admits every one of them while still refusing chapter-length input. The cost
is that the slowest phases roughly double on a long passage versus a short
one, which is accepted: a mode whose most-requested passages need a
second clarifying turn is worse than a mode that is sometimes slow.

### Phase execution

Each phase is its own LLM call, receiving:

- the passage text (KJV) and its `get_book_context(usfm)` sections,
- the structured outputs of the phases already completed,
- its own phase-specific grounding (below).

Phases are grounded as follows. Phases 2, 4 and 7 perform real lookups
because those are where fabrication is both most likely and most damaging;
the rest run on model knowledge over the passage and prior phases.

| Phase | Grounding |
|---|---|
| 1 Context | `get_book_context(usfm)`. Emits the 8-point scan plus a structured audience classification (`jew` / `gentile` / `church`) that later phases and the UI both consume. |
| 2 Semantics | `fetch_interlinear()` for every word in range; `fetch_strongs_local()` for their numbers; `search_english()` for each key phrase's other occurrences; `rulings_for(passage_text)` injecting only the rulings whose triggers actually match. (The phases always call the async `chatbot/tools.py` wrappers, never the `_sync` readers directly.) |
| 3 Record vs. Truth | Model-only. Emits a structured speaker classification (`god` / `prophet` / `human` / `adversary`) and the resulting verdict. |
| 4 Witnesses | The model proposes candidate references; each is resolved via `_resolve_verse_reference` and fetched. Verified witnesses carry their KJV text into the report; unresolvable ones are **dropped and counted**. If fewer than two verify, the phase says so plainly rather than padding. |
| 5 Priority | Model-only, with the Phase 1 audience and Phase 2 rulings fed forward. |
| 6 Covenant | Model-only, same carry-forward. |
| 7 Typology | Roots and transliterations from the Phase 2 interlinear fetch. Divine titles are detected **by Strong's number** (`H430` *Elohim*, `H3068` *YHWH*) rather than by asking the model to spot them. |
| 8 Validation | The three tests, each emitting `PASSED` / `FAILED` plus a reason. |

A final synthesis call then produces the **Final Verified Interpretation**.

### Phase 8 is disclosure, not enforcement

A failed test **never blocks the report and never triggers a rewrite**. The
verdicts are printed as part of the report and a failure raises a caution
banner ("Weigh the Cross Test failure before accepting this reading") for the
user to judge. This keeps the guardrails transparent and the run cost
bounded; it deliberately trades enforcement for honesty and speed.

### Transport

`/chat/stream` emits, in order:

```
data: {"type":"phase","index":1,"title":"Contextual & Historical Scope",
       "status":"done","markdown":"…","citations":[…]}
data: {"type":"phase","index":2, …}
…
data: {"type":"final","result":{ …ChatResponse-shaped… }}
data: {"type":"trace","trace":{…}}
```

The existing guarantees hold unchanged: zero or more `stream` events,
**exactly one** `final`, then a terminal `trace`. Clients that do not know
the `phase` event ignore it, so no other mode is affected.

The buffered `POST /chat` path runs the same pipeline and returns the
finished report in a single response. It is slow, but keeping the two
endpoints behaviourally identical matches how every other mode works today.

## Components

### `chatbot/hermeneutics.py` (new)

`run(reference, message, history)` — an async generator yielding each
`PhaseResult` as it completes, then the assembled report. Mirrors
`socratic.answer()`'s grounding and reference-resolution conventions
(`_detect_reference`, `_resolve_verse_reference`, `_ref_from_history`), and
its `route` string convention.

Also owns: passage-scope enforcement, description resolution
(`resolve_description`, using `chatbot/data/parables.py`'s existing name →
reference table and then a `simple_completion` fallback), the post-report
Q&A path (answering from `runDigest` instead of re-running), and digest
construction.

### `chatbot/data/parables.py`

Read, not modified. Its 42 `{id, name, reference}` entries are already the
name → reference table description resolution needs; no parallel list is
introduced.

### `chatbot/hermeneutics_phases.py` (new)

The eight phase definitions: system prompt, required grounding, and output
parsing for each. Split from the orchestrator because eight prompts is more
prose than the orchestration logic should carry.

### `chatbot/data/hermeneutic_rulings.py` (new)

The curated `RULINGS` list, beside `parables.py` and `devotional_verses.py`:

```python
RULINGS = [
    {"id": "thorn_in_the_flesh",
     "triggers": ["thorn in the flesh", "thorn in the side"],
     "reading": "harassing persons / adversaries",
     "rejects": "physical sickness or disease",
     "proofs": ["NUM 33:55", "2CO 12:7"]},
    …
]
```

Seeded from the methodology's named rulings: thorn in the flesh, fear and
trembling, good/single eye vs. evil eye, overcomer, "certain man" vs.
"certain disciple", falling from grace, sowing and reaping, and Job 1:21 as
recorded error. Exposes `rulings_for(text)` doing the phrase match, so only
triggered rulings are injected and the list can grow without touching
prompts or paying tokens for every entry on every run.

### `chatbot/bible_search.py`

Extended with two dependency-free `Complete.db` readers, consistent with the
module's stated independence from the *mybibletoolbox* dependency that
`chatbot/tools.py` relies on:

- `fetch_interlinear_sync(usfm, chapter, verse)` — per-word original text,
  Strong's number, root, transliteration and gematria value, splitting the
  `~`-delimited `Original_Words`, `Original_Words_SN`, `Root` and
  `Root_Translit` columns.
- `fetch_strongs_entries_sync(numbers)` — the `Strongs_` table directly; the
  local counterpart to `tools.fetch_strongs`.

### `chatbot/tools.py`

Async `fetch_interlinear()` and `fetch_strongs_local()` wrappers, each
instrumented with `record_tool` like every existing tool, so a run's real
Strong's and search calls appear in the troubleshooting trace pane.

### `chatbot/api.py`

A `hermeneutics` branch at both dispatch points — the buffered path
(`post_chat`, alongside the existing `socratic` branch) and the streaming
path (`_stream_chat_response`, likewise) — so a hermeneutics turn never
falls through to the deterministic/AI-fallback route.

### `chatbot/router.py`

A `mode == "hermeneutics"` branch in `build_mode_primer`, following the
`socratic` primer's shape: resolve the reference, handle "Surprise me" via
`random_verse()`, return the passage as a verse box with an opening prompt.

### `chatbot/schemas.py`

`mode` description gains `hermeneutics`. A `PhaseEvent` schema documents the
new SSE event.

### `frontend/src/types/session.ts`

`'hermeneutics'` joins `SessionMode`; `'hermeneutics_report'` joins the
`ArtifactLink` union. New:

```ts
export interface PhaseResult {
  index: number
  title: string
  status: 'running' | 'done' | 'error'
  markdown: string
  citations?: { reference: string; text: string; verified: boolean }[]
  verdicts?: { test: string; passed: boolean; reason?: string }[]
}
```

`SessionMessage` gains `phases?: PhaseResult[]`. `ModeParams` gains
`runDigest?: string`.

### `frontend/src/lib/chatApi.ts`

`ChatStreamHandlers` gains `onPhase?: (phase: PhaseResult) => void`;
`handleFrame` gains one `else if (event.type === 'phase')` branch. Nothing
else in the stream contract changes.

### `frontend/src/components/shell/ChatPane.tsx`

`streamAssistantReply` passes `onPhase` through to
`updateMessage(sessionId, id, { phases })`, appending each phase as it
arrives. Because phases live on the message, they persist through the
Zustand store for free: a reload shows the completed run, and `SharePayload`
carries them with no change to `share_store.py`. After the `final` event,
the resolved reference and `runDigest` are persisted into `modeParams`, the
same way the socratic reference is today.

### `frontend/src/components/chatbot/PhaseList.tsx` (new)

Renders the collapsibles: running phases show a spinner, completed phases
collapse to a one-line summary and re-expand on click, Phase 4 expands to
its verified-witness list, Phase 8 shows PASSED/FAILED badges and raises the
caution banner when any test fails.

### `frontend/src/components/artifacts/HermeneuticsArtifact.tsx` (new)

Renders the full report — all eight phases plus the Final Verified
Interpretation — from inline link params, alongside `DevotionalArtifact.tsx`.

### `frontend/src/store/useArtifactStore.ts`

One `case 'hermeneutics_report': return link.params` in `fetchForLink`: the
report travels inline on the link, so opening the pane fetches nothing.

### `frontend/src/components/shell/ModePickerScreen.tsx`

A **Deep Study** starter bubble (`Layers` icon) using the existing
`startWithChoices`, offering a **"Surprise me"** pill.

### `frontend/src/components/shell/SessionsPane.tsx` / `useSessionsStore.ts`

`'hermeneutics'` in `MODE_ORDER`, a `Layers` lucide icon, and a
`'Deep Study'` label.

## Data flow

```
User: "Run the parable of the ten virgins"
  │
  ├─ ChatPane → postChatStream(mode: 'hermeneutics', mode_params: {…})
  │
  ├─ api.py → hermeneutics.run()
  │     ├─ resolve: reference regex → parables table → LLM classify
  │     │     "ten virgins"     → MAT 25:1-13, echoed back
  │     │     "verify this claim…" → claim → redirect, run nothing
  │     ├─ scope check (≤ 25 verses)      → else narrowing reply
  │     ├─ llm_unconfigured_error()       → else fail fast
  │     ├─ passage KJV text               → empty? ask, never run
  │     ├─ echo the reading back (described passages only)
  │     ├─ get_book_context()
  │     │
  │     ├─ Phase 1  ──► yield PhaseResult ──► SSE `phase` ──► PhaseList
  │     ├─ Phase 2  ── interlinear + Strong's + english_search + rulings_for()
  │     ├─ Phase 3
  │     ├─ Phase 4  ── resolve + fetch each proposed witness; drop misses
  │     ├─ Phases 5, 6
  │     ├─ Phase 7  ── roots; Elohim/YHWH by Strong's number
  │     ├─ Phase 8  ── three verdicts, disclosed not enforced
  │     └─ synthesis ─► Final Verified Interpretation
  │
  ├─ SSE `final`  → report + `hermeneutics_report` artifact link (inline)
  └─ SSE `trace`  → per-phase tool calls in the troubleshooting pane

Later turn: "So does this contradict Matthew 25?"
  └─ hermeneutics.run() → post-report Q&A path, answered from runDigest
```

## Error handling

- **LLM unconfigured** — checked *before* Phase 1 via
  `llm_unconfigured_error()`, so a misconfigured server fails in a second
  rather than mid-run.
- **A phase errors** — marked `status: 'error'` with its reason; the run
  **continues**. A 90-second pipeline should not be discarded because Phase 7
  timed out. The final synthesis names which phases are missing.
- **Phase 4 finds fewer than two verified witnesses** — reported plainly in
  the phase output; the run continues and the report is not suppressed.
- **Unresolvable witness reference** — dropped silently from the citation
  list and counted; the count appears in the phase output.
- **Mid-run disconnect** — phases already delivered are persisted on the
  message. The run is not resumable (the accepted cost of approach A);
  recovery is the existing regenerate button.
- **Passage out of scope** — a narrowing question, never a truncated run.
- **A description that resolves to nothing** — the LLM fallback returns no
  parseable reference after one retry, so the mode asks for a reference
  rather than running on a guess. It never falls back to a random verse
  (`devotional.pick_verse_for_theme` does, because a devotional on *some*
  verse is still useful; an eight-phase analysis of a passage the user did
  not ask about is not).
- **A claim rather than a passage** — redirected with the bearing passage
  offered as a follow-up, and no phases run. Never a best-effort run on a
  verse the user did not name.
- **A resolved passage with no text in `Complete.db`** — the run stops before
  Phase 1 and asks for the reference, naming the description as the likely
  culprit when one was used. Never a partial or empty-grounded run: an
  eight-phase report about nothing is the worst output this mode can produce,
  because it looks exactly like a good one.
- **A description that resolves to the wrong passage** — unavoidable with an
  LLM fallback, so it is made visible: any non-verbatim resolution is echoed
  back ("Reading that as **Matthew 25:1-13**"), and naming a different
  passage on the next turn starts a fresh run.

## Testing

TDD throughout: each test below is written before the code it covers.

### Backend — `tests/chatbot/` (pytest, already configured)

`test_hermeneutic_rulings.py`

- Trigger matching is phrase-accurate and case-insensitive.
- Ruling ids are unique.
- **Every ruling's proof texts resolve against `Complete.db`** — the same
  data-integrity guard `scripts/validate_devotional_pool.py` gives the
  devotional pool.

`test_hermeneutics.py` (fake LLM)

- All eight phases emit, in order, followed by the synthesis.
- Phase 2 injects only the rulings whose triggers match the passage.
- Phase 4 keeps verified witnesses with their KJV text and drops
  unresolvable ones.
- Phase 4 states it plainly when fewer than two witnesses verify.
- Phase 8 `FAILED` is reported without retry and without suppressing the
  report.
- A chapter-sized request returns the narrowing reply instead of running.
- A range longer than 25 verses is refused; a 25-verse range is accepted.
- Every curated parable's reference is within the cap (a regression guard on
  the two settings that collided: the cap and the parable corpus).
- A post-report turn answers from `runDigest` instead of re-running.
- A phase that raises does not abort the run; its `status` is `error` and
  later phases still execute.

`test_hermeneutics_description.py`

- "the parable of the ten virgins", "ten virgins" and "the 10 virgins" all
  resolve to `MAT 25:1-13` from the curated table, with no LLM call.
- An explicit reference in the message wins over a description in it.
- An unrecognised description falls through to the LLM fallback, and an
  unparseable reply after one retry resolves to nothing rather than a guess.
- A resolution the user did not type verbatim is echoed back in the reply;
  an explicit reference is not.
- A doctrinal claim is classified as a claim, redirected with the bearing
  passage offered, and runs no phases; a claim that cites a passage runs that
  passage instead; a parable request is never classified as a claim, since
  the table answers before any classification.
- A resolved passage with no text in `Complete.db` stops the run before
  Phase 1, and stops it *before* the echo-back, whether the reference was
  described or typed.

`test_bible_search.py`

- `fetch_interlinear_sync` returns per-word Strong's, root and
  transliteration for a known verse, splitting `~` correctly.
- `fetch_strongs_entries_sync` reads the `Strongs_` table without importing
  the mybibletoolbox dependency.

`test_api.py`

- The mode dispatches on both `/chat` and `/chat/stream`.
- The SSE body emits N `phase` events, then **exactly one** `final`, then
  `trace`.

### Frontend — vitest

- `chatApi.test.ts` — `onPhase` fires once per phase event; a stream still
  throws if `final` never arrives; unknown event types are ignored.
- `PhaseList.test.tsx` — collapsed summary vs. expanded body; running vs.
  done vs. error; Phase 4 witness list; Phase 8 failure banner.
- `HermeneuticsArtifact.test.tsx` — renders all phases plus the Final
  Verified Interpretation from inline params.
- `ChatPane.test.tsx` — phase events accumulate onto the message and survive
  history truncation; the report pill opens the artifact.
- `ModePickerScreen.test.tsx` — the button creates a `hermeneutics` session.
- `SessionsPane.test.tsx` — the sidebar groups and labels the mode.

### Manual smoke

- 1 Thessalonians 4:15–18 (the methodology's own worked example) — compare
  phase output against the reference trace.
- Hebrews 6:4–6 — exercises Phase 5 priority resolution against a clear
  declaration.
- Job 1:21 — exercises Phase 3's recorded-fact verdict.
- Genesis 1 — confirms the narrowing reply rather than a run.
