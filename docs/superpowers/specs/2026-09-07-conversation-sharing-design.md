# Conversation Sharing Design Spec

**Date:** 2026-09-07
**Status:** Implemented

**Post-implementation change:** the import token moved from a query param
(`/?import=<token>`) to the URL **fragment** (`/#import=<token>`) so it is
never sent in a `Referer` header or written to server access logs.
`_request_origin` builds the URL, `importShare.ts` reads
`window.location.hash`, and `App.tsx` strips the fragment after consuming
it. All `?import=` references below should read `#import=`.

## Purpose

Let a user hand a whole conversation — its messages, its artifact links, and
its notes — to another person by sending a link. The recipient opens the
link and the conversation lands in their local history under a new
**Imported** section, as a normal, fully usable session.

There are no user accounts in this app; identity is a random per-browser
`clientId` in `localStorage`. A "share link" is therefore an **unguessable
capability URL**: whoever holds it can import the conversation once. The
shared copy is a **frozen snapshot** taken at share time — later messages or
notes the owner adds are not reflected. After import it is the recipient's
own local session: they can keep chatting in it, add their own notes, or
delete it.

## Scope

**In scope:**

- A new writable SQLite database (`shares.db`) and a `share_store.py` helper
  module, structured like the existing `feedback_store.py`.
- Two Flask endpoints in `myproject.py`:
  - `POST /api/share` — public ingest; stores one session snapshot, returns
    a token + URL. Per-IP rate limited.
  - `GET /api/share/<token>` — public read; returns the snapshot, or `404`.
- A **Share** control in the `ChatPane` header (beside "Report an issue")
  that POSTs the active session and shows a copyable link in a small dialog.
- `frontend/src/lib/shareApi.ts` — `createShare(session)` and
  `fetchShare(token)`.
- An **import-on-load** path in `App.tsx`: `?import=<token>` in the URL is
  fetched, imported into the sessions store, selected, and stripped from the
  URL. Idempotent against re-render and link re-paste.
- `useSessionsStore` changes: an optional `imported` marker on `Session`, an
  `importSession(payload)` action, a message sanitizer for untrusted
  imported content, and a `persist` version bump (3 → 4).
- `SessionsPane` changes: an **Imported** section, rendered first, grouping
  every session that carries the `imported` marker regardless of its
  `mode`; the existing mode sections are built from the remaining sessions.
- Deployment wiring: a `shares-db` Docker volume, a `SHARE_DB_URL` env var,
  `.gitignore` / `docker-compose.yml` / `.env.example` / `DEPLOYMENT.md`
  updates. No nginx change.
- Docs: `CLAUDE.md` updated for the new DB, routes, and the `imported`
  session concept.

**Out of scope:**

- User accounts, targeted "share with person X", or any auth on the share
  routes. The capability URL is the whole access model.
- Link expiry, revocation, or a "my shared links" management surface (the
  chosen lifecycle is: never expires, not revocable). No admin routes for
  shares in this pass — an operator can clear rows directly in `shares.db`
  if ever needed.
- Live / re-syncing shares. The snapshot is immutable once written.
- A read-only conversation mode. Imported sessions use the normal
  `ChatPane`; continuing the chat is allowed and expected.
- Pre-resolving artifact data into the payload. Artifact arrays travel as
  links (`type` + `params`) and re-resolve against the same backend on the
  recipient's side, exactly as they do for the owner. `devotional`
  artifacts already carry their text inline and keep doing so.
- Sharing anything below `/explorer`, `/strongs`, `/gematria`, `/english`
  (the legacy server-rendered pages) — those already have their own
  shareable URLs.
- Sharing to/from the embeddable `BibleChatWidget`. The Share control is
  added to the React shell only.
- `trace` blobs. They are stripped from the snapshot on the way out (as
  they already are from `localStorage` persistence).

## Architecture Overview

| Component | Location | Responsibility |
|---|---|---|
| Share store + APIs | `share_store.py`, `myproject.py` (Flask) | `shares.db`; ingest one snapshot, read one snapshot by token |
| Share dialog + API client | `frontend/src/components/shell/ShareDialog.tsx`, `frontend/src/lib/shareApi.ts` | Build the snapshot, POST it, present the link |
| Import-on-load | `frontend/src/App.tsx` (+ a small `lib/importShare.ts` helper) | Detect `?import=`, fetch, import, select, clean the URL |
| Sessions store change | `frontend/src/store/useSessionsStore.ts` | `imported` marker, `importSession`, message sanitizer, v4 migration |
| Sidebar change | `frontend/src/components/shell/SessionsPane.tsx` | Render the **Imported** section; exclude those from mode sections |

**Guiding principle:** the snapshot is the only thing that reaches the
server, and it is immutable. The server never learns who the recipient is,
and holds no per-user session state — it stores a blob and hands it back by
token. Everything about "which conversations do I have" stays in the
browser.

### Request flow

```
Owner (ChatPane → Share)
  → nginx  POST /api/share  → flask-api  → INSERT into shares.db
  ← { token, url }                        (url = "<origin>/?import=<token>")

Recipient (opens the link)
  → SPA boot: App.tsx sees ?import=<token>
  → nginx  GET /api/share/<token>  → flask-api  → SELECT from shares.db
  ← { title, mode, modeParams, messages, notes, shared_at }
  → useSessionsStore.importSession(payload)  → new local session (imported)
  → history.replaceState  removes ?import=  ;  session selected
```

## Data Model

### `shares.db` — table `shares`

New SQLite file at the repo root (`shares.db`), opened read-write via the
`dataset` library (already a dependency). Gitignored. Docker
volume-mounted (see Deployment). Single denormalized table; the whole
snapshot lives in `payload_json`.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Primary key — the share token, `secrets.token_urlsafe(16)` (~22 url-safe chars) |
| `created_at` | TEXT (ISO 8601 UTC) | Server-set |
| `client_id` | TEXT NULL | Sharer's `clientId` from the browser. Abuse triage only; never returned by the read route |
| `title` | TEXT | Denormalized from the snapshot |
| `mode` | TEXT | Denormalized from the snapshot |
| `message_count` | INTEGER | Denormalized |
| `payload_json` | TEXT | The snapshot: `{ mode, modeParams, title, messages[], notes[] }` |

`share_store.py` mirrors `feedback_store.py`: `get_db(url=None)`,
`init_db(db)` (explicit `create_table` + `create_column` so queries work
before the first insert; index `created_at`), `insert_share(...) -> token`,
`get_share(db, token) -> dict | None` (hydrates `payload_json`).

### Snapshot payload (wire contract, both directions)

Built by `shareApi.createShare`, stored verbatim in `payload_json`, returned
by `GET /api/share/<token>` (plus a server-added `shared_at`). Shape follows
the precedent in `feedbackApi.submitReport`:

```
SharePayload {
  mode: SessionMode
  modeParams: ModeParams
  title: string
  messages: SessionMessage[]     // trace stripped; see below
  notes: Note[]
}
```

- **`messages`** — the session's messages with each `trace` field removed
  (reuse the store's existing `stripPersistHeavyFields` logic, or an inline
  equivalent in `shareApi`). `artifacts`, `data`, `choices`,
  `resolvedChoiceLabel`, etc. are kept as-is — they are small and render the
  conversation faithfully. Artifact `params` are re-resolved on click by the
  recipient's `useArtifactStore`, unchanged.
- **`notes`** — copied as-is. `MAX_NOTES_PER_SESSION` (5) is not re-checked
  on the way out; a snapshot carries whatever the session had.
- **No `id`, `createdAt`, `updatedAt`** — the recipient's store assigns
  fresh ones on import.
- **`shared_at`** (read response only) — `shares.created_at`, shown on the
  import banner ("Imported a conversation shared on …"). Not required for
  function.

### `Session.imported` marker (recipient-side only)

`frontend/src/types/session.ts` — `Session` gains:

```
imported?: {
  token: string          // the share token it came from
  importedAt: number      // epoch ms
  sharedAt?: string       // server `shared_at`, if provided
}
```

Optional, so `isValidSession` is unchanged and every existing persisted
session stays valid. `sanitizeSessions` is extended to carry the field
through rehydration when present and well-formed (drop it otherwise).

## Backend: Share Store & APIs (Flask, `myproject.py`)

New module `share_store.py` plus routes and module-level plumbing in
`myproject.py`, alongside the feedback block.

### Module plumbing (`myproject.py`)

```
_SHARE_DB_URL   = os.environ.get("SHARE_DB_URL", "sqlite:///shares.db")
_MAX_SHARE_BYTES = 1 * 1024 * 1024          # hard cap on the POST body
_share_db = None
_share_buckets = {}                          # ip -> [tokens, last_refill]
```

- `_get_share_db()` — lazy open + `share_store.init_db`, mirroring
  `_get_feedback_db()`.
- Reuse the token-bucket pattern from `_rate_ok` with its own
  `_share_buckets` dict (either a second small function `_share_rate_ok` or
  generalize `_rate_ok` to take a bucket dict). Suggested budget: 10 shares
  / 5 min per IP.

### `POST /api/share` — public, no auth

- Read the raw body first; `413 {"error":"too_large"}` if it exceeds
  `_MAX_SHARE_BYTES`, before JSON parse.
- Per-IP rate check → `429 {"error":"rate_limited"}` when exceeded.
- Parse JSON. Expect `{ client_id?: str, session: { mode, modeParams,
  title, messages, notes } }`.
- Validate: `session` is an object; `mode` is a non-empty string;
  `messages` is a list; `notes` is a list (default `[]` if absent);
  `title` is a string (fall back to `mode` if missing/blank).
  Anything else → `400 {"error":"bad_request"}`.
- Build `payload_json` from **server-side-derived** fields only (do not
  trust separate top-level `title`/`mode`): strip `trace` from every
  message, cap `messages` at a sane ceiling (e.g. 500) and each `notes`
  body at 20 KB defensively.
- Derive `title`, `mode`, `message_count` for the denormalized columns from
  the parsed session.
- `insert_share(...)`; return `201 { "token": "<token>", "url":
  "<request-origin>/?import=<token>" }`. Build the origin from
  `X-Forwarded-Proto` + `Host` (nginx sets both), falling back to
  `request.host_url`.
- `shares.db` unwritable → `500 {"error":"server_error"}`, logged; the
  dialog reports failure.

### `GET /api/share/<token>` — public, no auth

- `get_share(db, token)`; `404 {"error":"not_found"}` if absent.
- Return `200 { title, mode, modeParams, messages, notes, shared_at }`
  from `payload_json` + `created_at`. **Never** return `client_id`.
- `token` is treated as opaque; no format validation beyond a length guard
  (reject absurd lengths early).

### nginx

No change. Both routes are under `/api/`, already proxied to `flask-api`.
`client_max_body_size` is 12m; our own 1 MB cap is stricter.

## Frontend: Sharing

### `lib/shareApi.ts`

```
createShare(session: Session): Promise<{ token: string; url: string }>
fetchShare(token: string): Promise<SharePayload & { shared_at?: string }>
```

- `createShare` builds `{ client_id: getClientId(), session: { mode,
  modeParams, title, messages: <trace-stripped>, notes } }` and
  `POST`s `/api/share` through the existing `parseJsonResponse` guard.
- `fetchShare` `GET`s `/api/share/<token>` and shape-checks the response
  (object, `messages` array) before returning.

### `ShareDialog.tsx`

New `frontend/src/components/shell/ShareDialog.tsx`, same Radix `Dialog`
shell as `ReportIssueDialog`:

- Opened from a **Share** button in the `ChatPane` header (a `Share2` lucide
  icon + label, styled like the neighbouring "Report an issue" pill).
- On open, immediately calls `createShare(session)`; status machine
  `creating → ready | error`.
- `ready`: shows the URL in a read-only `<input>` with a **Copy** button
  (`navigator.clipboard.writeText`, "Copied" confirmation — the pattern
  already used in `ChatPane` and `DevotionalArtifact`), plus one line of
  explanatory copy ("Anyone with this link can import a copy of this
  conversation, including its notes.").
- `error`: inline message + a **Try again** button. No text is lost because
  there is no user input to lose.
- Re-opening the dialog on the same session reuses the already-created link
  (cache the `{token,url}` in component state keyed by `session.id`) rather
  than minting a new row each time.

### Trigger placement

`ChatPane` header only. The button is present for every session, including
imported ones (re-sharing an imported conversation is fine — it just
snapshots the current local copy).

## Frontend: Importing

### `lib/importShare.ts`

A small helper the shell calls once on boot:

```
consumeImportParam(): Promise<
  | { status: 'none' }
  | { status: 'imported'; sessionId: string }
  | { status: 'duplicate'; sessionId: string }
  | { status: 'error'; reason: 'not_found' | 'network' | 'bad_data' }
>
```

- Reads `?import=<token>` from `window.location.search`. `none` if absent.
- Guards against double-consumption: a module-level `Set` of tokens handled
  this page-load, **and** a persisted `localStorage` set
  (`bible-explorer-imported-tokens`) of tokens ever imported on this
  browser. If the token is in the persisted set, find the existing session
  with that `imported.token` and return `duplicate` with its id (the shell
  just selects it) — re-pasting a link never creates a second copy.
- Otherwise `fetchShare(token)` → `useSessionsStore.getState()
  .importSession({ ...payload, token })` → add the token to both sets →
  return `imported` with the new session id.
- All failure paths map to an `error` reason.

### `App.tsx` wiring

- On mount (once), call `consumeImportParam()`.
  - `imported` / `duplicate` → `setSessionId(result.sessionId)` and
    `history.replaceState` to drop the `import` param (keep any existing
    `session` param handling coherent — the import result wins).
  - `error` → render a dismissible banner in the shell header area
    ("That shared link is no longer available." / "Couldn't load the
    shared conversation."). The rest of the app loads normally.
  - `none` → nothing.
- A `useRef` latch ensures the effect body runs its fetch at most once even
  under React StrictMode's double-invoke.
- While a fetch is in flight, a lightweight "Importing shared
  conversation…" banner shows; there is no full-screen block.

### `useSessionsStore` changes

- **`importSession(payload: SharePayload & { token: string; sharedAt?: string
  }): Session`**
  - `id = genId()`, `createdAt = updatedAt = now`.
  - `mode`, `modeParams`, `title` copied from the payload (title falls back
    to `deriveTitle(mode, modeParams)` if blank).
  - `messages`: run through a new `sanitizeMessages(value): SessionMessage[]`
    — drop entries that aren't objects or lack `id` / `role` / string
    `text`; strip `trace`; keep `artifacts`/`data`/`choices` only when they
    are the right shape (defensive, since the payload came from another
    browser via the network). Regenerate `id`s to guarantee local
    uniqueness.
  - `notes`: existing `sanitizeNotes`, then regenerate `id`s via
    `genNoteId()`. Not capped at `MAX_NOTES_PER_SESSION` on import.
  - `imported = { token, importedAt: now, sharedAt }`.
  - Insert into `sessions`; **do not** change `activeSessionId` (the shell
    drives selection).
- **`sanitizeSessions`** — preserve `imported` when it is
  `{ token: string, importedAt: number, sharedAt?: string }`; strip it
  otherwise.
- **`persist` version 3 → 4** — `migrate` stays a pass-through
  (`sanitizePersistedState`); existing sessions simply have no `imported`
  field. `merge` already re-sanitizes on every hydration.

## Frontend: Sidebar (`SessionsPane.tsx`)

- After `filterSessions`, partition into `imported` (has a well-formed
  `.imported`) and `rest`.
- Render an **Imported** section **first**, above the `MODE_ORDER` loop:
  - Header styled like the mode headers; icon `Inbox` (lucide); count
    badge; same collapse/expand behaviour and the same "force open while
    searching" rule.
  - Rows use the existing row markup and `describeSession(session)`, with a
    small secondary line showing the original mode
    (`MODE_LABELS[session.mode]`) so the user can tell an imported Parable
    Study from an imported Devotional. Sorted by `imported.importedAt`
    descending.
  - Notes render under their row exactly as they do elsewhere.
  - Delete works unchanged (`deleteSession`).
- The existing `MODE_ORDER.filter(...)` loop iterates `groupByMode(rest)`
  instead of `groupByMode(filtered)` — imported sessions never also appear
  under their mode.
- `ChatPane` header: for a session with `.imported`, show an **Imported**
  pill in place of the mode pill (or alongside it) so the open conversation
  is identifiable.

## Error Handling

- **Share POST rejected** (`400` / `413` / `429` / `500`): `ShareDialog`
  shows an inline error with a retry; nothing is persisted.
- **Snapshot too large** (`413`, > 1 MB): dialog says the conversation is
  too large to share (rare — needs a very long session).
- **`shares.db` unwritable**: `POST /api/share` → `500`, logged; dialog
  reports failure.
- **Unknown / mistyped token** on open: `GET` → `404`; shell shows "That
  shared link is no longer available." and loads normally.
- **Network failure** fetching a share: shell shows "Couldn't load the
  shared conversation." with the token left in the URL so a reload retries.
- **Malformed snapshot** (shouldn't happen — server validates on write, but
  the client re-checks): treated as `bad_data`; same banner; nothing added
  to the store.
- **Re-pasted link** (token already imported on this browser): no new
  session; the existing imported copy is selected.
- **Recipient `localStorage` near quota**: `importSession` adds to the
  in-memory store immediately; the existing `setItemWithQuotaGuard`
  eviction path handles an over-quota persist by dropping oldest sessions,
  unchanged.
- **Artifact no longer resolvable** on the recipient's side (backend data
  changed since the share): the artifact pane already surfaces a per-link
  `error` status; the conversation text is unaffected.

## Deployment

- **`shares.db` persistence.** Add a `shares-db` named volume in
  `docker-compose.yml`, mounted into `flask-api` at `/app/shares-db`, with
  `SHARE_DB_URL: sqlite:////app/shares-db/shares.db` in that service's
  environment — mirroring the existing `feedback-db` volume exactly.
- **`.gitignore`.** Add `shares.db`, `shares.db-shm`, `shares.db-wal`
  beside the `feedback.db` block.
- **`.env.example`.** Document `SHARE_DB_URL` (optional; defaults to
  `sqlite:///shares.db` for non-Docker runs) next to `FEEDBACK_DB_URL`.
- **`DEPLOYMENT.md`.** Note the new volume and env var in the same place
  the feedback DB is described.
- **nginx:** no change.
- **`CLAUDE.md`:** add `shares.db` to the database list, `/api/share` and
  `/api/share/<token>` to the routes list, and a line about the `imported`
  session marker / Imported sidebar section.

## Testing

**Backend — `share_store.py`:**

- `insert_share` returns a token; `get_share` round-trips the payload
  (dict in, dict out, `payload_json` hydrated).
- `get_share` on an unknown token returns `None`.
- `init_db` is idempotent and leaves queries working before the first
  insert.

**Backend — Flask routes:**

- `POST /api/share` happy path → `201` with `token` + `url`; a row exists;
  `url` ends with `/?import=<token>`; `client_id` is stored but **absent**
  from the `GET` response.
- Oversize body → `413` before parse.
- Missing `session`, non-list `messages`, empty `mode` → `400`.
- `trace` on an input message is not present in the stored `payload_json`.
- `message_count` / `mode` / `title` columns are derived server-side, not
  copied from spoofed top-level fields.
- Rate limit: the (N+1)th share from one IP within the window → `429`.
- `GET /api/share/<token>` happy path returns the documented shape incl.
  `shared_at`; unknown token → `404`.

**Frontend — store:**

- `importSession` creates a session with a fresh `id`, `imported.token`
  set, `trace` stripped from messages, regenerated message/note ids, and
  does **not** move `activeSessionId`.
- `sanitizeMessages` drops a garbage entry and keeps a valid one.
- A v3 persisted blob loads under v4 unchanged; a session with `imported`
  round-trips through persist/hydrate; a malformed `imported` is stripped.

**Frontend — import flow (`App` / `importShare`):**

- `?import=<token>` → `fetchShare` called once, session imported and
  selected, `import` param removed from the URL.
- StrictMode double-invoke still fetches once (latch).
- Re-invoking with a token already in the persisted set selects the
  existing session and does **not** create a duplicate.
- `404` from `fetchShare` → error banner, app still renders, no session
  added.

**Frontend — `ShareDialog`:**

- Opening triggers `createShare`; `ready` renders the URL and Copy writes
  it to the clipboard (mocked `navigator.clipboard`).
- Re-opening on the same session does not POST again.
- `error` state renders a retry and a second attempt POSTs again.

**Frontend — `SessionsPane`:**

- A session with `.imported` renders under **Imported** and **not** under
  its mode section; its original mode shows as the row's secondary line.
- Search matches an imported session and forces the Imported section open.

## Rejected Approaches

- **URL-encoded payload, no backend** (serialize + compress the session
  into the link's fragment). Rejected: a real conversation with artifacts
  and notes produces a multi-KB blob; the URL becomes fragile to
  copy/paste and can exceed practical length limits, with no server-side
  size or abuse valve. Would also add a compression dependency the project
  doesn't carry.
- **Full pre-resolved artifact snapshot** (embed every artifact's resolved
  data in the payload so it survives backend/DB changes). Rejected for this
  pass: larger payloads, more serialization/migration surface, and the
  owner's own session already depends on the backend to render its
  artifacts — the recipient is no worse off. Revisit only if artifact
  endpoints start changing shape often.
- **Live / re-syncing shares** (re-opening the link shows the owner's
  latest turns). Rejected: needs a mutable, owner-linked server record and
  a re-publish path from the owner's browser; "hand someone a copy of this
  conversation" is satisfied by an immutable snapshot.
- **Read-only imported conversations.** Rejected: requires a
  non-interactive `ChatPane` mode that doesn't exist; a fully usable local
  copy is simpler and more useful. The **Imported** label already tells the
  user where it came from.
- **A new `imported` `SessionMode`.** Rejected: `mode` drives primer
  routing and per-mode bubble rendering across `ChatPane`; overwriting it
  would break how imported devotionals/verses/etc. display. A separate
  optional `imported` marker keeps `mode` meaningful.
- **Admin routes for shares** (list/delete, like feedback). Deferred: the
  chosen lifecycle is "never expires, not revocable"; direct `shares.db`
  access covers rare operator cleanup without new auth-guarded surface.
