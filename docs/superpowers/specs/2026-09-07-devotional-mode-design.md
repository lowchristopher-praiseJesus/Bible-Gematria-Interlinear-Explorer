# Devotional Mode Design Spec

**Date:** 2026-09-07
**Status:** Approved for planning

## Purpose

Add a **Devotional** study mode alongside the existing modes (Bible in a
Year, Verse of the Day, Parable Study, Topical Study, Ask Anything). The
user picks the mode, then chooses whether the devotional should be based on
a verse or theme **they** supply, or on a verse the **system** picks. Once
the seed verse is known, the backend sends it to the configured LLM with a
fixed devotional-writer prompt and generates a 1,200–1,600 word devotional.

The seed verse renders in the chat as the usual `VerseBubble`, with a
**"Read the devotional ▸"** link beneath it. Clicking the link opens the
finished devotional in the right-hand artifact pane. The chat input stays
open so the user can ask follow-up questions, which route through the normal
chat path.

## Scope

**In scope:**

- A new `'devotional'` member of `SessionMode`, with `MODE_LABELS` and
  `deriveTitle` entries.
- Additions to `ModeParams`: `source?: 'user' | 'system'` and
  `delivered?: boolean`. A `DevotionalArtifactParams` type
  (`{ reference: string; text: string }`) for the new artifact.
- A **"Devotional"** starter button in `ModePickerScreen`, using the
  existing `startWithChoices` helper to post two choice pills:
  *"I'll choose"* (`source: 'user'`) and *"Pick one for me"*
  (`source: 'system'`).
- Backend primer handling for `mode == 'devotional'` in `chatbot/api.py`:
  the buffered `/chat` endpoint returns a short instruction/ack message for
  the two pill selections; it never generates a devotional.
- A **streamed generating turn** on `/chat/stream`: a new `devotional`
  branch in `_stream_chat_response` that resolves the seed verse, fetches
  its translations + book context, and streams one long LLM completion
  using the devotional prompt.
- A new `chatbot/devotional.py` module: the prompt template, seed-verse
  resolution (`resolve_seed_verse`), theme→verse selection
  (`pick_verse_for_theme`) with a hardcoded fallback rotation, and the
  streamed builder (`stream_devotional`).
- A `max_tokens` parameter on `chatbot/ollama_client.py._build_request`
  (default unchanged at 2048; the devotional call passes 3600), threaded
  through a devotional-specific streamed completion helper.
- Frontend generating-turn wiring in `ChatPane`: a devotional-aware path in
  `streamAssistantReply` that discards body chunks (the existing typing
  indicator covers the wait), a one-shot auto-fire `useEffect` for
  `source: 'system'`, and an `updateModeParams(..., { delivered: true })`
  call once the turn resolves.
- `useArtifactStore.fetchForLink` gains a `case 'devotional'` that returns
  `link.params` verbatim (no network call).
- `ArtifactPane` renders a new `DevotionalArtifact` component for
  `type === 'devotional'`.
- A new `frontend/src/components/artifacts/DevotionalArtifact.tsx`:
  reference heading, `renderMarkdown(text)` in a reading-width wrapper, and
  a copy button.
- `ArtifactLink['type']` union in `frontend/src/lib/chatApi.ts` and
  `frontend/src/types/session.ts` gains `'devotional'`.
- Backend pytest coverage and frontend vitest coverage as detailed under
  **Testing**.

**Out of scope:**

- Persisting devotionals server-side, a devotionals library/history view,
  or dedup/caching of identical requests. Each devotional lives only on its
  chat message in `localStorage`, like every other chat artifact.
- A curated devotional-verse data file. The system-picked verse comes from
  a single LLM call with a small hardcoded fallback list.
- Scheduling / "devotional of the day" / notifications / email.
- Multi-verse devotionals assembled from several unrelated references. A
  single reference or a single contiguous range is the unit; free-text that
  isn't a reference is treated as a theme.
- Follow-up question chips under the devotional. The chat input stays open
  for manual follow-ups; no generated chips.
- Editing, regenerating in place, or versioning a delivered devotional. The
  user can send another message / start another session.
- Translation choice for the seed verse. KJV (from the existing
  multi-translation fetch) is used, consistent with Verse of the Day's
  primer.
- Streaming the devotional body text visibly into the chat bubble or into
  the artifact pane. It is generated on the assistant turn and the link
  reveals the finished text.
- Any change to how the other five modes behave.

## Architecture

### Mode lifecycle

```
ModePicker: click "Devotional"
  → startWithChoices('devotional', '📖 Devotional',
      'Would you like a devotional on a verse or theme you choose, or one I pick for you?',
      [ { label: "I'll choose",     modeParams: { source: 'user'   } },
        { label: 'Pick one for me', modeParams: { source: 'system' } } ])
  → session created; user bubble + assistant bubble carrying the 2 pills.
    No backend call yet.

Pill "I'll choose"  → resolveChoice merges { source: 'user' }
  → postChat('', mode=devotional, mode_params={ source:'user' })
  → backend primer → plain chat message:
     "Tell me a verse reference (e.g. John 3:16) or a theme
      (e.g. 'facing anxiety'), and I'll write you a devotional."
  → user types  → ChatPane.sendMessage → streamAssistantReply (generating turn)

Pill "Pick one for me"  → resolveChoice merges { source: 'system' }
  → postChat('', mode=devotional, mode_params={ source:'system' })
  → backend primer → short ack: "Let me find a verse for you…"
  → ChatPane auto-fire effect (source==='system' && !delivered && last msg is the ack)
     fires generateDevotional() → streamAssistantReply with message: '' (generating turn)
```

### Generating turn (always `/chat/stream`)

```
postChatStream({ message, mode:'devotional', mode_params:{ source, ... } })
  → api.py  _stream_chat_response  → devotional branch (before route_deterministic)
      → resolve_seed_verse(raw=message, source)
          • source=='user' & looks like a ref  → _resolve_verse_reference(raw)
          • else (theme text, or empty/system)  → pick_verse_for_theme(theme_or_None)
              - one short non-streamed LLM call → parse ref with _find_flexible_verse_refs
              - parse fail → retry once → random.choice of the fallback rotation
          → fetch_verse_translations(ref, ['eng']); empty → DevotionalError
      → fetch book_context(usfm)
      → stream_devotional(): streamed LLM completion, max_tokens=3600
          • yields {"type":"stream","chunk": …}  (bytes keep flowing; proxy/idle-timeout safe)
      → final SSE event:
        { "type": "verse",
          "message": "Here's a devotional on **{ref}**.",
          "data": { "reference": ref,
                    "translations": { … },
                    "book_context": { … } | null,
                    "devotional": "<full markdown>" },
          "artifacts": [ { "type": "devotional",
                           "label": "Read the devotional ▸",
                           "params": { "reference": ref, "text": "<full markdown>" } } ],
          "route": "Mode → devotional → {model}" }
      → terminal `trace` event (unchanged plumbing)
  → ChatPane stores the message; discards stream chunks; sets modeParams.delivered = true
```

Rendered result: `VerseBubble` (from `msg.type === 'verse'` + `msg.data`) plus
the `devotional` artifact pill (from `msg.artifacts`, already rendered by
`ChatPane`'s artifact loop).

```
click "Read the devotional ▸"
  → openArtifact({ type:'devotional', label:'Read the devotional ▸',
                   params:{ reference, text } })
  → fetchForLink → returns params (no network) → status 'ready'
  → ArtifactPane → <DevotionalArtifact reference={…} text={…} />
```

### Post-delivery

`modeParams.delivered === true` makes the `devotional` branch in both
`post_chat` and `_stream_chat_response` a no-op, so every later message in
the session falls through to `route_deterministic` → AI fallback exactly
like `freeform` (including `_enhance_with_cited_verse` boxing any verse the
answer cites). The session keeps its "Devotional" label and title.

## Components

### `chatbot/devotional.py` (new)

- `DEVOTIONAL_PROMPT_TEMPLATE: str` — the full devotional-writer prompt
  (verbatim as provided), with the literal `[INSERT VERSE AND REFERENCE]`
  marker replaced at call time by:

  ```
  {reference} (KJV)
  {verse_text}
  ```

  For a range, verses are joined into one block, verses separated by a
  space, prefixed once by the range reference.

- `DEVOTIONAL_SYSTEM_PROMPT: str` — a single line
  (`"You are an experienced Christian devotional writer."`). The standard
  `_SYSTEM_PROMPT_BASE` research grounding is **not** used here; the
  devotional prompt is self-contained.

- `class DevotionalError(Exception)` — raised when the seed verse can't be
  resolved to any verse text.

- `FALLBACK_VERSES: list[str]` — `["JHN 14:27", "PSA 23:1", "ISA 41:10",
  "ROM 8:28", "PHP 4:6-7", "MAT 11:28"]`.

- `async def pick_verse_for_theme(theme: str | None) -> str` — one
  non-streamed LLM call:
  *"Suggest one Bible verse for a devotional{ on the theme: '<theme>'}.
  Reply with only the reference, e.g. `John 14:27`. Choose a well-known,
  pastorally rich verse; vary your choice."* Parse with
  `_find_flexible_verse_refs` → `_format_reference`. On parse failure retry
  once; on a second failure return `random.choice(FALLBACK_VERSES)`. If the
  LLM is unconfigured, return `random.choice(FALLBACK_VERSES)` directly.

- `async def resolve_seed_verse(raw: str | None, source: str) -> tuple[str, str]`
  — returns `(usfm_ref, verse_text)`.
  1. `source == 'user'` and `_resolve_verse_reference(raw)` succeeds → that
     ref.
  2. Otherwise → `pick_verse_for_theme(raw or None)` (a non-empty `raw`
     under `source == 'user'` that isn't a ref is the theme).
  3. `fetch_verse_translations(ref, languages=['eng'])`; join the KJV text
     for the verse or range. Empty result → `raise DevotionalError`.

- `async def stream_devotional(raw, source, page_context) -> AsyncIterator[dict]`
  — resolves the seed verse (reusing the `resolve_seed_verse` translations
  fetch), builds the prompt, and delegates to a devotional-specific
  streamed completion (see below). Yields `{"type": "stream", "chunk": …}`
  events, may yield one `{"type": "error", "message": …}` if the LLM
  stream fails, and finally
  `{"type": "done", "text": "<full>", "reference": ref, "translations": {…}}`.
  The `translations` are passed through from `resolve_seed_verse` so the
  `api.py` branch does not re-fetch them; book context (a local lookup) is
  still fetched by the branch.

### `chatbot/ollama_client.py`

- `_build_request(messages, *, stream, max_tokens: int = 2048)` — the new
  keyword is written into `payload["options"]["max_tokens"]` (Ollama) and
  `payload["max_tokens"]` (NVIDIA). All existing callers keep the 2048
  default with no change.
- `async def stream_devotional_completion(system_prompt, user_prompt) -> AsyncIterator[dict]`
  — a thin sibling of `stream_chat_with_ollama` that takes an explicit
  system + user prompt (no research-data assembly, no history,
  `max_tokens=3600`), runs the `llm_unconfigured_error()` guard, records an
  LLM trace step, and yields the same `{"type": "stream"|"done"|"error"}`
  shape.

### `chatbot/api.py`

A `devotional` branch added to **both** `post_chat` and
`_stream_chat_response`, positioned immediately after the Topical-Study
`series_id` special-case and before `route_deterministic`:

```python
md = request.mode_params or {}
if request.mode == "devotional" and not md.get("delivered"):
    raw = request.message.strip()
    source = md.get("source", "user")

    # ---- buffered /chat: primer / ack only, never generates ----
    if <post_chat> and not raw:
        text = ("Tell me a verse reference (e.g. John 3:16) or a theme "
                "(e.g. 'facing anxiety'), and I'll write you a devotional."
                if source == "user"
                else "Let me find a verse for you…")
        return _with_trace({"type": "chat", "message": text, "data": None,
                            "route": f"Mode primer → devotional ({source})"})

    # ---- streaming /chat/stream: the generating turn ----
    try:
        ref = None
        async for ev in stream_devotional(raw or None, source, request.page_context):
            if ev["type"] == "stream":
                yield await sse_event("stream", {"chunk": ev["chunk"], "text": ""})
            elif ev["type"] == "error":
                stream_error = ev["message"]
            elif ev["type"] == "done":
                full_text, ref, translations = ev["text"], ev["reference"], ev["translations"]
        if stream_error:
            result = {"type": "error", "message": stream_error, "data": None, "route": "Error path"}
        else:
            book_context = get_book_context(ref.split(" ")[0].upper())
            result = {
                "type": "verse",
                "message": f"Here's a devotional on **{ref}**.",
                "data": {"reference": ref, "translations": translations,
                         "book_context": book_context, "devotional": full_text},
                "artifacts": [{"type": "devotional", "label": "Read the devotional ▸",
                               "params": {"reference": ref, "text": full_text}}],
                "route": f"Mode → devotional → {active_model_label()}",
            }
    except DevotionalError:
        result = {"type": "error",
                  "message": "I couldn't find text for that reference — try another verse or a theme.",
                  "data": None, "route": "Mode → devotional → unresolved"}
    _note_outcome(result)
    yield await sse_event("final", {"result": result})
    return
```

The buffered `post_chat` branch handles only the two empty-message primer
cases; a non-empty devotional request that somehow reaches `post_chat`
falls through to the normal buffered path (safety net, not a supported
flow).

### `frontend/src/components/shell/ModePickerScreen.tsx`

One more `STARTER_BUBBLE` button ("Devotional", a lucide glyph — likely
`HeartHandshake` or `BookHeart`, finalised in a `ui-ux-pro-max` pass so it
sits consistently with the existing five):

```tsx
<button className={STARTER_BUBBLE} onClick={() =>
  startWithChoices(
    'devotional',
    '📖 Devotional',
    'Would you like a devotional on a verse or theme you choose, or one I pick for you?',
    [
      { label: "I'll choose",     modeParams: { source: 'user'   } },
      { label: 'Pick one for me', modeParams: { source: 'system' } },
    ]
  )
}>
  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> Devotional
</button>
```

### `frontend/src/components/shell/ChatPane.tsx`

- `streamAssistantReply` gains an optional `opts?: { devotional?: boolean }`.
  When `devotional` is set, the `onChunk` handler passed to `postChatStream`
  is a no-op (body chunks are not written into the bubble); the message is
  created up front with empty text so the `isBusy` typing indicator shows,
  and only the resolved `final` payload populates it.
- A `generateDevotional()` callback: `streamAssistantReply(genId(),
  { message: '', mode: 'devotional', mode_params: { ...session.modeParams } },
  { devotional: true })`, then `updateModeParams(sessionId,
  { delivered: true })` in a `finally`.
- `sendMessage` already forwards `session.mode` + `session.modeParams`; when
  `session.mode === 'devotional' && !session.modeParams.delivered`, it calls
  the same `{ devotional: true }` path and sets `delivered` afterward.
- Auto-fire `useEffect`: keyed on
  `[session?.mode, session?.modeParams.source, session?.modeParams.delivered,
  session?.messages.length]`. Fires `generateDevotional()` once (guarded by
  a `useRef<boolean>`) when: mode is `devotional`, `source === 'system'`,
  `delivered` is falsy, not currently `isBusy`, and the last message is the
  assistant ack (no user turn yet). The ref is set before the call and never
  reset, so an errored generation does not auto-retry.

### `frontend/src/components/artifacts/DevotionalArtifact.tsx` (new)

```tsx
interface Props { reference: string; text: string }
```

- `<h2>` with `reference`.
- `renderMarkdown(text)` inside a `max-w-prose` / relaxed line-height
  wrapper for long-form reading.
- A copy button (clipboard write + 1.5s check state), reusing the pattern
  from `ChatPane.copyMessage`.
- No loading/error/empty states — `text` is always present.

### `frontend/src/store/useArtifactStore.ts`

`fetchForLink`: add `case 'devotional': return link.params`. `sameArtifact`
already compares `JSON.stringify(params)`, so re-clicking the same link is a
correct no-op and back/forward history works unchanged.

### `frontend/src/components/shell/ArtifactPane.tsx`

One line in the `status === 'ready' && activeArtifact && !!data` block:

```tsx
{activeArtifact.type === 'devotional' &&
  <DevotionalArtifact {...(data as DevotionalArtifactParams)} />}
```

### `frontend/src/types/session.ts` / `frontend/src/lib/chatApi.ts`

- `SessionMode` gains `'devotional'`.
- `ModeParams` gains `source?: 'user' | 'system'` and `delivered?: boolean`.
- `ArtifactLink['type']` (both definitions) gains `'devotional'`.
- New `interface DevotionalArtifactParams { reference: string; text: string }`.
- `MODE_LABELS.devotional = 'Devotional'`; `deriveTitle` returns
  `'Devotional'` (or `Devotional — {reference}` once a seed verse is known,
  if cheap to thread through — optional polish, not required).

## Data flow

```
pill click
  → resolveChoice merges { source } into session.modeParams
  → postChat('', mode='devotional', mode_params)          [buffered]
  → primer text ("type a verse…" | "let me find one…")

generating turn  (user text under source:user, OR auto-fired '' under source:system)
  → postChatStream(mode='devotional', mode_params={ source })   [SSE]
  → api.py devotional branch
      → resolve_seed_verse
          ref?  → _resolve_verse_reference
          theme / empty / system → pick_verse_for_theme → (LLM | retry | random fallback)
      → fetch_verse_translations (KJV)            → DevotionalError if empty
      → stream_devotional: LLM stream, max_tokens 3600
          stream events flow; ChatPane shows typing dots, discards chunk text
      → get_book_context
      → final event: type='verse'
            data = { reference, translations, book_context, devotional }
            artifacts = [ { type:'devotional', params:{ reference, text } } ]
            no follow_up_questions
  → ChatPane: append message, updateModeParams({ delivered: true })

render: VerseBubble  +  [ Read the devotional ▸ ]

click link
  → openArtifact({ type:'devotional', params:{ reference, text } })
  → fetchForLink returns params (no network) → status 'ready'
  → ArtifactPane → DevotionalArtifact

later messages in the session
  → mode='devotional', modeParams.delivered=true
  → devotional branch is a no-op → route_deterministic → AI fallback (freeform-equivalent)
```

## Error handling

| Failure | Behavior |
|---|---|
| Theme→verse LLM pick unparseable | retry once, then `random.choice(FALLBACK_VERSES)`. Never blocks generation. |
| LLM unconfigured at pick time | skip the call, use `random.choice(FALLBACK_VERSES)`. |
| `fetch_verse_translations` empty for the resolved ref | `DevotionalError` → `final` event `type:'error'`: "I couldn't find text for that reference — try another verse or a theme." `delivered` is **not** set; the user can retry from the chat input. |
| LLM stream errors mid-generation | existing `_stream_chat_response` error handling → `type:'error'` with provider detail; `delivered` not set. |
| LLM unconfigured at generation time | the streaming path's existing `llm_unconfigured_error()` guard returns the standard "LLM is not configured" error. |
| Malformed / gibberish reference under `source:'user'` | not a ref → treated as a theme → LLM picks a verse. Acceptable. |
| Non-empty devotional request hits buffered `post_chat` | falls through to a normal buffered generation (not a supported path, no crash). |
| Auto-fire re-entrancy | `useRef` guard fires the generation once per session mount; an errored generation does not auto-retry — the user retries manually. |
| Reload mid-generation | the in-flight turn is lost (no assistant message was persisted); the session shows the ack and the auto-fire ref is fresh, so on next mount `source:'system'` re-fires once. `source:'user'` waits for input. |

## Testing

### Backend — `chatbot/tests/` (pytest, already configured)

- **`resolve_seed_verse`**
  - explicit ref: `("John 14:27", "user")` → `("JHN 14:27", <kjv text>)`.
  - range: `("Psalm 23:1-3", "user")` → `("PSA 23:1-3", <joined text>)`.
  - theme path: `("facing anxiety", "user")` with `pick_verse_for_theme`
    mocked → returns the mocked ref + text.
  - empty translations (mock `fetch_verse_translations` → `{}`) →
    `DevotionalError`.
- **`pick_verse_for_theme`**
  - mocked LLM returns `"John 14:27"` → `"JHN 14:27"`.
  - mocked LLM returns prose without a ref → retried once → still none →
    result is in `FALLBACK_VERSES` (monkeypatch `random.choice` to assert
    the fallback branch is hit).
  - `llm_unconfigured_error()` truthy → returns a `FALLBACK_VERSES` member
    without calling the LLM.
- **`post_chat` devotional branch**
  - `mode='devotional'`, `message=''`, `source='user'` → `type:'chat'`,
    message contains "verse reference".
  - `source='system'`, `message=''` → `type:'chat'`, message is the ack.
  - `mode_params={'delivered': True}` → branch not taken (assert it routes
    onward, e.g. by asserting a deterministic response for a verse-ref
    message).
- **`_stream_chat_response` devotional generating turn**
  - mock `stream_devotional` to yield two `stream` chunks + a `done` with
    text/ref. Assert: ≥1 `stream` SSE event; exactly one `final` event;
    `final.result.type == 'verse'`; `data.devotional` non-empty;
    `data.reference` set; `artifacts[0].type == 'devotional'` and
    `artifacts[0].params.text == data.devotional`; no `follow_up_questions`;
    a terminal `trace` event.
  - mock `stream_devotional` to yield an `error` event → `final.result.type
    == 'error'`.
  - `stream_devotional` raising `DevotionalError` → `final.result.type ==
    'error'` with the "couldn't find text" copy.
- **Prompt assembly**
  - `[INSERT VERSE AND REFERENCE]` no longer present in the built user
    prompt; the reference and verse text are present; `_SYSTEM_PROMPT_BASE`
    text is **absent** from the system prompt.
- **`_build_request`**
  - default call → `max_tokens` 2048 in the payload (both providers).
  - `max_tokens=3600` → reflected under `options.max_tokens` (Ollama) and
    top-level `max_tokens` (NVIDIA).

### Frontend — vitest

- **`ModePickerScreen`**: "Devotional" button renders; click creates a
  session with `mode: 'devotional'` and an assistant message whose
  `choices` are the two pills with `modeParams.source` `'user'` / `'system'`.
- **`ChatPane`**
  - `source: 'system'` + ack primer present → auto-fire calls
    `postChatStream` once (mocked); body chunks passed to `onChunk` do
    **not** appear in the rendered bubble; on resolve the message is
    `type: 'verse'` with a `devotional` artifact and `modeParams.delivered`
    becomes `true`.
  - `source: 'user'` → no auto-fire; submitting a message triggers the
    stream with `mode: 'devotional'`, and `delivered` is set afterward.
  - after `delivered: true`, a further message calls the stream with the
    normal (non-devotional) handling (assert `onChunk` output is rendered).
- **`DevotionalArtifact`**: renders the `reference` heading and the markdown
  body; the copy button writes `text` to `navigator.clipboard`.
- **`useArtifactStore`**: `openArtifact({ type: 'devotional', params })` →
  `status: 'ready'`, `data === params`, no `fetch` call.

### Manual smoke

Run `python myproject.py` plus the chatbot service. Exercise both pills
against a live LLM: confirm the devotional turn shows the typing dots (not
streamed prose in the bubble), the seed verse renders as a `VerseBubble`,
the "Read the devotional ▸" link opens the pane with the full text, a page
reload keeps the message and the link still opens it, and a follow-up
question after delivery routes like a normal chat question.

## Open questions

None blocking. Deferred polish: the exact lucide glyph and label placement
for the starter button (settle in a `ui-ux-pro-max` pass during
implementation); whether `deriveTitle` should include the seed reference
once known.
