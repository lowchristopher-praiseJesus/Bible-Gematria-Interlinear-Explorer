# Conversation Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user share a whole conversation (messages + artifact links + notes) with another person via an unguessable link; the recipient opens the link and the conversation appears in their local history under a new **Imported** section as a normal, usable session.

**Architecture:** The sharer's browser POSTs a reduced session snapshot to Flask, which stores it as one immutable row in a new writable `shares.db` (SQLite via the `dataset` library) keyed by a random URL-safe token; the response carries a link of the form `<origin>/?import=<token>`. The recipient's SPA detects `?import=<token>` on load, `GET`s the snapshot, and writes it into the Zustand sessions store as a fresh session carrying an `imported` marker. Nothing about "which conversations do I have" ever leaves the browser except the snapshot itself, which is write-once.

**Tech Stack:** Python 3.13 / Flask / `dataset` / SQLite (backend); React 19 / TypeScript / Zustand (`persist` middleware) / Radix Dialog / lucide-react / Vite / Vitest (frontend); pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-09-07-conversation-sharing-design.md`

## Global Constraints

- **No new dependencies.** Use only what is already in `requirements.txt` / `frontend/package.json` (`dataset`, `@radix-ui/react-dialog`, `lucide-react`, `zustand`).
- **No auth on the share routes.** The capability URL is the whole access model. No `require_admin`, no admin routes for shares.
- **Snapshot is immutable.** No update path, no expiry, no revocation. `POST /api/share` inserts; `GET /api/share/<token>` reads; nothing else.
- **`trace` is stripped** from every message before it is stored in a snapshot and again on import.
- **Share token:** `secrets.token_urlsafe(16)` (~22 url-safe chars). Treated as opaque; only a length guard on read.
- **Body cap:** `POST /api/share` rejects a raw body over `1 * 1024 * 1024` bytes with `413` before parsing. Also reject `> 500` messages with `400`.
- **Per-IP rate limit:** token bucket, `capacity=10`, `refill_seconds=30.0`, its own `_share_buckets` dict. `429 {"error":"rate_limited"}` when exhausted.
- **SPA has no router.** The import entry point is the `?import=<token>` query param, mirroring the existing `?session=` param.
- **`persist` store version bumps 3 → 4.** Existing sessions simply lack the new optional `imported` field.
- **Imported sessions keep their real `mode`.** `imported` is a *separate* optional marker on `Session`; never a new `SessionMode`.
- **localStorage keys:** sessions store `bible-explorer-sessions` (unchanged); imported-token dedupe set `bible-explorer-imported-tokens` (new).
- **Import URL form:** exactly `<origin>/?import=<token>`, origin built from `X-Forwarded-Proto` + `Host` (nginx sets both) with `request.host_url` as fallback.
- **Commit messages** follow the repo style (`feat(...)`, `test(...)`, `docs:`, `chore:`) and every commit message ends with the two trailer lines from the session guidance:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa
  ```
- **Backend tests** run from the repo root: `pytest tests/<file> -v`.
- **Frontend tests** run from `frontend/`: `npx vitest run <name-substring>`.

---

### Task 1: `share_store.py` — the write-once snapshot store

**Files:**
- Create: `share_store.py` (repo root)
- Test: `tests/test_share_store.py`

**Interfaces:**
- Consumes: nothing (leaf module). Mirrors the shape of the existing `feedback_store.py`.
- Produces:
  - `get_db(url: str | None = None) -> dataset.Database`
  - `init_db(db: dataset.Database) -> None`
  - `new_token() -> str`
  - `insert_share(db, *, client_id: str | None, title: str, mode: str, message_count: int, payload: dict) -> str` (returns the token)
  - `get_share(db, token: str) -> dict | None` — row dict with an added `payload` key (the parsed `payload_json`), or `None`. Never has `client_id` stripped here — the *route* is responsible for not exposing it.

- [ ] **Step 1: Write the failing test**

Create `tests/test_share_store.py`:

```python
# tests/test_share_store.py
import pytest

import share_store as ss

SNAPSHOT = {
    "mode": "freeform",
    "modeParams": {},
    "title": "Ask Anything",
    "messages": [{"id": "m1", "role": "user", "text": "hi"}],
    "notes": [{"id": "n1", "body": "a note", "createdAt": 1, "updatedAt": 1}],
}


@pytest.fixture
def db(tmp_path):
    database = ss.get_db(f"sqlite:///{tmp_path / 'shares.db'}")
    ss.init_db(database)
    return database


def test_insert_returns_token_and_get_roundtrips_payload(db):
    token = ss.insert_share(
        db, client_id="c-1", title="Ask Anything", mode="freeform",
        message_count=1, payload=SNAPSHOT,
    )
    assert isinstance(token, str) and len(token) >= 16
    row = ss.get_share(db, token)
    assert row["id"] == token
    assert row["created_at"].endswith("Z")
    assert row["mode"] == "freeform"
    assert row["message_count"] == 1
    assert row["payload"]["notes"][0]["body"] == "a note"
    assert row["payload"]["messages"][0]["text"] == "hi"


def test_get_share_unknown_token_returns_none(db):
    assert ss.get_share(db, "no-such-token") is None


def test_init_db_is_idempotent_and_queryable_before_first_insert(db):
    ss.init_db(db)  # a second call must not raise
    assert ss.get_share(db, "anything") is None


def test_tokens_are_unique_across_many_inserts(db):
    tokens = {
        ss.insert_share(db, client_id=None, title="t", mode="freeform",
                        message_count=0, payload=SNAPSHOT)
        for _ in range(25)
    }
    assert len(tokens) == 25
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_share_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'share_store'`.

- [ ] **Step 3: Write the implementation**

Create `share_store.py`:

```python
"""SQLite-backed store for shared conversation snapshots.

Separate database from the read-only Complete.db and from feedback.db:
this one is written when a user shares a conversation and read when
someone opens a share link. Opened via the `dataset` library (already
used across myproject.py).

A share row is immutable once written: there is no update path, no
expiry, and no ownership beyond an advisory `client_id` kept only for
abuse triage. See
docs/superpowers/specs/2026-09-07-conversation-sharing-design.md.
"""

from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone

import dataset

DEFAULT_DB_URL = os.environ.get("SHARE_DB_URL", "sqlite:///shares.db")

# 16 random bytes -> url-safe base64 -> ~22 chars.
_TOKEN_NBYTES = 16


def get_db(url: str | None = None) -> "dataset.Database":
    return dataset.connect(url or DEFAULT_DB_URL)


def init_db(db: "dataset.Database") -> None:
    table = db.create_table("shares", primary_id="id", primary_type=db.types.string(64))
    # Materialize columns so reads work before the first insert.
    for col in ("created_at", "client_id", "title", "mode", "payload_json"):
        table.create_column(col, db.types.text)
    table.create_column("message_count", db.types.integer)
    table.create_index(["created_at"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_token() -> str:
    return secrets.token_urlsafe(_TOKEN_NBYTES)


def insert_share(
    db: "dataset.Database",
    *,
    client_id: str | None,
    title: str,
    mode: str,
    message_count: int,
    payload: dict,
) -> str:
    token = new_token()
    db["shares"].insert(
        {
            "id": token,
            "created_at": _now_iso(),
            "client_id": client_id or None,
            "title": title,
            "mode": mode,
            "message_count": int(message_count),
            "payload_json": json.dumps(payload),
        }
    )
    return token


def get_share(db: "dataset.Database", token: str) -> dict | None:
    row = db["shares"].find_one(id=token)
    if row is None:
        return None
    row = dict(row)
    raw = row.get("payload_json")
    try:
        row["payload"] = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        row["payload"] = None
    return row
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_share_store.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add share_store.py tests/test_share_store.py
git commit -m "feat(share): write-once SQLite store for conversation snapshots

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

### Task 2: Flask routes — `POST /api/share` and `GET /api/share/<token>`

**Files:**
- Modify: `myproject.py` — add `import share_store` beside `import feedback_store` (line 14); add a module-level share block after the feedback block (near line 2026); add the two routes after the feedback routes.
- Modify: `.gitignore` — add the `shares.db*` block beside the `feedback.db*` block.
- Test: `tests/test_share_api.py`

**Interfaces:**
- Consumes: `share_store.get_db`, `share_store.init_db`, `share_store.insert_share`, `share_store.get_share` (Task 1).
- Produces (HTTP contract other tasks depend on):
  - `POST /api/share` body `{ client_id?: string, session: { mode, modeParams, title, messages, notes } }` → `201 { token: string, url: string }` where `url` ends with `/?import=<token>`. Errors: `413 {"error":"too_large"}`, `429 {"error":"rate_limited"}`, `400 {"error":"bad_json"|"bad_session"|"too_many_messages"}`, `500 {"error":"store_unavailable"}`.
  - `GET /api/share/<token>` → `200 { title, mode, modeParams, messages, notes, shared_at }` (no `client_id`) or `404 {"error":"not_found"}`.
  - New module globals on `myproject`: `_SHARE_DB_URL`, `_share_db`, `_share_buckets` (dict).

- [ ] **Step 1: Write the failing test**

Create `tests/test_share_api.py`:

```python
# tests/test_share_api.py
import pytest

import myproject
import share_store as ss


@pytest.fixture
def app_client(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'shares.db'}"
    monkeypatch.setenv("SHARE_DB_URL", url)
    monkeypatch.setattr(myproject, "_SHARE_DB_URL", url, raising=False)
    monkeypatch.setattr(myproject, "_share_db", None, raising=False)
    myproject._share_buckets.clear()
    myproject.app.config.update(TESTING=True)
    return myproject.app.test_client()


def _session(**overrides):
    s = dict(
        mode="freeform",
        modeParams={},
        title="Ask Anything",
        messages=[
            {"id": "m1", "role": "user", "text": "hi"},
            {"id": "m2", "role": "assistant", "text": "hello", "trace": {"turnId": "t"}},
        ],
        notes=[{"id": "n1", "body": "my note", "createdAt": 1, "updatedAt": 1}],
    )
    s.update(overrides)
    return s


def _body(**overrides):
    b = dict(client_id="c-1", session=_session())
    b.update(overrides)
    return b


def test_create_returns_token_and_import_url(app_client):
    resp = app_client.post("/api/share", json=_body())
    assert resp.status_code == 201
    data = resp.get_json()
    assert data["token"]
    assert data["url"].endswith(f"/?import={data['token']}")


def test_stored_row_strips_trace_and_derives_counts(app_client, tmp_path):
    token = app_client.post("/api/share", json=_body()).get_json()["token"]
    db = ss.get_db(f"sqlite:///{tmp_path / 'shares.db'}")
    row = ss.get_share(db, token)
    assert row["message_count"] == 2
    assert row["mode"] == "freeform"
    assert "trace" not in row["payload"]["messages"][1]
    assert row["payload"]["notes"][0]["body"] == "my note"


def test_get_returns_snapshot_without_client_id(app_client):
    token = app_client.post("/api/share", json=_body()).get_json()["token"]
    resp = app_client.get(f"/api/share/{token}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["title"] == "Ask Anything"
    assert data["mode"] == "freeform"
    assert data["modeParams"] == {}
    assert data["notes"][0]["body"] == "my note"
    assert data["messages"][1].get("trace") is None
    assert "client_id" not in data
    assert data["shared_at"].endswith("Z")


def test_get_unknown_token_is_404(app_client):
    assert app_client.get("/api/share/nope").status_code == 404


def test_rejects_missing_session(app_client):
    resp = app_client.post("/api/share", json={"client_id": "c-1"})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_session"


def test_rejects_non_list_messages(app_client):
    resp = app_client.post("/api/share", json=_body(session=_session(messages="nope")))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_session"


def test_rejects_blank_mode(app_client):
    resp = app_client.post("/api/share", json=_body(session=_session(mode="")))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_session"


def test_rejects_oversize_body(app_client):
    resp = app_client.post(
        "/api/share",
        data=b"x" * (1 * 1024 * 1024 + 1),
        content_type="application/json",
    )
    assert resp.status_code == 413


def test_rate_limited_after_bucket_exhausted(app_client):
    myproject._share_buckets.clear()
    codes = [app_client.post("/api/share", json=_body()).status_code for _ in range(12)]
    assert codes[:10] == [201] * 10
    assert codes[10] == 429
    assert app_client.post("/api/share", json=_body()).get_json()["error"] == "rate_limited"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_share_api.py -v`
Expected: FAIL — `AttributeError: module 'myproject' has no attribute '_share_buckets'` (collection/fixture error), and 404s on the routes.

- [ ] **Step 3: Add the import**

In `myproject.py`, directly below `import feedback_store` (line 14):

```python
import share_store
```

- [ ] **Step 4: Add the module-level share block**

In `myproject.py`, immediately after the feedback module block (after `_rate_ok`, around line 2045, before the `@app.route('/api/bible-chat' ...)` proxy):

```python
# ---------------------------------------------------------------------------
# Conversation sharing: write-once snapshots (writable shares.db)
# ---------------------------------------------------------------------------
_SHARE_DB_URL = os.environ.get("SHARE_DB_URL", "sqlite:///shares.db")
_MAX_SHARE_BYTES = 1 * 1024 * 1024
_MAX_SHARE_MESSAGES = 500
_share_db = None
_share_buckets = {}            # ip -> [tokens: float, last_refill: float]


def _get_share_db():
	global _share_db
	if _share_db is None:
		_share_db = share_store.get_db(_SHARE_DB_URL)
		share_store.init_db(_share_db)
	return _share_db


def _share_rate_ok(ip, *, capacity=10, refill_seconds=30.0):
	now = time.time()
	tokens, last = _share_buckets.get(ip, [float(capacity), now])
	tokens = min(capacity, tokens + (now - last) / refill_seconds)
	if tokens < 1.0:
		_share_buckets[ip] = [tokens, now]
		return False
	_share_buckets[ip] = [tokens - 1.0, now]
	return True


def _request_origin():
	"""Scheme+host the browser used, honoring nginx's forwarded headers."""
	proto = request.headers.get('X-Forwarded-Proto') or request.scheme
	host = request.headers.get('X-Forwarded-Host') or request.headers.get('Host')
	if host:
		return f"{proto}://{host}"
	return request.host_url.rstrip('/')
```

> **Indentation note:** `myproject.py` uses **tabs**. Match it.

- [ ] **Step 5: Add the two routes**

In `myproject.py`, after the last feedback route (after `admin_delete_all_feedback`, near line 2255):

```python
@app.route('/api/share', methods=['POST'])
def create_share():
	raw = request.get_data(cache=False)
	if len(raw) > _MAX_SHARE_BYTES:
		return jsonify({'error': 'too_large'}), 413

	if not _share_rate_ok(request.headers.get('X-Real-IP') or request.remote_addr or 'unknown'):
		return jsonify({'error': 'rate_limited'}), 429

	try:
		payload = _json.loads(raw or b'{}')
	except ValueError:
		return jsonify({'error': 'bad_json'}), 400
	if not isinstance(payload, dict):
		return jsonify({'error': 'bad_json'}), 400

	session = payload.get('session')
	if not isinstance(session, dict):
		return jsonify({'error': 'bad_session'}), 400

	mode = str(session.get('mode') or '').strip()
	messages = session.get('messages')
	notes = session.get('notes', [])
	if not mode or not isinstance(messages, list) or not isinstance(notes, list):
		return jsonify({'error': 'bad_session'}), 400
	if len(messages) > _MAX_SHARE_MESSAGES:
		return jsonify({'error': 'too_many_messages'}), 400

	mode_params = session.get('modeParams')
	if not isinstance(mode_params, dict):
		mode_params = {}

	title = (str(session.get('title') or '').strip() or mode)[:200]

	# Strip the per-turn diagnostic `trace` blob from every message — large
	# and never needed to re-render a shared conversation.
	clean_messages = []
	for m in messages:
		if not isinstance(m, dict):
			continue
		clean_messages.append({k: v for k, v in m.items() if k != 'trace'})

	clean_notes = []
	for n in notes:
		if not isinstance(n, dict):
			continue
		clean_notes.append({**n, 'body': str(n.get('body') or '')[:20000]})

	snapshot = {
		'mode': mode,
		'modeParams': mode_params,
		'title': title,
		'messages': clean_messages,
		'notes': clean_notes,
	}

	try:
		token = share_store.insert_share(
			_get_share_db(),
			client_id=str(payload.get('client_id') or '')[:64] or None,
			title=title,
			mode=mode,
			message_count=len(clean_messages),
			payload=snapshot,
		)
	except Exception as e:                       # noqa: BLE001
		app.logger.exception("share insert failed: %s", e)
		return jsonify({'error': 'store_unavailable'}), 500

	return jsonify({'token': token, 'url': f"{_request_origin()}/?import={token}"}), 201


@app.route('/api/share/<token>', methods=['GET'])
def read_share(token):
	if not token or len(token) > 128:
		return jsonify({'error': 'not_found'}), 404
	row = share_store.get_share(_get_share_db(), token)
	if row is None or row.get('payload') is None:
		return jsonify({'error': 'not_found'}), 404
	p = row['payload']
	return jsonify({
		'title': p.get('title'),
		'mode': p.get('mode'),
		'modeParams': p.get('modeParams') or {},
		'messages': p.get('messages') or [],
		'notes': p.get('notes') or [],
		'shared_at': row.get('created_at'),
	}), 200
```

- [ ] **Step 6: Update `.gitignore`**

Below the existing `feedback.db` block, add:

```
# Writable conversation-sharing DB (created at runtime, never committed)
shares.db
shares.db-shm
shares.db-wal
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pytest tests/test_share_api.py -v`
Expected: PASS (10 tests).

- [ ] **Step 8: Run the whole backend suite (no regressions)**

Run: `pytest -q`
Expected: PASS (all pre-existing tests still green).

- [ ] **Step 9: Commit**

```bash
git add myproject.py .gitignore tests/test_share_api.py
git commit -m "feat(share): POST /api/share and GET /api/share/<token>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

### Task 3: Session types + store `importSession`

**Files:**
- Modify: `frontend/src/types/session.ts` — add `ImportedMeta`, `Session.imported`, `SharePayload`.
- Modify: `frontend/src/store/useSessionsStore.ts` — `importSession` action, `sanitizeMessages`, `imported` marker handling in `sanitizeSessions`, `version: 3 -> 4`.
- Modify: `frontend/src/store/useSessionsStore.test.ts` — add an `importSession` describe block and a rehydration test.

**Interfaces:**
- Consumes: existing `genNoteId`, `sanitizeNotes`, `deriveTitle` in the store.
- Produces:
  - `types/session.ts`: `interface ImportedMeta { token: string; importedAt: number; sharedAt?: string }`; `Session.imported?: ImportedMeta`; `interface SharePayload { mode: SessionMode; modeParams: ModeParams; title: string; messages: SessionMessage[]; notes: Note[] }`.
  - `useSessionsStore` action `importSession(payload: SharePayload & { token: string; sharedAt?: string }) => Session` — creates a fresh session (new `id`, `createdAt`/`updatedAt` = now), sanitized+re-id'd messages and notes, `imported` set. **Does not** change `activeSessionId`.

- [ ] **Step 1: Add the types**

In `frontend/src/types/session.ts`, after the `Note` interface and before `Session`:

```ts
export interface ImportedMeta {
  /** The share token this session was imported from. */
  token: string
  /** When the import happened (epoch ms). */
  importedAt: number
  /** Server `shared_at` timestamp for the original share, if known. */
  sharedAt?: string
}
```

Add `imported` to `Session`:

```ts
export interface Session {
  id: string
  createdAt: number
  updatedAt: number
  mode: SessionMode
  modeParams: ModeParams
  title: string
  messages: SessionMessage[]
  notes: Note[]
  /** Present only on a session brought in via a share link. Its `mode`
   * stays the original mode; this marker is what the sidebar groups on. */
  imported?: ImportedMeta
}
```

At the end of the file:

```ts
/** The payload carried by a share link: a session reduced to what the
 * recipient needs to re-create it locally. Built by `shareApi.createShare`,
 * stored server-side, returned by `shareApi.fetchShare`. */
export interface SharePayload {
  mode: SessionMode
  modeParams: ModeParams
  title: string
  messages: SessionMessage[]
  notes: Note[]
}
```

- [ ] **Step 2: Write the failing store tests**

In `frontend/src/store/useSessionsStore.test.ts`, add inside the top-level `describe('useSessionsStore', ...)` block:

```ts
  describe('importSession', () => {
    const payload = {
      token: 'tok-123',
      sharedAt: '2026-09-07T00:00:00.000Z',
      mode: 'devotional' as const,
      modeParams: { source: 'system' as const, delivered: true },
      title: 'Devotional',
      messages: [
        { id: 'orig-1', role: 'user' as const, text: 'share me' },
        { id: 'orig-2', role: 'assistant' as const, text: 'a devotional', trace: { turnId: 'x' } as never },
        { role: 'user', text: 'no id — dropped' } as never,
      ],
      notes: [{ id: 'orig-n', body: 'shared note', createdAt: 1, updatedAt: 1 }],
    }

    it('creates a fresh session flagged imported without stealing focus', () => {
      const before = useSessionsStore.getState().activeSessionId
      const s = useSessionsStore.getState().importSession(payload)
      expect(s.imported).toEqual({
        token: 'tok-123', importedAt: expect.any(Number), sharedAt: '2026-09-07T00:00:00.000Z',
      })
      expect(s.mode).toBe('devotional')
      expect(s.modeParams).toEqual({ source: 'system', delivered: true })
      expect(useSessionsStore.getState().activeSessionId).toBe(before)
      expect(useSessionsStore.getState().sessions[s.id]).toEqual(s)
    })

    it('sanitizes messages: drops malformed, strips trace, regenerates ids', () => {
      const s = useSessionsStore.getState().importSession(payload)
      expect(s.messages).toHaveLength(2)
      expect(s.messages.map((m) => m.text)).toEqual(['share me', 'a devotional'])
      expect(s.messages[0].id).not.toBe('orig-1')
      expect(s.messages[1]).not.toHaveProperty('trace')
    })

    it('regenerates note ids and keeps note bodies', () => {
      const s = useSessionsStore.getState().importSession(payload)
      expect(s.notes).toHaveLength(1)
      expect(s.notes[0].body).toBe('shared note')
      expect(s.notes[0].id).not.toBe('orig-n')
    })

    it('falls back to a derived title when the payload title is blank', () => {
      const s = useSessionsStore.getState().importSession({ ...payload, title: '   ' })
      expect(s.title).toBe('Devotional')
    })
  })

  it('rehydrates a valid imported marker and drops a malformed one', async () => {
    localStorage.setItem(
      'bible-explorer-sessions',
      JSON.stringify({
        version: 4,
        state: {
          activeSessionId: null,
          sessions: {
            good: {
              id: 'good', mode: 'freeform', modeParams: {}, title: 'x',
              messages: [], notes: [], createdAt: 1, updatedAt: 1,
              imported: { token: 't', importedAt: 5 },
            },
            bad: {
              id: 'bad', mode: 'freeform', modeParams: {}, title: 'y',
              messages: [], notes: [], createdAt: 1, updatedAt: 1,
              imported: { token: 123 },
            },
          },
        },
      })
    )
    await useSessionsStore.persist.rehydrate()
    const state = useSessionsStore.getState()
    expect(state.sessions.good.imported).toEqual({ token: 't', importedAt: 5 })
    expect(state.sessions.bad.imported).toBeUndefined()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run useSessionsStore`
Expected: FAIL — `importSession is not a function`; rehydration test sees `bad.imported` still `{ token: 123 }`.

- [ ] **Step 4: Implement the sanitizers and action**

In `frontend/src/store/useSessionsStore.ts`:

Add to the `SessionsState` interface (next to `addNote`):

```ts
  /** Bring a conversation in from a share link as a new local session,
   * flagged `imported`. Does not change the active session. */
  importSession: (payload: SharePayload & { token: string; sharedAt?: string }) => Session
```

Update the type import at the top:

```ts
import type { ModeParams, Note, Session, SessionMessage, SessionMode, SharePayload } from '@/types/session'
```

Add an id generator next to `genNoteId`:

```ts
let importedMsgCounter = 0
function genImportedMessageId(): string {
  return `imported-msg-${Date.now()}-${++importedMsgCounter}`
}
```

Add message + imported-marker sanitizers next to `sanitizeNotes`:

```ts
function isValidMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    (c.role === 'user' || c.role === 'assistant') &&
    typeof c.text === 'string'
  )
}

/**
 * Messages from a share link were serialized by another browser and
 * crossed the network — treat them as untrusted. Keep only well-formed
 * entries and strip the heavy per-turn `trace` blob.
 */
function sanitizeMessages(messages: unknown): SessionMessage[] {
  if (!Array.isArray(messages)) return []
  const out: SessionMessage[] = []
  for (const value of messages) {
    if (!isValidMessage(value)) continue
    const { trace: _trace, ...rest } = value as SessionMessage & { trace?: unknown }
    out.push(rest as SessionMessage)
  }
  return out
}

function sanitizeImported(value: unknown): Session['imported'] {
  if (!value || typeof value !== 'object') return undefined
  const c = value as Record<string, unknown>
  if (typeof c.token !== 'string' || typeof c.importedAt !== 'number') return undefined
  return {
    token: c.token,
    importedAt: c.importedAt,
    sharedAt: typeof c.sharedAt === 'string' ? c.sharedAt : undefined,
  }
}
```

In `sanitizeSessions`, carry the marker through — change the assignment line:

```ts
    if (isValidSession(value)) {
      const raw = value as Session & { notes?: unknown; imported?: unknown }
      out[id] = {
        ...raw,
        notes: sanitizeNotes(raw.notes),
        imported: sanitizeImported(raw.imported),
      }
    }
```

Add the action inside the store creator (after `addNote`):

```ts
      importSession: (payload) => {
        const now = Date.now()
        const mode = payload.mode
        const modeParams = payload.modeParams ?? {}
        const messages = sanitizeMessages(payload.messages).map((m) => ({
          ...m,
          id: genImportedMessageId(),
        }))
        const notes = sanitizeNotes(payload.notes).map((n) => ({ ...n, id: genNoteId() }))
        const title = (payload.title ?? '').trim() || deriveTitle(mode, modeParams)
        const session: Session = {
          id: genId(),
          createdAt: now,
          updatedAt: now,
          mode,
          modeParams,
          title,
          messages,
          notes,
          imported: { token: payload.token, importedAt: now, sharedAt: payload.sharedAt },
        }
        set((state) => ({ sessions: { ...state.sessions, [session.id]: session } }))
        return session
      },
```

Bump the persisted version:

```ts
      name: 'bible-explorer-sessions',
      version: 4,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run useSessionsStore`
Expected: PASS (all pre-existing store tests + the 5 new ones).

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/store/useSessionsStore.ts frontend/src/store/useSessionsStore.test.ts
git commit -m "feat(sessions): importSession action + imported marker, store v4

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

### Task 4: `lib/shareApi.ts` — create / fetch a share

**Files:**
- Create: `frontend/src/lib/shareApi.ts`
- Test: `frontend/src/lib/shareApi.test.ts`

**Interfaces:**
- Consumes: `getClientId` from `@/lib/clientId`; `parseJsonResponse` from `@/lib/chatApi`; `Session`, `SessionMessage`, `SharePayload` from `@/types/session` (Task 3).
- Produces:
  - `createShare(session: Session): Promise<{ token: string; url: string }>` — POSTs `/api/share` with a trace-stripped session.
  - `interface FetchedShare extends SharePayload { shared_at?: string }`
  - `fetchShare(token: string): Promise<FetchedShare>` — GETs `/api/share/<token>`; throws an `Error` whose message contains the HTTP status on a non-ok response.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/shareApi.test.ts`:

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { createShare, fetchShare } from './shareApi'
import type { Session } from '@/types/session'

const session: Session = {
  id: 's1', createdAt: 1, updatedAt: 2, mode: 'freeform', modeParams: {},
  title: 'Ask Anything',
  messages: [
    { id: 'm1', role: 'user', text: 'hi' },
    { id: 'm2', role: 'assistant', text: 'hello', trace: { turnId: 't' } as never },
  ],
  notes: [{ id: 'n1', body: 'note', createdAt: 1, updatedAt: 1 }],
}

afterEach(() => vi.unstubAllGlobals())

it('createShare POSTs a trace-stripped session and returns the link', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ token: 'tok', url: 'http://x/?import=tok' }),
  })
  vi.stubGlobal('fetch', fetchMock)

  const out = await createShare(session)
  expect(out).toEqual({ token: 'tok', url: 'http://x/?import=tok' })

  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/share')
  const body = JSON.parse(init.body)
  expect(body.client_id).toMatch(/[0-9a-f-]{36}/)
  expect(body.session.title).toBe('Ask Anything')
  expect(body.session.notes[0].body).toBe('note')
  expect(body.session.messages).toHaveLength(2)
  expect(body.session.messages[1]).not.toHaveProperty('trace')
})

it('createShare throws on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413, statusText: 'Payload Too Large' }))
  await expect(createShare(session)).rejects.toThrow(/413/)
})

it('fetchShare GETs the encoded token and returns the snapshot', async () => {
  const snap = {
    title: 'T', mode: 'freeform', modeParams: {}, messages: [], notes: [],
    shared_at: '2026-09-07T00:00:00.000Z',
  }
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snap })
  vi.stubGlobal('fetch', fetchMock)

  const out = await fetchShare('tok abc')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/share/tok%20abc')
  expect(out).toEqual(snap)
})

it('fetchShare throws with the status on 404', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))
  await expect(fetchShare('nope')).rejects.toThrow(/404/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run shareApi`
Expected: FAIL — cannot resolve `./shareApi`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/shareApi.ts`:

```ts
import { getClientId } from '@/lib/clientId'
import { parseJsonResponse } from '@/lib/chatApi'
import type { Session, SessionMessage, SharePayload } from '@/types/session'

/** Drop the per-turn diagnostic `trace` blob — large and never needed to
 * re-render a shared conversation. The backend strips it again on write;
 * doing it here keeps the request small. */
function stripTrace(messages: SessionMessage[]): SessionMessage[] {
  return messages.map((m) => {
    if (m.trace === undefined) return m
    const { trace: _trace, ...rest } = m
    return rest as SessionMessage
  })
}

export async function createShare(session: Session): Promise<{ token: string; url: string }> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: getClientId(),
      session: {
        mode: session.mode,
        modeParams: session.modeParams,
        title: session.title,
        messages: stripTrace(session.messages),
        notes: session.notes,
      },
    }),
  })
  return parseJsonResponse<{ token: string; url: string }>(res)
}

export interface FetchedShare extends SharePayload {
  shared_at?: string
}

export async function fetchShare(token: string): Promise<FetchedShare> {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}`)
  return parseJsonResponse<FetchedShare>(res)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run shareApi`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/shareApi.ts frontend/src/lib/shareApi.test.ts
git commit -m "feat(share): shareApi client — createShare / fetchShare

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

### Task 5: `lib/importShare.ts` — consume `?import=<token>` once

**Files:**
- Create: `frontend/src/lib/importShare.ts`
- Test: `frontend/src/lib/importShare.test.ts`

**Interfaces:**
- Consumes: `fetchShare` from `@/lib/shareApi` (Task 4); `useSessionsStore` (`getState().sessions`, `getState().importSession`) (Task 3).
- Produces:
  - `type ImportResult = { status: 'none' } | { status: 'imported'; sessionId: string } | { status: 'duplicate'; sessionId: string } | { status: 'error'; reason: 'not_found' | 'network' | 'bad_data' }`
  - `consumeImportParam(): Promise<ImportResult>` — reads `?import=` from `window.location.search`; dedupes against sessions already carrying that `imported.token` (→ `duplicate`) and against a persisted `bible-explorer-imported-tokens` set (→ `none` when the copy is gone); otherwise fetches + imports. Does **not** modify the URL (App owns history).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/importShare.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { consumeImportParam } from './importShare'
import { useSessionsStore } from '@/store/useSessionsStore'
import * as shareApi from './shareApi'

function setImportParam(token: string | null) {
  const url = new URL(window.location.href)
  if (token) url.searchParams.set('import', token)
  else url.searchParams.delete('import')
  window.history.replaceState({}, '', url)
}

const snap = {
  title: 'Devotional', mode: 'devotional' as const, modeParams: { source: 'system' as const },
  messages: [{ id: 'x', role: 'user' as const, text: 'hello' }], notes: [],
  shared_at: '2026-09-07T00:00:00.000Z',
}

beforeEach(() => {
  localStorage.clear()
  useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  setImportParam(null)
})
afterEach(() => vi.restoreAllMocks())

it('returns none when there is no import param', async () => {
  expect(await consumeImportParam()).toEqual({ status: 'none' })
})

it('fetches, imports, and reports the new session id', async () => {
  setImportParam('tok-1')
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue(snap)
  const result = await consumeImportParam()
  expect(result.status).toBe('imported')
  const id = (result as { sessionId: string }).sessionId
  const session = useSessionsStore.getState().sessions[id]
  expect(session.imported?.token).toBe('tok-1')
  expect(session.mode).toBe('devotional')
})

it('does not re-import a token whose session still exists — jumps to it', async () => {
  setImportParam('tok-2')
  const fetchSpy = vi.spyOn(shareApi, 'fetchShare').mockResolvedValue(snap)
  const first = await consumeImportParam()
  fetchSpy.mockClear()
  const second = await consumeImportParam()
  expect(second).toEqual({ status: 'duplicate', sessionId: (first as { sessionId: string }).sessionId })
  expect(fetchSpy).not.toHaveBeenCalled()
})

it('returns none when the token was imported before but its session is gone', async () => {
  setImportParam('tok-3')
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue(snap)
  const first = await consumeImportParam()
  useSessionsStore.getState().deleteSession((first as { sessionId: string }).sessionId)
  expect(await consumeImportParam()).toEqual({ status: 'none' })
})

it('maps a 404 to a not_found error', async () => {
  setImportParam('gone')
  vi.spyOn(shareApi, 'fetchShare').mockRejectedValue(new Error('Request failed: 404 Not Found'))
  expect(await consumeImportParam()).toEqual({ status: 'error', reason: 'not_found' })
})

it('maps any other failure to a network error', async () => {
  setImportParam('down')
  vi.spyOn(shareApi, 'fetchShare').mockRejectedValue(new Error('Failed to fetch'))
  expect(await consumeImportParam()).toEqual({ status: 'error', reason: 'network' })
})

it('maps a shapeless payload to a bad_data error', async () => {
  setImportParam('weird')
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue({ nope: true } as never)
  expect(await consumeImportParam()).toEqual({ status: 'error', reason: 'bad_data' })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run importShare`
Expected: FAIL — cannot resolve `./importShare`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/importShare.ts`:

```ts
import { fetchShare } from '@/lib/shareApi'
import { useSessionsStore } from '@/store/useSessionsStore'

const IMPORTED_TOKENS_KEY = 'bible-explorer-imported-tokens'

// Tokens handled in this page load — guards against a StrictMode double
// invoke racing ahead of the store update.
const handledThisLoad = new Set<string>()

export type ImportResult =
  | { status: 'none' }
  | { status: 'imported'; sessionId: string }
  | { status: 'duplicate'; sessionId: string }
  | { status: 'error'; reason: 'not_found' | 'network' | 'bad_data' }

function readImportedTokens(): Set<string> {
  try {
    const raw = localStorage.getItem(IMPORTED_TOKENS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((t) => typeof t === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function rememberImportedToken(token: string): void {
  try {
    const tokens = readImportedTokens()
    tokens.add(token)
    localStorage.setItem(IMPORTED_TOKENS_KEY, JSON.stringify([...tokens]))
  } catch {
    /* private-mode storage — the in-memory guard still covers this load */
  }
}

export async function consumeImportParam(): Promise<ImportResult> {
  const token = new URLSearchParams(window.location.search).get('import')
  if (!token) return { status: 'none' }

  const existing = Object.values(useSessionsStore.getState().sessions).find(
    (s) => s.imported?.token === token
  )
  if (existing) return { status: 'duplicate', sessionId: existing.id }

  // Imported before on this browser, but the session was since deleted —
  // nothing to jump to, and we won't silently re-add it.
  if (handledThisLoad.has(token) || readImportedTokens().has(token)) {
    return { status: 'none' }
  }
  handledThisLoad.add(token)

  let payload
  try {
    payload = await fetchShare(token)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    return { status: 'error', reason: /\b404\b/.test(msg) ? 'not_found' : 'network' }
  }

  if (!payload || !Array.isArray(payload.messages) || typeof payload.mode !== 'string') {
    return { status: 'error', reason: 'bad_data' }
  }

  const session = useSessionsStore.getState().importSession({
    token,
    sharedAt: payload.shared_at,
    mode: payload.mode,
    modeParams: payload.modeParams ?? {},
    title: payload.title ?? '',
    messages: payload.messages,
    notes: Array.isArray(payload.notes) ? payload.notes : [],
  })
  rememberImportedToken(token)
  return { status: 'imported', sessionId: session.id }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run importShare`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/importShare.ts frontend/src/lib/importShare.test.ts
git commit -m "feat(share): consumeImportParam — one-shot ?import= handler

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

### Task 6: `ShareDialog` + Share button in the chat header

**Files:**
- Create: `frontend/src/components/shell/ShareDialog.tsx`
- Create: `frontend/src/components/shell/ShareDialog.test.tsx`
- Modify: `frontend/src/components/shell/ChatPane.tsx` — import `Share2` + `ShareDialog`, add `shareOpen` state, add a Share button in the header, mount `<ShareDialog>`, swap the mode pill text for `'Imported'` when `session.imported`.
- Modify: `frontend/src/components/shell/ChatPane.test.tsx` — one wiring test.

**Interfaces:**
- Consumes: `createShare` from `@/lib/shareApi` (Task 4); `Session` type (Task 3).
- Produces: `ShareDialog({ session, open, onOpenChange }: { session: Session; open: boolean; onOpenChange: (open: boolean) => void })`. On `open` it calls `createShare(session)` at most once per `session.id` (result cached in a ref) and renders the link with a Copy button; a failure renders a Try again button.

- [ ] **Step 1: Write the failing ShareDialog test**

Create `frontend/src/components/shell/ShareDialog.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareDialog } from './ShareDialog'
import type { Session } from '@/types/session'

const createShare = vi.fn()
let createImpl: (...a: unknown[]) => Promise<unknown> = () =>
  Promise.resolve({ token: 'tok', url: 'http://localhost/?import=tok' })
vi.mock('@/lib/shareApi', () => ({
  createShare: (...a: unknown[]) => {
    createShare(...a)
    return createImpl(...a)
  },
}))

const session: Session = {
  id: 's1', createdAt: 1, updatedAt: 2, mode: 'freeform', modeParams: {},
  title: 'Ask Anything', messages: [{ id: 'm1', role: 'user', text: 'hi' }], notes: [],
}

describe('ShareDialog', () => {
  beforeEach(() => {
    createShare.mockReset()
    createImpl = () => Promise.resolve({ token: 'tok', url: 'http://localhost/?import=tok' })
  })

  it('creates a link on open and shows it', async () => {
    render(<ShareDialog session={session} open onOpenChange={() => {}} />)
    expect(await screen.findByLabelText('Share link')).toHaveValue('http://localhost/?import=tok')
    expect(createShare).toHaveBeenCalledTimes(1)
  })

  it('copies the link to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ShareDialog session={session} open onOpenChange={() => {}} />)
    await screen.findByLabelText('Share link')
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith('http://localhost/?import=tok')
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument()
  })

  it('shows a retry on failure and re-requests on click', async () => {
    createImpl = () => Promise.reject(new Error('Request failed: 500'))
    render(<ShareDialog session={session} open onOpenChange={() => {}} />)
    expect(await screen.findByText(/couldn.t create a share link/i)).toBeInTheDocument()
    createImpl = () => Promise.resolve({ token: 't2', url: 'http://localhost/?import=t2' })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByLabelText('Share link')).toHaveValue('http://localhost/?import=t2')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run ShareDialog`
Expected: FAIL — cannot resolve `./ShareDialog`.

- [ ] **Step 3: Write `ShareDialog.tsx`**

Create `frontend/src/components/shell/ShareDialog.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, Loader2 } from 'lucide-react'
import { createShare } from '@/lib/shareApi'
import type { Session } from '@/types/session'

interface Props {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Status = 'idle' | 'creating' | 'ready' | 'error'

export function ShareDialog({ session, open, onOpenChange }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  // One link per session id — re-opening the dialog reuses it instead of
  // minting a fresh row every time.
  const cache = useRef<Record<string, string>>({})

  const runCreate = useCallback(() => {
    setCopied(false)
    const cached = cache.current[session.id]
    if (cached) {
      setUrl(cached)
      setStatus('ready')
      return
    }
    setStatus('creating')
    createShare(session)
      .then((res) => {
        cache.current[session.id] = res.url
        setUrl(res.url)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [session])

  useEffect(() => {
    if (open) runCreate()
  }, [open, runCreate])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the field is still selectable */
    }
  }

  function retry() {
    delete cache.current[session.id]
    runCreate()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-theme-border)] bg-[var(--color-surface)] p-5 shadow-xl">
          <Dialog.Title className="text-sm font-semibold">Share this conversation</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Anyone with this link can import a copy of this conversation, including its notes.
          </Dialog.Description>

          <div className="mt-4">
            {status === 'creating' && (
              <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating a link…
              </p>
            )}

            {status === 'error' && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-red-600">Couldn&apos;t create a share link.</p>
                <button
                  type="button"
                  onClick={retry}
                  className="self-start rounded px-3 py-1.5 text-sm border border-[var(--color-theme-border)]"
                >
                  Try again
                </button>
              </div>
            )}

            {status === 'ready' && (
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  aria-label="Share link"
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-sm bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded px-3 py-1.5 text-sm border border-[var(--color-theme-border)]"
              >
                Done
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run ShareDialog`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into `ChatPane.tsx`**

In `frontend/src/components/shell/ChatPane.tsx`:

1. Add `Share2` to the lucide import (line 2):
   ```ts
   import { ArrowUp, Check, Copy, Flag, Loader2, RefreshCw, Share2 } from 'lucide-react'
   ```
2. Add the dialog import next to `ReportIssueDialog` (line 16):
   ```ts
   import { ShareDialog } from './ShareDialog'
   ```
3. Add state next to `const [reportOpen, setReportOpen] = useState(false)` (line 83):
   ```ts
   const [shareOpen, setShareOpen] = useState(false)
   ```
4. In the header actions `<div className="flex shrink-0 items-center gap-2">` (line ~458), add a Share button immediately **before** the "Report an issue" button:
   ```tsx
   <button
     onClick={() => setShareOpen(true)}
     className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] transition-colors"
   >
     <Share2 className="w-3 h-3" aria-hidden="true" />
     Share
   </button>
   ```
5. In that same actions row, change the trailing mode pill so an imported session reads "Imported":
   ```tsx
   <span className="hidden lg:inline-block shrink-0 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)]">
     {session.imported ? 'Imported' : MODE_LABELS[session.mode]}
   </span>
   ```
6. Next to the `<ReportIssueDialog ... />` mount (line ~672), add:
   ```tsx
   <ShareDialog session={session} open={shareOpen} onOpenChange={setShareOpen} />
   ```

- [ ] **Step 6: Add the ChatPane wiring test**

In `frontend/src/components/shell/ChatPane.test.tsx`, add an import that matches the file's existing style (it already imports `* as chatApi from '@/lib/chatApi'`; add alongside it):

```ts
import * as shareApi from '@/lib/shareApi'
```

Add this test inside the top-level `describe`:

```tsx
it('opens the Share dialog and shows a generated link', async () => {
  vi.spyOn(shareApi, 'createShare').mockResolvedValue({ token: 'tok', url: 'http://localhost/?import=tok' })
  const session = useSessionsStore.getState().createSession('freeform', {})
  render(<ChatPane sessionId={session.id} />)
  await userEvent.click(screen.getByRole('button', { name: /^share$/i }))
  expect(await screen.findByLabelText('Share link')).toHaveValue('http://localhost/?import=tok')
})
```

> If `ChatPane.test.tsx` does not already create sessions via `useSessionsStore`, add `import { useSessionsStore } from '@/store/useSessionsStore'` and a `beforeEach` that does `localStorage.clear(); useSessionsStore.setState({ sessions: {}, activeSessionId: null })` — match whatever the file already does for the other tests.

- [ ] **Step 7: Run the ChatPane + ShareDialog tests**

Run: `cd frontend && npx vitest run ChatPane ShareDialog`
Expected: PASS (all pre-existing ChatPane tests + the new ones).

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/shell/ShareDialog.tsx frontend/src/components/shell/ShareDialog.test.tsx frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "feat(share): ShareDialog + Share button in the chat header

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

### Task 7: Sidebar — the **Imported** section

**Files:**
- Modify: `frontend/src/components/shell/SessionsPane.tsx` — extract a module-local `SessionRow` (to avoid duplicating ~60 lines of row markup), add the Imported section, feed the mode sections from the non-imported subset.
- Modify: `frontend/src/components/shell/SessionsPane.test.tsx` — two tests.

**Interfaces:**
- Consumes: `Session.imported` (Task 3); `useSessionsStore().importSession` in tests; existing `describeSession`, `filterSessions`, `splitHighlight`, `noteLabel`, `formatSessionTimestamp`, `MODE_LABELS`, `MODE_ICONS`, `groupByMode`.
- Produces: no new exported symbols; `SessionsPane`'s rendered output gains an `Imported` section header (accessible name `Imported (N)`) above the mode-section headers, and imported sessions no longer appear under their mode section.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/shell/SessionsPane.test.tsx`, add inside the top-level `describe('SessionsPane', ...)`:

```tsx
it('groups imported sessions under an Imported section, not their mode section', async () => {
  useSessionsStore.getState().createSession('freeform', {})
  const imported = useSessionsStore.getState().importSession({
    token: 't1', mode: 'devotional', modeParams: { source: 'system' }, title: 'Devotional',
    messages: [{ id: 'x', role: 'user', text: 'shared line' }], notes: [],
  })
  render(<SessionsPane activeSessionId={imported.id} onSelectSession={() => {}} onNewSession={() => {}} />)

  expect(screen.getByRole('button', { name: /Imported \(1\)/ })).toBeInTheDocument()
  // No "Devotional" mode header is created for the imported devotional.
  expect(screen.queryByRole('button', { name: /^Devotional \(/ })).not.toBeInTheDocument()
  // Its row carries the original mode as a sub-label.
  expect(screen.getByText('Imported · Devotional')).toBeInTheDocument()
})

it('search matches an imported session and keeps the Imported section shown', async () => {
  const imported = useSessionsStore.getState().importSession({
    token: 't2', mode: 'freeform', modeParams: {}, title: 'x',
    messages: [{ id: 'x', role: 'user', text: 'find this needle' }], notes: [],
  })
  render(<SessionsPane activeSessionId={imported.id} onSelectSession={() => {}} onNewSession={() => {}} />)
  await userEvent.type(screen.getByRole('searchbox'), 'needle')
  expect(screen.getByRole('button', { name: /Imported \(1\)/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run SessionsPane`
Expected: FAIL — no `Imported (1)` button; `Imported · Devotional` text not found.

- [ ] **Step 3: Extract `SessionRow`**

In `frontend/src/components/shell/SessionsPane.tsx`, add `Inbox` to the lucide import, and add this module-local component **above** `export function SessionsPane`:

```tsx
function SessionRow({
  session,
  activeSessionId,
  query,
  searching,
  onSelectSession,
}: {
  session: Session
  activeSessionId: string | null
  query: string
  searching: boolean
  onSelectSession: (id: string) => void
}) {
  const deleteSession = useSessionsStore((s) => s.deleteSession)
  return (
    <div>
      <div
        className={`group flex items-start justify-between gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
          session.id === activeSessionId
            ? 'bg-[var(--color-surface-alt)] font-medium'
            : 'hover:bg-[var(--color-surface-alt)]'
        }`}
        onClick={() => onSelectSession(session.id)}
      >
        <div className="min-w-0 flex flex-col">
          <span className="truncate">
            {searching
              ? splitHighlight(describeSession(session), query).map((seg, i) =>
                  seg.hit ? (
                    <mark
                      key={i}
                      className="rounded-sm bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]"
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )
              : describeSession(session)}
          </span>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {session.imported
              ? `Imported · ${MODE_LABELS[session.mode]}`
              : formatSessionTimestamp(session.createdAt)}
          </span>
        </div>
        <button
          aria-label="Delete session"
          onClick={(e) => {
            e.stopPropagation()
            deleteSession(session.id)
            if (session.id === activeSessionId) {
              useArtifactStore.getState().close()
            }
          }}
          className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] opacity-40 transition-opacity hover:bg-[var(--color-surface-alt)] hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {session.notes.map((note) => (
        <button
          key={note.id}
          title={noteLabel(note)}
          onClick={() => {
            if (session.id !== activeSessionId) onSelectSession(session.id)
            useArtifactStore.getState().openNote(session.id, note.id)
          }}
          className="w-full flex flex-col items-start gap-0.5 pl-9 pr-3 py-1.5 text-left text-xs hover:bg-[var(--color-surface-alt)] transition-colors"
        >
          <span className="flex items-center gap-1.5 max-w-full">
            <StickyNote
              className="h-3 w-3 shrink-0 text-[var(--color-text-secondary)]"
              aria-hidden="true"
            />
            <span className="truncate">{noteLabel(note)}</span>
          </span>
          <span className="pl-[1.125rem] text-[10px] text-[var(--color-text-secondary)]">
            {formatSessionTimestamp(note.createdAt)}
          </span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Rewire `SessionsPane` to use `SessionRow` + the Imported section**

Inside `export function SessionsPane`:

1. Add collapse state for the new section, next to `const [collapsed, setCollapsed] = useState(...)`:
   ```ts
   const [importedCollapsed, setImportedCollapsed] = useState(false)
   ```
2. Replace the `filtered` / `grouped` derivation:
   ```ts
   const searching = query.trim().length > 0
   const filtered = filterSessions(Object.values(sessions), query)
   const importedSessions = filtered
     .filter((s) => s.imported)
     .sort((a, b) => b.imported!.importedAt - a.imported!.importedAt)
   const grouped = groupByMode(filtered.filter((s) => !s.imported))
   ```
3. In the scroll container, **before** the `{MODE_ORDER.filter(...)...}` block, add:
   ```tsx
   {importedSessions.length > 0 && (
     <div>
       <button
         type="button"
         onClick={() => setImportedCollapsed((v) => !v)}
         aria-expanded={searching ? true : !importedCollapsed}
         className="w-full flex items-center gap-1.5 px-3 pt-3 pb-1 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide hover:text-[var(--color-text-primary)] transition-colors"
       >
         {searching || !importedCollapsed ? (
           <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
         ) : (
           <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
         )}
         <Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
         <span className="truncate">Imported</span>
         <span className="ml-auto normal-case font-normal text-[10px] text-[var(--color-text-secondary)]">
           ({importedSessions.length})
         </span>
       </button>
       {(searching || !importedCollapsed) &&
         importedSessions.map((session) => (
           <SessionRow
             key={session.id}
             session={session}
             activeSessionId={activeSessionId}
             query={query}
             searching={searching}
             onSelectSession={onSelectSession}
           />
         ))}
     </div>
   )}
   ```
4. Inside the existing `MODE_ORDER.filter(...).map((mode) => ...)`, replace the inline per-session `<div key={session.id}>…</div>` markup with:
   ```tsx
   {!isCollapsed &&
     grouped[mode]!.map((session) => (
       <SessionRow
         key={session.id}
         session={session}
         activeSessionId={activeSessionId}
         query={query}
         searching={searching}
         onSelectSession={onSelectSession}
       />
     ))}
   ```
5. Remove the now-unused local `deleteSession` selector from `SessionsPane` **only if** nothing else in the component still references it (the delete button moved into `SessionRow`). Leave the `sessions` and other selectors as they are.

- [ ] **Step 5: Run the SessionsPane tests**

Run: `cd frontend && npx vitest run SessionsPane`
Expected: PASS (all pre-existing tests + the 2 new ones).

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no errors (watch for an unused-import / unused-variable error from step 4.5).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shell/SessionsPane.tsx frontend/src/components/shell/SessionsPane.test.tsx
git commit -m "feat(sessions): Imported sidebar section for shared conversations

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

### Task 8: `App.tsx` — import on load

**Files:**
- Modify: `frontend/src/App.tsx` — an effect that runs `consumeImportParam()` once on mount, strips `?import=` from the URL, selects the imported session, and shows a status/error banner.
- Modify: `frontend/src/App.test.tsx` — two tests.

**Interfaces:**
- Consumes: `consumeImportParam` from `@/lib/importShare` (Task 5); the existing `setSessionId` from `useSessionIdParam`; `X` icon (already imported in `App.tsx`).
- Produces: no new exported symbols. Behaviour: on mount, `?import=<token>` → fetch + import + `setSessionId(newId)` + `history.replaceState` dropping the param; failure → a dismissible `role="status"` banner at the top of the shell.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/App.test.tsx`, add near the other imports:

```ts
import * as shareApi from '@/lib/shareApi'
```

Add these tests inside `describe('App', ...)`:

```tsx
it('imports a shared conversation from ?import= and opens it', async () => {
  vi.spyOn(shareApi, 'fetchShare').mockResolvedValue({
    title: 'Devotional', mode: 'devotional', modeParams: { source: 'system' },
    messages: [{ id: 'x', role: 'user', text: 'a shared devotional' }], notes: [],
    shared_at: '2026-09-07T00:00:00.000Z',
  })
  window.history.pushState({}, '', '/?import=tok-app-1')

  render(<App />)

  expect(await screen.findByText('a shared devotional')).toBeInTheDocument()
  expect(new URLSearchParams(window.location.search).get('import')).toBeNull()
  const sessions = Object.values(useSessionsStore.getState().sessions)
  expect(sessions).toHaveLength(1)
  expect(sessions[0].imported?.token).toBe('tok-app-1')
})

it('shows an error banner when the shared link is unknown', async () => {
  vi.spyOn(shareApi, 'fetchShare').mockRejectedValue(new Error('Request failed: 404 Not Found'))
  window.history.pushState({}, '', '/?import=missing-app')
  render(<App />)
  expect(await screen.findByText(/no longer available/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: FAIL — the shared message never renders; no banner text.

- [ ] **Step 3: Implement the effect + banner in `App.tsx`**

1. Add the import:
   ```ts
   import { consumeImportParam } from '@/lib/importShare'
   ```
2. Inside `export default function App()`, next to the other `useState` hooks:
   ```ts
   const [importNotice, setImportNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
   const importHandled = useRef(false)
   ```
3. Add the effect (after the existing `useEffect` hooks):
   ```ts
   // A ?import=<token> link: pull the shared conversation into local
   // history once, then clean the param out of the URL.
   useEffect(() => {
     if (importHandled.current) return
     importHandled.current = true
     if (!new URLSearchParams(window.location.search).get('import')) return

     setImportNotice({ tone: 'info', text: 'Importing shared conversation…' })
     consumeImportParam().then((result) => {
       const url = new URL(window.location.href)
       url.searchParams.delete('import')
       window.history.replaceState({}, '', url)

       if (result.status === 'imported' || result.status === 'duplicate') {
         setSessionId(result.sessionId)
         setImportNotice(null)
       } else if (result.status === 'error') {
         setImportNotice({
           tone: 'error',
           text:
             result.reason === 'not_found'
               ? 'That shared link is no longer available.'
               : 'Couldn’t load the shared conversation.',
         })
       } else {
         setImportNotice(null)
       }
     })
   }, [setSessionId])
   ```
4. Render the banner as the first child inside the top-level `<div className="flex h-dvh flex-col overflow-hidden ...">`:
   ```tsx
   {importNotice && (
     <div
       role="status"
       className={`flex shrink-0 items-center justify-between gap-3 px-4 py-2 text-sm ${
         importNotice.tone === 'error'
           ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
           : 'bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)]'
       }`}
     >
       <span>{importNotice.text}</span>
       {importNotice.tone === 'error' && (
         <button
           type="button"
           onClick={() => setImportNotice(null)}
           aria-label="Dismiss"
           className="shrink-0 rounded p-0.5 hover:opacity-70"
         >
           <X className="h-4 w-4" aria-hidden="true" />
         </button>
       )}
     </div>
   )}
   ```

- [ ] **Step 4: Run the App tests**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: PASS (all pre-existing App tests + the 2 new ones).

- [ ] **Step 5: Full frontend suite + type-check + lint**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run lint`
Expected: all PASS / no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(share): import a shared conversation from ?import= on load

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

### Task 9: Deployment wiring + docs

**Files:**
- Modify: `docker-compose.yml` — a `shares-db` named volume; `SHARE_DB_URL` env + volume mount on `flask-api`.
- Modify: `.env.example` — a `SHARE_DB_URL` entry.
- Modify: `DEPLOYMENT.md` — a paragraph mirroring the `feedback-db` volume note.
- Modify: `CLAUDE.md` — the new DB, the two routes, the Imported-session concept.

**Interfaces:**
- Consumes: nothing at runtime beyond Task 1/2. This task ships config + documentation only.
- Produces: `docker compose config` resolves; the deployed `flask-api` writes `shares.db` to a persistent volume instead of the image layer.

- [ ] **Step 1: `docker-compose.yml` — volume declaration**

In the top-level `volumes:` block, after the `feedback-db:` entry:

```yaml
  # Persistent store for shared-conversation snapshots (shares.db), mounted
  # into `flask-api` at /app/shares-db. Survives container recreation.
  shares-db:
```

- [ ] **Step 2: `docker-compose.yml` — flask-api env + mount**

In the `flask-api` service `environment:` block, after the `FEEDBACK_DB_URL:` line:

```yaml
      # Writable conversation-sharing DB — directory-scoped named volume.
      SHARE_DB_URL: sqlite:////app/shares-db/shares.db
```

In the `flask-api` service `volumes:` block, after the `- feedback-db:/app/feedback-db` line:

```yaml
      # Writable conversation-sharing DB — survives container recreation.
      - shares-db:/app/shares-db
```

- [ ] **Step 3: Validate compose**

Run: `docker compose config >/dev/null && echo OK`
Expected: `OK` (no YAML/interpolation errors). *(If Docker is not available in the execution environment, skip with a note — the change is a mechanical mirror of the `feedback-db` block.)*

- [ ] **Step 4: `.env.example`**

After the `ADMIN_PASSWORD=` line (end of the troubleshooting-feedback block), add:

```
# ─── Conversation sharing (Flask: myproject.py) ────────────────────────────
# Where shared-conversation snapshots are stored. Default is a file in the
# app working dir; in Docker this is a mounted volume (see docker-compose.yml).
SHARE_DB_URL=sqlite:///shares.db
```

- [ ] **Step 5: `DEPLOYMENT.md`**

Search for `feedback-db`. Next to the paragraph that documents that volume, add an equivalent one:

```
### shares.db (conversation sharing)

`POST /api/share` writes an immutable conversation snapshot; `GET
/api/share/<token>` reads it back for the recipient's browser. Stored in
`shares.db` via the `dataset` library, on the `shares-db` named volume
mounted at `/app/shares-db` (env `SHARE_DB_URL`). Same persistence and
backup considerations as `feedback.db`. There is no admin UI and no
expiry — rows accumulate; an operator can prune old rows directly with
`sqlite3` if ever needed.
```

- [ ] **Step 6: `CLAUDE.md`**

- In the **Database** section, after the `Strongs_` / `APOC` bullets, add:
  ```
  - `shares.db` — separate writable SQLite file (not `Complete.db`). One row per shared conversation: an immutable snapshot (messages + artifact links + notes) keyed by a random token. Written by `POST /api/share`, read by `GET /api/share/<token>`. See `share_store.py`.
  ```
- In the **Routes** section, add:
  ```
  - `/api/share` — `POST` a session snapshot, returns `{ token, url }` (`url` = `<origin>/?import=<token>`)
  - `/api/share/<token>` — `GET` the snapshot for import; `404` if unknown
  ```
- Add a short subsection after **Verse numbering** (or near the frontend notes):
  ```
  ## Conversation sharing

  Conversations ("sessions") live only in the browser (`localStorage`,
  Zustand `persist`, key `bible-explorer-sessions`). The Share button in
  the chat header POSTs a snapshot to `shares.db` and yields a
  `/?import=<token>` link. Opening that link imports the conversation into
  the recipient's local history as a new session carrying an `imported`
  marker; `SessionsPane` shows those under a dedicated **Imported**
  section (their real `mode` is preserved). Snapshots are immutable — no
  expiry, no revocation. See
  `docs/superpowers/specs/2026-09-07-conversation-sharing-design.md`.
  ```

- [ ] **Step 7: Final full-suite check**

Run: `pytest -q && cd frontend && npx vitest run`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml .env.example DEPLOYMENT.md CLAUDE.md
git commit -m "chore(share): shares.db volume, env, and docs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| `shares.db` + `share_store.py` | Task 1 |
| `POST /api/share` (validation, trace strip, size cap, rate limit, origin URL) | Task 2 |
| `GET /api/share/<token>` (shape, no `client_id`, 404) | Task 2 |
| `.gitignore` for `shares.db*` | Task 2 (step 6) |
| `Session.imported` marker + `SharePayload` type | Task 3 |
| `importSession` action, `sanitizeMessages`, `sanitizeImported`, v3→v4 | Task 3 |
| `lib/shareApi.ts` (`createShare`, `fetchShare`) | Task 4 |
| `lib/importShare.ts` (`consumeImportParam`, dedupe set) | Task 5 |
| `ShareDialog` + Share button in `ChatPane` header | Task 6 |
| ChatPane "Imported" pill | Task 6 (step 5.5) |
| `SessionsPane` Imported section, mode sections from non-imported subset | Task 7 |
| `App.tsx` import-on-load, URL cleanup, error banner | Task 8 |
| Docker volume, `SHARE_DB_URL`, `.env.example`, `DEPLOYMENT.md`, `CLAUDE.md` | Task 9 |
| Testing (backend store/routes, store, shareApi, importShare, ShareDialog, SessionsPane, App) | Tasks 1–8 |
| Error handling (413/429/400/500/404/network/bad_data/re-paste/quota) | Tasks 2, 5, 6, 8 |
| Rejected approaches | n/a (spec only) |

No gaps.

**2. Placeholder scan**

All code steps carry full code. The two soft instructions — "match the file's existing vitest import/`beforeEach` style" in Task 6 step 6, and "skip `docker compose config` if Docker is unavailable" in Task 9 step 3 — are conditional-on-environment notes, not missing content; the code to add is fully specified in both cases. No `TBD`/`TODO`/"add error handling"/"write tests for the above".

**3. Type consistency**

- `importSession(payload: SharePayload & { token: string; sharedAt?: string })` — same signature in Task 3 (definition), Task 5 (call site passes `token`, `sharedAt`, `mode`, `modeParams`, `title`, `messages`, `notes`), and Task 3 tests.
- `createShare(session: Session): Promise<{ token: string; url: string }>` — consistent across Task 4 (def), Task 6 (`ShareDialog`, mock), Task 6 ChatPane test.
- `fetchShare(token: string): Promise<FetchedShare>` where `FetchedShare = SharePayload & { shared_at?: string }` — Task 4 def; Task 5 reads `payload.shared_at`, `payload.messages`, `payload.mode`, `payload.modeParams`, `payload.notes`, `payload.title`; Task 8 mock returns exactly those keys.
- `ImportResult` union — defined Task 5, consumed Task 8 (`'imported' | 'duplicate' | 'error' | 'none'`, `result.reason` of `'not_found' | 'network' | 'bad_data'`). Matches.
- Backend: route names `create_share` / `read_share` (distinct from `share_store.get_share`); globals `_SHARE_DB_URL`, `_share_db`, `_share_buckets`, `_MAX_SHARE_BYTES`, `_MAX_SHARE_MESSAGES`; helpers `_get_share_db`, `_share_rate_ok`, `_request_origin` — all referenced consistently in Task 2 and its tests.
- `share_store.insert_share(db, *, client_id, title, mode, message_count, payload)` and `get_share(db, token) -> {... , "payload": dict|None}` — Task 1 def; Task 2 route + Task 1/2 tests use the same kwargs and the `row["payload"]` key.
- localStorage keys: `bible-explorer-sessions` (store, unchanged), `bible-explorer-imported-tokens` (Task 5) — consistent.

No inconsistencies found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-07-conversation-sharing.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
