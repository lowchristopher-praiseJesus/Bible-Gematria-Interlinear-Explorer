# Devotional "Pick one for me" — Annual Seeded-Shuffle Rotation

**Status:** design
**Supersedes:** the "A curated devotional-verse data file … a single LLM call
with a small hardcoded fallback list" *Out of scope* bullet in
`2026-09-07-devotional-mode-design.md`.

## Problem

In Devotional mode, "Pick one for me" (`source: 'system'`, empty message)
resolves its seed verse through `pick_verse_for_theme(None)` — a single
**stateless** LLM call with a fixed prompt (`chatbot/devotional.py:146`).
The model has no memory between calls and, asked for "one well-known Bible
verse for a devotional", returns its modal answer — **Psalm 23:1** —
essentially every time. The list that *would* vary
(`random.choice(FALLBACK_VERSES)`, 6 entries) only runs when the LLM is
unconfigured or returns garbage twice.

A user who taps "Pick one for me" daily should get a **different verse every
day for at least a full year**, with no noticeable recycling.

## Approach

Replace the LLM call *on the no-theme path only* with a deterministic draw
from a **curated pool of ≥ 366 verse references**, dealt as a **shuffled
deck** (draw without replacement): each verse appears exactly once before
any repeat. The deck order is a per-browser seeded permutation; a monotonic
cursor advances one step per delivered devotional. When the cursor passes
the end of the pool, the next "epoch" is a fresh permutation of the same
pool (seeded by `seed` + epoch number), so year 2 is a new order rather
than an identical replay.

- **Themed** picks ("facing anxiety") and typed references are unchanged —
  they still go through `_resolve_verse_reference` / `pick_verse_for_theme`.
- The rotation pick is a **pure function** over a static list: no network,
  no LLM, cannot fail for a non-negative cursor. The "always Psalm 23:1"
  behaviour is structurally removed for this path.
- `FALLBACK_VERSES` stays only as the themed path's LLM-failure fallback.

### Why a seeded permutation and not stored "used" state

The devotional endpoint is stateless and the app has no user accounts
(sessions live in browser `localStorage`). A permutation seeded by
`(seed, epoch)` is fully recomputable from two integers the client holds,
so "which verses have been used" never has to be stored or transmitted —
only `seed` (random, per browser, generated once) and `cursor` (count of
delivered rotation devotionals).

### Coverage math

Independent random draws from even a 2,000-verse pool throw a repeat within
~30 draws on average (birthday problem). A shuffled deck of N ≥ 366
guarantees N unique picks before the first repeat. Hence: **deck, not
dice**, and **N ≥ days in the window**.

## Data model

### Backend

- `chatbot/data/devotional_verses.py` — new. `DEVOTIONAL_POOL: tuple[str, ...]`,
  ≥ 366 USFM references (`"PSA 23:1"`, `"1CO 13:4-7"`), each matching
  `chatbot.devotional._USFM_REF_RE`, no duplicates, each resolvable to a
  real verse with KJV text in `Complete.db`.
- `chatbot/devotional_rotation.py` — new.
  `pick_from_rotation(seed: int, cursor: int) -> str`. `divmod(cursor, N)`
  → `(epoch, offset)`; `random.Random(f"{seed}:{epoch}")` shuffles a copy
  of the pool; returns `order[offset]`. Negative cursor clamps to 0.
- `chatbot/devotional.py`:
  - `resolve_seed_verse(raw, source, rotation: tuple[int, int] | None = None)`
    — when there is no user reference **and** no theme **and** `rotation`
    is not `None`, seed = `pick_from_rotation(*rotation)`; otherwise
    unchanged.
  - `stream_devotional(raw, source, page_context=None, rotation=None)` —
    forwards `rotation` to `resolve_seed_verse`.
- `chatbot/api.py` — the `/chat/stream` devotional branch reads
  `rotation_seed` / `rotation_cursor` from `mode_params`; when both are
  present and integer-coercible it passes `rotation=(seed, cursor)` to
  `stream_devotional`, else `rotation=None` (older clients, themed path).

### Frontend

- `frontend/src/store/useDevotionalRotationStore.ts` — new. Zustand
  `persist`, key `bible-explorer-devotional-rotation`, version 1.
  `{ seed: number | null, cursor: number }`.
  `ensureSeed()` lazily sets `seed` to a random 31-bit int and returns it;
  `advance()` does `cursor += 1`; `reset()` clears both.
- `frontend/src/types/session.ts` — `ModeParams` gains
  `rotationSeed?: number` and `rotationCursor?: number`.
- `frontend/src/components/shell/ChatPane.tsx` — in `runDevotionalTurn`,
  when `modeParams.source === 'system'` and the message is empty (the
  rotation pick) and `modeParams.rotationSeed == null`: read
  `ensureSeed()` + `cursor` from the store, merge them into the request
  `mode_params`, and persist them onto the session via `updateModeParams`
  (so a retry after an errored turn reuses the same slot). On a
  non-error response for a rotation pick, call `advance()` alongside the
  existing `updateModeParams(sessionId, { delivered: true })`.

## Lifecycle

```
"Pick one for me"
  → resolveChoice merges { source: 'system' } into modeParams
  → ChatPane auto-fire effect  (source==='system' && !delivered)
  → runDevotionalTurn('')
       modeParams.rotationSeed == null && source==='system' && msg===''
         → seed = useDevotionalRotationStore.ensureSeed()
           cursor = useDevotionalRotationStore.getState().cursor
           merge { rotationSeed: seed, rotationCursor: cursor } into modeParams
           updateModeParams(sessionId, { rotationSeed, rotationCursor })
  → postChatStream({ message:'', mode:'devotional',
                     mode_params:{ source:'system', rotationSeed, rotationCursor } })
  → api.py devotional branch
       rotation = (rotation_seed, rotation_cursor)
       → stream_devotional('', 'system', page_context, rotation)
       → resolve_seed_verse('', 'system', rotation)
            no ref, no theme, rotation set → pick_from_rotation(seed, cursor)
            = shuffled_pool(seed, cursor // N)[cursor % N]
  → devotional streams; on the final non-error event
       runDevotionalTurn sets { delivered: true } and calls advance()  (cursor → cursor+1)
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Older client sends no `rotation_*` | `rotation=None` → existing `pick_verse_for_theme(None)` path. No regression, no crash. |
| Themed pick ("facing anxiety") | `raw` is a non-empty non-reference → treated as theme → `pick_verse_for_theme(theme)` unchanged; `rotation` ignored. |
| Errored generation, then retry | `rotationSeed`/`rotationCursor` already persisted on the session → same slot reused; `advance()` runs only on the eventual success, so no cursor gap or double-count. |
| Reload after an unfinished rotation turn | Session shows only the ack; `source:'system' && !delivered` re-fires once; persisted `rotationCursor` is reused → same verse. |
| `cursor` reaches `N` | `divmod` → epoch 1; `random.Random(f"{seed}:1")` is a fresh full permutation. Verses repeat (new order) — expected after a full year, as every printed one-year devotional does. |
| `Complete.db` absent (CI) | Pool **structural** tests (count, regex, uniqueness) run; the DB-resolution check is `pytest.skip`-ped. A local `scripts/validate_devotional_pool.py` does the full check against the real DB. |
| Two browsers / cleared storage | Each browser has its own `seed`; a fresh `seed` just starts a new permutation. No shared state expected. |

## Out of scope

- Server-side per-user rotation state or accounts.
- A devotionals history/library view, or dedup of identical deliveries.
- Calendar binding ("today's" verse tied to a date) or notifications.
- Changing the themed / typed-reference paths, or any other mode.
- Growing the pool beyond one year (N ≥ 732 for genuinely new year-2
  verses) — the epoch reshuffle is the accepted year-2 behaviour for v1.

## Testing

**Backend (pytest)**

- `tests/chatbot/test_devotional_pool.py` — `len(DEVOTIONAL_POOL) >= 366`;
  every entry matches `_USFM_REF_RE`; no duplicates; (DB-gated) every entry
  resolves in `Complete.db` with non-empty KJV.
- `tests/chatbot/test_devotional_rotation.py` — determinism (same
  `(seed, cursor)` → same ref); epoch 0 over `cursor` `0..N-1` yields all
  `N` distinct refs (a permutation); two different seeds do not produce an
  identical epoch-0 order; `cursor == N` and `cursor == N + 3` do not raise
  and land in epoch 1; negative cursor clamps to `cursor 0`.
- `tests/chatbot/test_devotional_resolve.py` — add: `resolve_seed_verse('',
  'system', rotation=(123, 0))` returns `pick_from_rotation(123, 0)`'s ref
  without calling `pick_verse_for_theme`; with `rotation=None` the old path
  still runs; a themed `raw` ignores `rotation`.
- `tests/chatbot/test_chat_stream_devotional.py` — add: a `mode_params`
  carrying `rotation_seed` + `rotation_cursor` reaches `stream_devotional`
  as `rotation=(seed, cursor)`; absent → `rotation=None`.

**Frontend (vitest)**

- `useDevotionalRotationStore.test.ts` — starts `{ seed: null, cursor: 0 }`;
  `ensureSeed()` sets a number and is idempotent; `advance()` increments;
  `reset()` clears; persistence round-trips; a corrupt persisted blob
  sanitises to defaults.
- `ChatPane.test.tsx` — add: a `source: 'system'` devotional session
  auto-fires with `mode_params` containing `rotationSeed: <number>` and
  `rotationCursor: 0`; after the final event the store `cursor` is `1`; a
  second such session fires with `rotationCursor: 1`; a `source: 'user'`
  session sends **no** `rotation*` keys.
