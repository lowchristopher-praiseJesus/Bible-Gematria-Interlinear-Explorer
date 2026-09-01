# Topical Study — LLM-Wiki Integration Design Spec

**Date:** 2026-09-01
**Status:** Approved for planning

## Purpose

Replace Topical Study mode's hardcoded, seed-reference-only topic list with a
library of ingested **LLM wikis** — structured, interlinked markdown
knowledge bases built per Andrej Karpathy's ["append and review" LLM-wiki
pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).
The first is *The Present-Day Ministry of Jesus and How It Empowers You*
(Joseph Prince, New Creation Church, 10-part sermon series), currently at
`~/Downloads/The Present Day Ministry Of Jesus And How It Empowers You`.

Instead of a curated list of Bible-topic pills that each just point at a
handful of seed verses, Topical Study becomes: pick a series → browse that
series' concepts as full pages (synthesis, quotes, cross-references) → ask
free-text follow-up questions answered from that series' own wiki content.

## Scope

**In scope:**
- A registerable *library* of ingested study wikis, starting with the one
  series above, designed so future series can be added by copying a folder
  and adding one config entry — no code changes.
- A backend loader/index for a wiki's `wiki/concepts/`, `wiki/entities/`,
  `wiki/sources/` markdown pages (frontmatter + body), and a keyword-scored
  retrieval function used to ground free-text Q&A.
- Resolving `[[wikilink]]` cross-references and inline scripture citations
  (e.g. `Heb 4:14–15`) in wiki page bodies into clickable links back into
  this app (other wiki pages, and this app's own Explorer artifact).
- Router (`chatbot/router.py`) and frontend changes to replace the current
  `topic` mode's picker/primer/answer flow.
- Removing `chatbot/data/topics.py` and its 8 hardcoded topics entirely.

**Out of scope:**
- Editing or maintaining the wiki content itself (ingest/query/lint
  workflows) — that's the wiki's own `AGENTS.md` process, run separately,
  outside this app.
- Vector embeddings / semantic search (see "Rejected approaches").
- Any change to Bible in a Year, Parable Study, or freeform chat modes.
- Migrating old persisted sessions that reference the removed `topic_id`
  shape — they degrade gracefully via the router's existing "unknown topic"
  error branch (see Error Handling).
- Multi-user / server-side sync of the wiki library — it's local files on
  this machine, same trust model as `Complete.db`.

## Data Storage & Registration

**Library location.** A new directory, `~/Documents/study-wikis/`, holds
registered wikis, external to this git repo. Two reasons: (1) transcripts
and audio under a wiki's `raw/` are copyrighted sermon recordings and must
never be committed; (2) it must survive independently of `~/Downloads`
being cleaned out. The first implementation step copies (`cp -R`, not
`mv`) `~/Downloads/The Present Day Ministry Of Jesus And How It Empowers
You` to `~/Documents/study-wikis/present-day-ministry-of-jesus/` — the
Downloads original is left untouched, per that wiki's own `AGENTS.md`
(`raw/` is "immutable... never edit or delete", and by extension the human
owns this whole source folder).

**Registration config**, `chatbot/data/study_wikis.py` — same append-only
convention as the `topics.py` file it replaces:

```python
"""Registered LLM-wiki study series for Topical Study mode.

Append new entries here as more series are ingested — no other code needs
to change when the list grows. `path` points into the external wiki
library (~/Documents/study-wikis/), not this repo.
"""

STUDY_WIKI_LIBRARY = [
    {
        "id": "present-day-ministry-of-jesus",
        "title": "The Present-Day Ministry of Jesus and How It Empowers You",
        "speaker": "Joseph Prince",
        "description": (
            "10-part series on what Jesus is doing now as high priest at "
            "the Father's right hand, mostly from Hebrews."
        ),
        "path": "~/Documents/study-wikis/present-day-ministry-of-jesus",
    },
]
```

Adding a future series: copy its folder into the library directory, append
one entry here, restart the chatbot service. Each entry's `path` is
expected to follow the same three-layer schema (`raw/`, `wiki/`,
`AGENTS.md`) documented in that wiki's own `AGENTS.md` — this app doesn't
enforce or duplicate that schema, it just reads `wiki/concepts/`,
`wiki/entities/`, `wiki/sources/`.

## Backend Architecture

### `chatbot/wiki_loader.py` (new)

Parses every registered wiki into memory once at chatbot-service startup
(process restart picks up library changes — consistent with the rest of
`chatbot/`, which has no hot-reload). No new dependency: frontmatter is a
fixed, small, documented schema (see each wiki's `AGENTS.md` §4), so it's
split by hand (`---`-delimited YAML block + body) rather than pulling in a
YAML/frontmatter library.

In-memory shape per registered series:

```python
{
  "manifest": {...},  # the STUDY_WIKI_LIBRARY entry
  "pages": {
    "grace": {
      "kind": "concept",       # concept | entity | source
      "title": "Grace",
      "tags": ["grace", "core"],
      "aliases": [],
      "body": "<raw markdown, wikilinks/scripture refs unresolved>",
    },
    ...
  },
}
```

Public functions:
- `list_series() -> list[dict]` — the manifest list, for the series picker.
- `list_concepts(series_id) -> list[dict]` — `kind == "concept"` pages
  (slug, title, tags), for the pill list.
- `get_page(series_id, slug) -> dict | None` — one page, `body` rendered
  through link resolution (below).
- `search(series_id, query, top_n=3) -> list[dict]` — pages ranked by
  keyword overlap between the query's tokens and each page's title +
  tags + aliases + body, for grounding free-text Q&A.

Startup behavior: a registered entry whose `path` doesn't resolve on disk
is logged and skipped (doesn't crash the service, just doesn't appear in
`list_series()`). An individual page with malformed/missing frontmatter is
skipped with a logged warning; the rest of that series still loads.

### Link resolution

Two constructs in a page's markdown body get resolved to plain `<a
href="...">` tags before the body reaches the frontend — the same
"legacy-link-as-plain-anchor, intercepted client-side" convention already
established for Strong's cross-references in `StrongsArtifact.tsx`:

- `[[wikilink]]` → `<a href="/topic-wiki?series=<series_id>&page=<slug>">Title</a>`.
  Unresolvable links (a `[[slug]]` with no matching page) are left as
  plain text, not a dead link.
- Scripture citations (`Heb 4:14–15`, `Gal 2:20`, `1 Pet 5:7`, ranges
  included) → `<a href="/explorer?reference=...">`, using the existing
  `book_codes.parse_reference` abbreviation table already imported in
  `chatbot/tools.py` (the same one the app uses elsewhere), so citation
  abbreviations resolve exactly as they do everywhere else in this app.
  A citation that doesn't parse cleanly is left as plain text.

### `chatbot/wiki_qa.py` (new) — free-text Q&A

`ollama_client.py`'s `chat_with_ollama` currently always builds its system
prompt via `_fetch_research_data`, which regex-scans for verse references.
That function's "build system prompt with research data, call Ollama"
tail is factored out into a shared helper both callers use, so
`wiki_qa.py` doesn't duplicate the HTTP-call/error-handling logic:

```python
# ollama_client.py
async def _call_ollama_with_context(
    message: str,
    research_data: str,
    conversation_history: list[dict] | None,
    page_context: str | None,
) -> dict:
    """The existing chat_with_ollama() body, minus the
    _fetch_research_data() call — research_data is now a parameter."""
```

`chat_with_ollama` keeps its current signature/behavior (verse-ref
scanning) by calling this with `_fetch_research_data`'s output.

`wiki_qa.answer(series_id, message, conversation_history) -> dict`:
1. Calls `wiki_loader.search(series_id, message)`.
2. If nothing scores above a minimal relevance floor → returns a `chat`
   response suggesting a few concept names from that series instead of
   calling Ollama (see Error Handling — no hallucinating from empty
   context).
3. Otherwise formats the matched pages (title + trimmed body + citation:
   series title, speaker, source part) as `research_data` and calls
   `_call_ollama_with_context`, with a system prompt instructing the model
   to answer *only* from the supplied context and to close with a
   citation line naming the series/speaker/part (light-touch attribution
   — a line, not a banner, matching how source citations already read
   inside the wiki's own concept pages).
4. Also returns the single best-matched page's `(series_id, slug)` so the
   frontend can *offer* — not force — opening that concept as an
   Artifact.

## Router Integration (`chatbot/router.py`)

`mode == "topic"`'s `mode_params` shape changes from today's `{topic_id}`
to `{series_id, concept_slug}` (both optional, resolved progressively):

| `mode_params` | Primer behavior |
|---|---|
| `{}` | If `len(list_series()) > 1`: series-picker primer (title/speaker/description per entry). If exactly 1: auto-resolves to it (mirrors the existing "skip the choice if already known" pattern from Bible in a Year). If 0: "no study series available yet" message. |
| `{series_id}` | Concept-pill primer: `wiki_loader.list_concepts(series_id)`. |
| `{series_id, concept_slug}` | Renders that concept's page (`wiki_loader.get_page`) as primer content. |

Once a session is resolved to a `series_id`, any further **free-text**
message in that session (not a pill click) is routed to `wiki_qa.answer()`
instead of the old deterministic seed-reference reply — this is the one
behavior in Topical Study mode that becomes LLM-backed rather than fully
deterministic, matching how freeform chat already works.

`chatbot/data/topics.py` and `get_topic()` are deleted. The removal is
covered by the router's pre-existing branch: a session created before this
change, whose persisted `mode_params.topic_id` no longer resolves to
anything, already falls into the current "Unknown topic" error branch
(`router.py:970-976`) — no new handling needed, just note it doesn't
crash.

## Frontend

**Series/concept picker.** `ModePickerScreen.tsx`'s Topical Study entry
creates a session with `mode: 'topic'`, `modeParams: {}` (unchanged
trigger). What renders next follows the primer's response:
- Series picker (new component, list-of-choices UI matching the existing
  parable-list/reading-plan-choice pattern) when there's more than one
  registered series.
- Concept pills (existing pill-rendering path in `ChatPane.tsx`, now fed
  by `wiki_loader.list_concepts()` results instead of `topics.py`).

**Concept page display.** Picking a concept pill produces a short
assistant chat reply plus a new Artifact type, `wiki_concept`, opened in
the side panel — full-length prose belongs in the Artifact pane, same
reasoning as Strong's definitions. New `WikiConceptArtifact.tsx`, modeled
directly on `StrongsArtifact.tsx`: renders the resolved HTML body via
`dangerouslySetInnerHTML` with an `onClick` handler on the container that
intercepts anchor clicks and dispatches on href shape:
- `/explorer?reference=...` → `openArtifact({ type: 'explorer', params: { reference } })`
- `/topic-wiki?series=...&page=...` → `openArtifact({ type: 'wiki_concept', params: { seriesId, slug } })`

Both go through `useArtifactStore.openArtifact`, which already pushes
onto the `history` stack built for the Strong's back-button fix — so
wandering Grace → Holiness → a scripture ref → back → back works with no
new history logic.

**Free-text follow-up.** The chat input stays open in a topic session as
today. A typed message is sent with the session's `series_id` in
`modeParams`; `wiki_qa`'s response renders as a normal assistant chat
message. If it names a best-matched concept, the frontend offers a link
to open that concept's Artifact (matching the existing "artifact links
attached to chat responses" pattern) rather than auto-opening it, so a
quick back-and-forth Q&A doesn't repeatedly steal focus to the side panel.

**Attribution.** Every concept page and every wiki-grounded chat answer
ends with a small citation line (series title, speaker, part) styled like
existing muted secondary-text (`resultSummary`-style) lines — no banner,
no distinct color treatment, per the "light touch" decision.

## Error Handling

- Empty `STUDY_WIKI_LIBRARY` → Topical Study's primer returns a clear
  "no study series available yet" message instead of an empty picker.
- A registered `path` that doesn't resolve on disk → loader logs and
  skips that entry at startup; it doesn't crash the chatbot service, it
  just won't appear in `list_series()`.
- `wiki_qa.search()` returning nothing above the relevance floor → a
  plain fallback message suggesting a few real concept names from that
  series, instead of calling Ollama with empty/near-empty context.
- A page with malformed or missing frontmatter → skipped with a logged
  warning; doesn't fail the rest of that series' load.
- An unresolvable `[[wikilink]]` or unparseable scripture citation →
  left as plain text rather than a dead or broken link.
- Old persisted sessions with the pre-migration `{topic_id}` shape →
  covered by the router's existing "Unknown topic" branch; no crash, no
  new code required.

## Testing

- `chatbot/wiki_loader.py`: unit tests against a small fixture wiki
  checked into `tests/chatbot/fixtures/` (a couple of concept/entity
  pages, one with a `[[wikilink]]`, one with a scripture citation, one
  with deliberately broken frontmatter) — covers `list_series`,
  `list_concepts`, `get_page`, `search`, link resolution, and the
  skip-on-missing-path / skip-on-bad-frontmatter paths.
- `chatbot/wiki_qa.py`: unit tests with a stubbed Ollama call — context
  assembly from `search()` results, the no-match fallback, and the
  best-matched-page passthrough.
- `chatbot/router.py`: extends `tests/chatbot/test_mode_primers.py` for
  the new `topic` mode_params progression (empty → series picker →
  concept pills → concept page → free-text routing) and the
  single-series auto-skip.
- Frontend: new `WikiConceptArtifact.test.tsx` (modeled on
  `StrongsArtifact.test.tsx` — link interception for both href shapes,
  history push/back); `ModePickerScreen`/`ChatPane` test updates for the
  new series-picker step.
- One live browser pass after implementation: open Topical Study → land
  on/pick the series → open a concept → click a scripture ref (lands in
  Explorer) → click a wikilink (lands on another concept; back button
  returns) → ask a free-text follow-up question and confirm the answer
  cites the series/speaker.

## Rejected Approaches

- **SQLite FTS5 index** instead of the in-memory keyword-scored search —
  better ranking (BM25) and doesn't hold everything in RAM, but is real
  infrastructure for what's currently one ~100-page wiki. Documented here
  as the natural upgrade if the library grows to many large series and
  keyword scoring stops being good enough.
- **Embeddings / vector search** for semantic retrieval — no vector store
  exists in this stack today, and would add an embedding-API dependency.
  Rejected because the wiki format is *designed* to be keyword-findable
  (curated `tags`, `aliases`, and concept titles per page per that wiki's
  own `AGENTS.md` schema), so keyword scoring already does most of the
  useful work this corpus needs.
- **Keeping the 8 curated Bible topics alongside ingested wiki series** —
  considered, but explicitly rejected: Topical Study becomes 100%
  wiki-driven, and `chatbot/data/topics.py` is deleted rather than kept
  as a parallel "Bible Topics" category.
